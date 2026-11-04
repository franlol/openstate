// The bridge to real apps: a WebSocket server that openstate/client connects to.
// Each connection is a source; each store it reports is a Store whose StoreConn talks back over the socket.
import type { Server, ServerWebSocket } from "bun"
import type { AppMessage, LiftedState, ServerMessage } from "../client/protocol"
import { parseStack, splitAction } from "./history"
import { newActionId, type Action, type History, type Source, type Store, type StoreConn } from "./model"

type Conn = { source: Source | null }
type Socket = ServerWebSocket<Conn>

// Per-store bookkeeping that the UI does not need.
type Link = {
  ws: Socket
  instanceId: string
  kind: "lifted" | "connect"
  // Lifted stores: the app's lifted state as last reported, and our action id for each lifted id.
  lifted?: LiftedState
  ids: Map<number, number>
  // Connect stores: zustand answers ROLLBACK/COMMIT/IMPORT with a fresh init that must not wipe the history.
  ignoreInit: boolean
  seq: number
  // Lifted ids that arrived while openstate was paused: the app keeps them, the list does not show them.
  // (The extension's PAUSE_RECORDING would fold the whole history into a commit instead.)
  unrecorded: Set<number>
}

export type Bridge = {
  sources: Source[]
  listen(port: number): string | null
  setMaxAge(n: number): void
}

// zustand and friends hand over states, not a reducer, so nothing can be replayed differently.
const unsupported = (st: Store, what: string) => new Error(`${what} needs a Redux store; ${st.name} (${st.lib}) only reports its states`)

export function startBridge(opts: { onChange: () => void; isPaused: () => boolean; maxAge: () => number }): Bridge {
  const sources: Source[] = []
  const links = new WeakMap<Store, Link>()
  const sockets = new Set<Socket>()
  let server: Server<Conn> | null = null
  let colors = 0

  const sendTo = (ws: Socket, m: ServerMessage) => ws.send(JSON.stringify(m))
  const lifted = (st: Store, action: { type: string; [k: string]: unknown }) => {
    const l = links.get(st)!
    sendTo(l.ws, { t: "lifted", id: l.instanceId, action })
  }
  const message = (st: Store, msg: unknown) => {
    const l = links.get(st)!
    sendTo(l.ws, { t: "message", id: l.instanceId, message: msg })
  }
  const liftedIdOf = (st: Store, id: number) => st.actions.find((a) => a.id === id)?.seq

  function makeAction(st: Store, m: { action: Record<string, unknown>; time: number; stack?: string }, seq: number, prev: unknown, state: unknown, fromDevtools?: boolean): Action {
    return {
      id: newActionId(),
      seq,
      storeKey: st.key,
      ...splitAction(m.action),
      time: m.time,
      prev,
      state,
      trace: parseStack(m.stack),
      skipped: false,
      fromDevtools,
    }
  }

  // Rebuild a lifted store's list from the app's lifted state, keeping our ids (and the cursor) stable.
  function fromLifted(st: Store, l: Link, ls: LiftedState) {
    l.lifted = ls
    const old = new Map(st.actions.map((a) => [a.seq, a]))
    const skipped = new Set(ls.skippedActionIds)
    st.actions = ls.stagedActionIds.flatMap((lid, i) => {
      if (l.unrecorded.has(lid)) return []
      const entry = ls.actionsById[lid]!
      const state = ls.computedStates[i]?.state
      const prev = i ? ls.computedStates[i - 1]?.state : state
      const was = old.get(lid)
      const a = makeAction(st, { action: entry.action, time: entry.timestamp, stack: entry.stack }, lid, prev, state, was?.fromDevtools)
      a.id = l.ids.get(lid) ?? a.id
      l.ids.set(lid, a.id)
      a.skipped = skipped.has(lid)
      return [a]
    })
    st.locked = ls.isLocked
    if (st.commitId !== null && !st.actions.some((a) => a.id === st.commitId)) st.commitId = null
  }

  function liftedConn(st: Store): StoreConn {
    const l = () => links.get(st)!
    return {
      dispatch: (a) => sendTo(l().ws, { t: "dispatch", id: l().instanceId, action: a.payload === undefined ? { type: a.type } : { type: a.type, payload: a.payload } }),
      toggle: (id) => lifted(st, { type: "TOGGLE_ACTION", id: liftedIdOf(st, id) }),
      // The extension's COMMIT empties the history; openstate keeps it and only remembers the base.
      commit: (id) => ((st.commitId = id), opts.onChange()),
      // Back to the commit: hand the app its own lifted state cut there, states included.
      revert: () => {
        const ls = l().lifted
        if (!ls) return
        const at = Math.max(0, st.actions.findIndex((a) => a.id === st.commitId))
        const keep = ls.stagedActionIds.slice(0, at + 1)
        const kept = new Set(keep)
        const next: LiftedState = {
          ...ls,
          actionsById: Object.fromEntries(Object.entries(ls.actionsById).filter(([k]) => kept.has(Number(k)))),
          stagedActionIds: keep,
          skippedActionIds: ls.skippedActionIds.filter((x) => kept.has(x)),
          computedStates: ls.computedStates.slice(0, at + 1),
          currentStateIndex: at,
        }
        lifted(st, { type: "IMPORT_STATE", nextLiftedState: next, noRecompute: true })
      },
      sweep: () => lifted(st, { type: "SWEEP" }),
      lock: (on) => lifted(st, { type: "LOCK_CHANGES", status: on }),
      reorder: (id, beforeId) =>
        lifted(st, {
          type: "REORDER_ACTION",
          actionId: liftedIdOf(st, id),
          // Past the last id means "to the end" for the instrument.
          beforeActionId: beforeId === null ? (l().lifted?.nextActionId ?? 1e9) : liftedIdOf(st, beforeId),
        }),
      import: (h: History) => {
        const rest = h.actions[0]?.type === "@@INIT" ? h.actions.slice(1) : h.actions
        if (!h.hasStates) {
          // Only actions: the app replays them through its reducer.
          lifted(st, { type: "IMPORT_STATE", nextLiftedState: rest.map((a) => actionOf(a)) })
          return
        }
        const ids = h.actions.map((_, i) => i)
        const next: LiftedState = {
          actionsById: Object.fromEntries(
            h.actions.map((a, i) => [i, { type: "PERFORM_ACTION", action: actionOf(a), timestamp: a.time, stack: a.trace.join("\n") }]),
          ),
          computedStates: h.actions.map((a) => ({ state: a.state })),
          stagedActionIds: ids,
          skippedActionIds: h.actions.flatMap((a, i) => (a.skipped ? [i] : [])),
          committedState: h.actions[0]?.state,
          currentStateIndex: ids.length - 1,
          nextActionId: ids.length,
          isLocked: st.locked,
          isPaused: false,
        }
        st.commitId = null
        lifted(st, { type: "IMPORT_STATE", nextLiftedState: next, noRecompute: true })
      },
    }
  }

  // zustand and other connect() stores: openstate keeps the history and pushes states back.
  function connectConn(st: Store): StoreConn {
    const l = () => links.get(st)!
    const base = () => Math.max(0, st.actions.findIndex((a) => a.id === st.commitId))
    return {
      dispatch: (a) => message(st, { type: "ACTION", payload: JSON.stringify(actionOf(a)) }),
      toggle: () => {
        throw unsupported(st, "skip")
      },
      reorder: () => {
        throw unsupported(st, "reorder")
      },
      lock: () => {
        throw unsupported(st, "lock")
      },
      commit: (id) => ((st.commitId = id), opts.onChange()),
      revert: () => {
        st.actions.splice(base() + 1)
        l().ignoreInit = true
        message(st, { type: "DISPATCH", payload: { type: "ROLLBACK" }, state: JSON.stringify(st.actions[st.actions.length - 1]?.state ?? null) })
        opts.onChange()
      },
      sweep: () => ((st.actions = st.actions.filter((a) => !a.skipped)), opts.onChange()),
      import: (h: History) => {
        if (!h.hasStates) throw new Error(`this file has no states; ${st.name} (${st.lib}) cannot replay actions to rebuild them`)
        const link = l()
        st.commitId = null
        st.actions = h.actions.map((x, i) => ({
          ...makeAction(st, { action: actionOf(x), time: x.time }, i, undefined, x.state),
          trace: x.trace,
          skipped: x.skipped,
        }))
        st.actions.forEach((a, i) => (a.prev = i ? st.actions[i - 1]!.state : a.state))
        link.seq = st.actions.length
        link.ignoreInit = true
        message(st, {
          type: "DISPATCH",
          payload: { type: "IMPORT_STATE", nextLiftedState: { computedStates: h.actions.map((a) => ({ state: a.state })) } },
        })
        opts.onChange()
      },
    }
  }

  function onHello(ws: Socket, app: string) {
    // The same app coming back (reload, restart) takes its old place in the list.
    let src = sources.find((s) => s.name === app && !s.connected)
    if (src) {
      src.connected = true
      src.links.push({ time: Date.now(), connected: true })
    } else {
      const taken = sources.filter((s) => s.name === app || s.name.startsWith(app + " #")).length
      src = {
        id: taken ? `${app}#${taken + 1}` : app,
        name: taken ? `${app} #${taken + 1}` : app,
        color: colors++,
        connected: true,
        links: [{ time: Date.now(), connected: true }],
        stores: [],
      }
      sources.push(src)
    }
    ws.data.source = src
    sendTo(ws, { t: "config", maxAge: opts.maxAge() })
  }

  function onInit(ws: Socket, src: Source, m: Extract<AppMessage, { t: "init" }>) {
    const key = `${src.id}/${m.id}`
    let st = src.stores.find((s) => s.key === key)
    if (st) {
      const l = links.get(st)!
      l.ws = ws
      // An answer to our own rollback or import, not a new start.
      if (l.ignoreInit) return void (l.ignoreInit = false)
    } else {
      const made: Store = { key, sourceId: src.id, lib: m.lib, name: m.name, actions: [], commitId: null, locked: false, conn: null! }
      made.conn = m.kind === "lifted" ? liftedConn(made) : connectConn(made)
      st = made
      src.stores.push(st)
      links.set(st, { ws, instanceId: m.id, kind: m.kind, ids: new Map(), ignoreInit: false, seq: 0, unrecorded: new Set() })
    }
    const l = links.get(st)!
    if (m.kind === "lifted") fromLifted(st, l, m.lifted)
    else {
      l.seq = 0
      st.commitId = null
      st.actions = [makeAction(st, { action: { type: "@@INIT" }, time: Date.now() }, l.seq++, m.state, m.state)]
    }
  }

  function onAction(src: Source, m: Extract<AppMessage, { t: "action" }>) {
    const st = src.stores.find((s) => s.key === `${src.id}/${m.id}`)
    const l = st && links.get(st)
    if (!st || !l) return
    const last = st.actions[st.actions.length - 1]
    if (l.kind === "lifted") {
      const ls = l.lifted
      // Keep the mirror of the lifted state current, so revert can cut it without asking the app.
      if (ls && m.liftedId !== undefined) {
        ls.actionsById[m.liftedId] = { type: "PERFORM_ACTION", action: m.action, timestamp: m.time, stack: m.stack }
        ls.stagedActionIds = [...ls.stagedActionIds, m.liftedId]
        ls.computedStates = [...ls.computedStates, { state: m.state }]
        ls.nextActionId = m.liftedId + 1
        ls.currentStateIndex = ls.stagedActionIds.length - 1
      }
      if (opts.isPaused() && !m.fromDevtools && m.liftedId !== undefined) return void l.unrecorded.add(m.liftedId)
      // Previous state of the app, which includes anything that happened while paused.
      const prev = ls?.computedStates[ls.computedStates.length - 2]?.state ?? last?.state
      const a = makeAction(st, m, m.liftedId ?? l.seq++, prev, m.state, m.fromDevtools)
      l.ids.set(a.seq, a.id)
      st.actions.push(a)
      return
    }
    // The app keeps running while paused; only openstate stops recording.
    if (opts.isPaused() && !m.fromDevtools) return
    st.actions.push(makeAction(st, m, l.seq++, last?.state, m.state, m.fromDevtools))
    while (st.actions.length > opts.maxAge()) st.actions.shift()
  }

  return {
    sources,
    listen(port) {
      try {
        const next = Bun.serve<Conn>({
          port,
          fetch(req, srv) {
            if (srv.upgrade(req, { data: { source: null } })) return
            return new Response("openstate: connect with openstate/client over WebSocket\n", { status: 426 })
          },
          websocket: {
            open(ws) {
              sockets.add(ws)
            },
            message(ws, raw) {
              let m: AppMessage
              try {
                m = JSON.parse(String(raw))
              } catch {
                return
              }
              if (m.t === "hello") onHello(ws, m.app)
              const src = ws.data.source
              if (!src) return
              if (m.t === "init") onInit(ws, src, m)
              else if (m.t === "action") onAction(src, m)
              else if (m.t === "lifted") {
                const st = src.stores.find((s) => s.key === `${src.id}/${m.id}`)
                if (st) fromLifted(st, links.get(st)!, m.lifted)
              }
              opts.onChange()
            },
            close(ws) {
              sockets.delete(ws)
              const src = ws.data.source
              if (!src) return
              src.connected = false
              src.links.push({ time: Date.now(), connected: false })
              opts.onChange()
            },
          },
        })
        server?.stop(true)
        server = next
        return null
      } catch (e) {
        const code = (e as { code?: string }).code
        return code === "EADDRINUSE" ? `port ${port} is in use` : (e as Error).message
      }
    },
    setMaxAge(n) {
      for (const ws of sockets) sendTo(ws, { t: "config", maxAge: n })
    },
  }
}

const actionOf = (a: { type: string; payload?: unknown }) => (a.payload === undefined ? { type: a.type } : { type: a.type, payload: a.payload })
