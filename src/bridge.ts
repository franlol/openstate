// The bridge to real apps: a WebSocket server that @openstate-devtools/client connects to, and that also speaks the
// Redux DevTools remote protocol (SocketCluster), so apps set up for remote devtools connect unchanged.
// Each connection is a source; each store it reports is a Store whose StoreConn talks back over the socket.
import type { Server, ServerWebSocket } from "bun"
import jsan from "jsan"
import { PROTOCOL, type AppMessage, type LiftedState, type ServerMessage } from "../client/protocol"
import { CLIENT_VERSION } from "../client/version"
import { parseStack, splitAction } from "./history"
import { clientStatus, isLocal, newActionId, type Access, type Action, type History, type Origin, type Source, type Store, type StoreConn } from "./model"
import { loadOrigins, saveOrigins } from "./settings"

type Conn = {
  source: Source | null
  // The page it comes from, as the browser says; for an app on another device (`:set lan`), its address as
  // tcp://ip. None for apps on this machine outside a browser.
  origin?: string
  // Frames from a page still waiting for a yes, handled once it gets one, and their size.
  held?: string[]
  heldBytes?: number
  // It sent more than is kept while waiting: a yes has it reconnect and start over.
  overflow?: boolean
  // A blocked page: kept connected, so its client does not keep retrying, and its frames kept like a waiting
  // page's (up to HELD_MAX) in case it is let in after all.
  parked?: boolean
  // Decided by the first frame: @openstate-devtools/client says hello, a remote devtools client starts a SocketCluster handshake.
  proto?: "openstate" | "remote"
  // The app's start, from its hello.
  run?: string
}
type LiftedAction = { type: string; [k: string]: unknown }
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
  // How lifted actions and dispatches reach this store's app, per protocol.
  out: { lifted(action: LiftedAction): void; dispatch(action: LiftedAction): void }
  // Remote apps do not say which actions openstate dispatched; the next of each type sent is taken as ours.
  expect: string[]
  // A remote app's maxAge, learnt from its first isExcess: that flag stays on for good, even after a revert.
  cap?: number
  // Connect stores: the app's start and the number of the last action recorded, to fill in a reconnect.
  run?: string
  lastN?: number
}

export type Bridge = {
  sources: Source[]
  access: Access
  // On this machine only, or also on the network for phones, VMs and containers (`lan`).
  listen(port: number, lan: boolean): string | null
  // Frees the port, e.g. for the new openstate after an update.
  close(): void
  setMaxAge(n: number): void
}

// Frames kept from one waiting or blocked page in case it is let in later; a busy one goes past this and
// reconnects instead.
const HELD_MAX = 1000
const HELD_BYTES = 16 << 20

// zustand and friends hand over states, not a reducer, so nothing can be replayed differently.
const unsupported = (st: Store, what: string) => new Error(`${what} needs a Redux store; ${st.name} (${st.lib}) only reports its states`)

export function startBridge(opts: {
  onChange: () => void
  isPaused: () => boolean
  maxAge: () => number
  // A message for the user; an error unless said otherwise.
  warn: (text: string, error?: boolean) => void
}): Bridge {
  const sources: Source[] = []
  const links = new WeakMap<Store, Link>()
  const sockets = new Set<Socket>()
  let servers: Server<Conn>[] = []
  let bound: { port: number; lan: boolean } | null = null
  let colors = 0
  const { allowed, blocked } = loadOrigins()
  const origins: Origin[] = [...blocked].map((origin) => ({ origin, access: "blocked", tries: 0, time: 0, live: 0 }))
  // How many of an origin's sockets are waiting or parked, for the list.
  const waiting = (ws: Socket) => !!(ws.data.held || ws.data.parked || ws.data.overflow)
  const recount = () => {
    for (const o of origins) o.live = socketsOf(o.origin).filter(waiting).length
  }
  const save = () => void saveOrigins(allowed, blocked).catch(() => {})
  const socketsOf = (origin: string) => [...sockets].filter((ws) => ws.data.origin === origin)

  const access: Access = {
    origins,
    allow(origin) {
      blocked.delete(origin)
      allowed.add(origin)
      origins.splice(0, origins.length, ...origins.filter((o) => o.origin !== origin))
      save()
      for (const ws of socketsOf(origin)) {
        if (!waiting(ws)) continue
        // Those waiting or blocked get in with what they have sent so far. One that sent more than was kept is
        // asked to reconnect and start over instead; @openstate-devtools/client does so at once.
        const { held, overflow } = ws.data
        Object.assign(ws.data, { held: undefined, heldBytes: undefined, parked: undefined, overflow: undefined })
        if (overflow) ws.close(1012, "allowed in openstate, reconnect")
        else for (const text of held ?? []) handle(ws, text)
      }
      opts.onChange()
    },
    block(origin) {
      allowed.delete(origin)
      blocked.add(origin)
      const o = origins.find((x) => x.origin === origin)
      if (o) o.access = "blocked"
      else origins.push({ origin, access: "blocked", tries: 0, time: Date.now(), live: 0 })
      save()
      for (const ws of socketsOf(origin)) park(ws)
      recount()
      opts.onChange()
    },
    disconnect(src) {
      if (src.origin && !isLocal(src.origin) && allowed.delete(src.origin)) save()
      for (const ws of sockets) if (ws.data.source === src) ws.close(1000, "disconnected in openstate")
    },
    forget(origin) {
      allowed.delete(origin)
      blocked.delete(origin)
      // Its blocked sockets go too: kept, they would get in along with the next one on a yes, as a second app.
      for (const ws of socketsOf(origin)) if (ws.data.parked || ws.data.overflow) ws.close(1000, "forgotten in openstate")
      origins.splice(0, origins.length, ...origins.filter((o) => o.origin !== origin))
      save()
      opts.onChange()
    },
  }

  // Not listened to from now on. A page that was already in is cut off instead: it comes back and is parked then.
  function park(ws: Socket) {
    if (ws.data.source) return ws.close(1008, "blocked in openstate")
    if (!ws.data.overflow) ws.data.held ??= []
    ws.data.parked = true
  }

  // A new socket: in, held until the user says, or parked.
  function admit(ws: Socket) {
    const origin = ws.data.origin
    if (!origin) return
    if (blocked.has(origin)) {
      const o = origins.find((x) => x.origin === origin)
      if (o) (o.tries++, (o.time = Date.now()))
      park(ws)
      recount()
      return opts.onChange()
    }
    if (isLocal(origin) || allowed.has(origin)) return
    ws.data.held = []
    const o = origins.find((x) => x.origin === origin)
    if (o) (o.tries++, (o.time = Date.now()))
    else origins.push({ origin, access: "pending", tries: 1, time: Date.now(), live: 0 })
    recount()
    opts.onChange()
  }

  const sendTo = (ws: Socket, m: ServerMessage) => ws.send(JSON.stringify(m))
  const lifted = (st: Store, action: LiftedAction) => links.get(st)!.out.lifted(action)
  // @openstate-devtools/client: the instance id says which store of the app.
  const clientOut = (l: Link): Link["out"] => ({
    lifted: (action) => sendTo(l.ws, { t: "lifted", id: l.instanceId, action }),
    dispatch: (action) => sendTo(l.ws, { t: "dispatch", id: l.instanceId, action }),
  })
  // Remote devtools: one store per socket, messages published on the channel the app logged in to.
  const remoteOut = (l: Link): Link["out"] => ({
    lifted: (action) => publish(l.ws, { type: "DISPATCH", action }),
    // The remote client evaluates a string action, so send it as source text.
    dispatch: (action) => (l.expect.push(action.type), publish(l.ws, { type: "ACTION", action: JSON.stringify(action) })),
  })
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
      dispatch: (a) => l().out.dispatch(actionOf(a)),
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

  function onHello(ws: Socket, m: Extract<AppMessage, { t: "hello" }>) {
    ws.data.source = sourceFor(m.app, ws.data.origin)
    ws.data.run = m.run
    sendTo(ws, { t: "config", v: PROTOCOL, maxAge: opts.maxAge() })
    const src = ws.data.source
    src.client = { version: m.client ?? null, protocol: m.v ?? 0 }
    const status = clientStatus(src)
    if (status === "incompatible") opts.warn(`${src.name} speaks protocol ${m.v ?? 0}, openstate ${PROTOCOL} · update the older one`)
    // Once per app and run of openstate: the mark in the sources panel says it from then on.
    else if (status === "outdated" && !toldOutdated.has(src.name)) {
      toldOutdated.add(src.name)
      opts.warn(`${src.name}: its client ${m.client ?? "0.1.3 or older"} is behind ${CLIENT_VERSION} · select it for the command`, false)
    }
  }
  const toldOutdated = new Set<string>()

  function sourceFor(app: string, origin?: string): Source {
    // The same app coming back (reload, restart) takes its old place in the list.
    let src = sources.find((s) => s.name === app && !s.connected)
    if (src) {
      src.connected = true
      src.origin = origin
      src.links.push({ time: Date.now(), connected: true })
    } else {
      const taken = sources.filter((s) => s.name === app || s.name.startsWith(app + " #")).length
      src = {
        id: taken ? `${app}#${taken + 1}` : app,
        name: taken ? `${app} #${taken + 1}` : app,
        color: colors++,
        connected: true,
        origin,
        links: [{ time: Date.now(), connected: true }],
        stores: [],
      }
      sources.push(src)
    }
    return src
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
      const l: Link = { ws, instanceId: m.id, kind: m.kind, ids: new Map(), ignoreInit: false, seq: 0, unrecorded: new Set(), out: null!, expect: [] }
      l.out = clientOut(l)
      links.set(st, l)
    }
    const l = links.get(st)!
    if (m.kind === "lifted") return fromLifted(st, l, m.lifted)
    const history = m.history ?? []
    const first = history[0]?.n
    const run = ws.data.run
    // The same run reconnecting, or catching up after falling behind: add what openstate missed.
    if (l.run === run && l.lastN !== undefined && (first === undefined || first <= l.lastN + 1)) {
      for (const e of history) if (e.n > l.lastN) record(st, l, { t: "action", id: m.id, ...e })
      return
    }
    // A new start, or a gap longer than the app keeps: what the app has is the history.
    l.run = run
    l.lastN = undefined
    l.seq = 0
    st.commitId = null
    st.actions = [makeAction(st, { action: { type: "@@INIT" }, time: Date.now() }, l.seq++, m.state, m.state)]
    for (const e of history) record(st, l, { t: "action", id: m.id, ...e })
  }

  function onAction(src: Source, m: Extract<AppMessage, { t: "action" }>) {
    const st = src.stores.find((s) => s.key === `${src.id}/${m.id}`)
    const l = st && links.get(st)
    if (!st || !l) return
    record(st, l, m)
    if (m.drop) dropOldest(st, l, m.drop)
  }

  function record(st: Store, l: Link, m: Extract<AppMessage, { t: "action" }>) {
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
    if (m.n !== undefined) l.lastN = m.n
    // The app keeps running while paused; only openstate stops recording.
    if (opts.isPaused() && !m.fromDevtools) return
    st.actions.push(makeAction(st, m, l.seq++, last?.state, m.state, m.fromDevtools))
    while (st.actions.length > opts.maxAge()) st.actions.shift()
  }

  // --- Redux DevTools remote: SocketCluster framing ---------------------------------------------------------
  // Frames are JSON: {event, data, cid} to call or send, {rid, data} to answer. The app logs in as "master",
  // listens on channel "respond" and transmits "log" events with START, STATE, ACTION, STOP or ERROR.
  const publish = (ws: Socket, data: unknown) => ws.send(JSON.stringify({ event: "#publish", data: { channel: "respond", data } }))
  let socketIds = 0

  function onRemoteFrame(ws: Socket, packet: { event?: string; data?: any; cid?: number }) {
    const reply = (data?: unknown) => packet.cid !== undefined && ws.send(JSON.stringify({ rid: packet.cid, data }))
    switch (packet.event) {
      case "#handshake":
        // No pings from here, so the client must not expect them often: a pingTimeout of days.
        return reply({ id: `os${++socketIds}`, pingTimeout: 1e9, isAuthenticated: false })
      case "login":
        return reply("respond")
      case "log":
      case "log-noid":
        return onRemoteLog(ws, packet.data)
      default:
        // #subscribe, #unsubscribe and anything else that waits for an answer.
        return reply()
    }
  }

  function onRemoteLog(ws: Socket, m: { type: string; name?: string; payload?: string; action?: string; nextActionId?: number; isExcess?: boolean }) {
    if (m.type === "START") {
      const src = sourceFor(m.name || "remote app", ws.data.origin)
      ws.data.source = src
      const key = `${src.id}/redux`
      let st = src.stores.find((s) => s.key === key)
      if (!st) {
        const made: Store = { key, sourceId: src.id, lib: "remote", name: "redux", actions: [], commitId: null, locked: false, conn: null! }
        made.conn = liftedConn(made)
        st = made
        src.stores.push(st)
        const l: Link = { ws, instanceId: "redux", kind: "lifted", ids: new Map(), ignoreInit: false, seq: 0, unrecorded: new Set(), out: null!, expect: [] }
        l.out = remoteOut(l)
        links.set(st, l)
      }
      links.get(st)!.ws = ws
      // The app sends its history once it knows someone is watching.
      return publish(ws, { type: "START" })
    }
    const src = ws.data.source
    const st = src?.stores[0]
    const l = st && links.get(st)
    if (!st || !l) return
    if (m.type === "STATE" && m.payload) fromLifted(st, l, fromJsan(m.payload) as LiftedState)
    else if (m.type === "ACTION" && m.payload && m.action && m.nextActionId) {
      const perform = fromJsan(m.action) as { action: { type: string }; timestamp: number; stack?: string }
      const ours = l.expect.indexOf(perform.action.type)
      if (ours >= 0) l.expect.splice(ours, 1)
      record(st, l, {
        t: "action",
        id: "redux",
        action: perform.action,
        state: fromJsan(m.payload),
        time: perform.timestamp,
        stack: perform.stack,
        liftedId: m.nextActionId - 1,
        fromDevtools: ours >= 0,
      })
      // The app dropped its oldest action to stay within its maxAge; the first state moves up to it.
      const staged = l.lifted?.stagedActionIds.length ?? 0
      if (m.isExcess) l.cap ??= staged - 1
      if (l.cap !== undefined && staged > l.cap) dropOldest(st, l)
      // The app never says its maxAge; once it is full, the list length is it.
      if (m.isExcess) st.limit ??= st.actions.length
    }
  }

  // As the instrument does past maxAge: the n oldest actions after the first fold into it.
  function dropOldest(st: Store, l: Link, n = 1) {
    const ls = l.lifted
    if (!ls || ls.stagedActionIds.length < n + 2) return
    const gone = new Set(ls.stagedActionIds.splice(1, n))
    for (const id of gone) delete ls.actionsById[id]
    ls.skippedActionIds = ls.skippedActionIds.filter((id) => !gone.has(id))
    ls.computedStates.splice(0, n)
    ls.committedState = ls.computedStates[0]?.state
    ls.currentStateIndex = ls.stagedActionIds.length - 1
    const first = st.actions[0]
    if (!first) return
    first.state = first.prev = ls.committedState
    st.actions = [first, ...st.actions.slice(1).filter((a) => !gone.has(a.seq))]
  }

  function handle(ws: Socket, text: string) {
    // SocketCluster pongs ("" or "#2"): nothing to do, we never ping.
    if (text === "" || text === "#2") return
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      return
    }
    // Either protocol may batch several messages into one array.
    const batch = ([parsed].flat() as unknown[]).filter((x): x is object => typeof x === "object" && x !== null)
    ws.data.proto ??= batch[0] && "t" in batch[0] ? "openstate" : "remote"
    if (ws.data.proto === "remote") for (const p of batch) onRemoteFrame(ws, p)
    else for (const m of batch as AppMessage[]) onMessage(ws, m)
    opts.onChange()
  }

  function onMessage(ws: Socket, m: AppMessage) {
    if (m.t === "hello") onHello(ws, m)
    const src = ws.data.source
    if (!src) return
    if (m.t === "init") onInit(ws, src, m)
    else if (m.t === "action") onAction(src, m)
    else if (m.t === "lifted") {
      const st = src.stores.find((s) => s.key === `${src.id}/${m.id}`)
      if (st) fromLifted(st, links.get(st)!, m.lifted)
    }
  }

  return {
    sources,
    access,
    listen(port, lan) {
      const options = {
        port,
        fetch(req: Request, srv: Server<Conn>) {
          const ip = srv.requestIP(req)?.address
          // Another device has no page to name it by; it is asked about by its address.
          const device = ip && !isLoopback(ip) ? `tcp://${ip.includes(":") ? `[${ip}]` : ip}` : undefined
          if (srv.upgrade(req, { data: { source: null, origin: req.headers.get("origin") ?? device } })) return
          return new Response("openstate: connect with @openstate-devtools/client over WebSocket\n", { status: 426 })
        },
        websocket: {
          open(ws: Socket) {
            sockets.add(ws)
            admit(ws)
          },
          message(ws: Socket, raw: string | Buffer) {
            const text = String(raw)
            if (!waiting(ws)) return handle(ws, text)
            if (!ws.data.held) return
            // Past the limit a waiting page's frames are dropped; a yes then has it reconnect.
            ws.data.heldBytes = (ws.data.heldBytes ?? 0) + text.length
            if (ws.data.held.length < HELD_MAX && ws.data.heldBytes <= HELD_BYTES) return void ws.data.held.push(text)
            Object.assign(ws.data, { held: undefined, heldBytes: undefined, overflow: true })
          },
          close(ws: Socket) {
            sockets.delete(ws)
            // A page that gave up waiting: still listed, as it will try again.
            Object.assign(ws.data, { held: undefined, heldBytes: undefined, parked: undefined, overflow: undefined })
            recount()
              opts.onChange()
              const src = ws.data.source
              if (!src) return
              src.connected = false
              src.links.push({ time: Date.now(), connected: false })
              opts.onChange()
            },
          },
        }
      // Every address of this machine for lan; otherwise loopback only, IPv4 and IPv6 (`localhost` may be either).
      const bind = (port: number, lan: boolean) => {
        const out: Server<Conn>[] = []
        try {
          for (const hostname of lan ? ["0.0.0.0"] : ["127.0.0.1", "::1"]) {
            try {
              out.push(Bun.serve<Conn>({ ...options, port, hostname }))
            } catch (e) {
              // A machine without IPv6 still works on IPv4.
              if (hostname !== "::1" || (e as { code?: string }).code === "EADDRINUSE") throw e
            }
          }
          return out
        } catch (e) {
          for (const srv of out) srv.stop(true)
          throw e
        }
      }
      // The old servers go first, as the new ones may want the same port; on failure they come back.
      for (const srv of servers) srv.stop(true)
      try {
        servers = bind(port, lan)
        bound = { port, lan }
        return null
      } catch (e) {
        servers = []
        try {
          if (bound) servers = bind(bound.port, bound.lan)
        } catch {
          bound = null
        }
        const code = (e as { code?: string }).code
        return code === "EADDRINUSE" ? `port ${port} is in use` : (e as Error).message
      }
    },
    close() {
      for (const srv of servers) srv.stop(true)
      servers = []
      bound = null
    },
    setMaxAge(n) {
      // Remote apps set their own maxAge in their devtools options.
      for (const ws of sockets) if (ws.data.proto === "openstate") sendTo(ws, { t: "config", maxAge: n })
    },
  }
}

// jsan as Redux DevTools remote sends it. It restores shared objects and cycles alike; a cycle would send diffs and
// renders round forever, so each reference back up its own path becomes "[Circular]". Shared objects stay shared.
function fromJsan(text: string): any {
  const value = jsan.parse(text)
  const done = new WeakSet<object>()
  const path = new Set<object>()
  const walk = (v: Record<string, unknown>) => {
    if (done.has(v)) return
    path.add(v)
    for (const k of Object.keys(v)) {
      const x = v[k]
      if (!x || typeof x !== "object") continue
      if (path.has(x)) v[k] = "[Circular]"
      else walk(x as Record<string, unknown>)
    }
    path.delete(v)
    done.add(v)
  }
  if (value && typeof value === "object") walk(value as Record<string, unknown>)
  return value
}

const isLoopback = (ip: string) => ip === "::1" || ip.startsWith("127.") || ip.startsWith("::ffff:127.")

const actionOf = (a: { type: string; payload?: unknown }) => (a.payload === undefined ? { type: a.type } : { type: a.type, payload: a.payload })
