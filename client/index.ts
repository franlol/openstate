// openstate client: stands in for the Redux DevTools browser extension and reports to openstate instead.
//
//   import "openstate/client"   // first import of the app, before any store library
//
// Redux Toolkit's configureStore, redux's __REDUX_DEVTOOLS_EXTENSION_COMPOSE__, zustand's `devtools`
// middleware and jotai-devtools then connect without changes. Configure with install({ url, name }).
import { instrument } from "@redux-devtools/instrument"
import type { StoreEnhancer } from "redux"
import { toJSON, type AppMessage, type LiftedState, type ServerMessage } from "./protocol"

export type ClientOptions = {
  // Where openstate listens; OPENSTATE_URL in the environment also sets it.
  url?: string
  // How the app shows in openstate's sources panel.
  name?: string
}

type Instance = {
  id: string
  // Sent on every (re)connect so openstate has the whole picture.
  init: () => AppMessage | null
  onServer: (m: ServerMessage) => void
}

const g = globalThis as any
const env = typeof process !== "undefined" ? process.env : {}
const runtime = typeof window !== "undefined" ? "browser" : g.Bun ? "bun" : "node"

const config = {
  url: env.OPENSTATE_URL || "ws://localhost:8000",
  name: defaultName(),
  maxAge: 500,
}
const instances = new Map<string, Instance>()
let socket: WebSocket | null = null
let open = false
let retry = 0
let nextId = 1
// True while openstate's own dispatch runs, so the resulting action is marked as coming from openstate.
let fromDevtools = false

function defaultName(): string {
  if (typeof location !== "undefined" && location.host) return location.host
  const script = typeof process !== "undefined" ? process.argv[1] : undefined
  return script ? (script.split(/[\\/]/).pop() ?? "app").replace(/\.[cm]?[jt]sx?$/, "") : "app"
}

function send(m: AppMessage) {
  if (open) socket!.send(toJSON(m))
}

function connect() {
  if (typeof WebSocket === "undefined") return console.warn("[openstate] no WebSocket in this runtime; nothing is reported")
  const ws = new WebSocket(config.url)
  socket = ws
  ws.onopen = () => {
    open = true
    retry = 0
    send({ t: "hello", app: config.name, runtime })
    for (const inst of instances.values()) {
      const m = inst.init()
      if (m) send(m)
    }
  }
  ws.onmessage = (e) => {
    const m = JSON.parse(String(e.data)) as ServerMessage
    if (m.t === "config") config.maxAge = m.maxAge
    else instances.get(m.id)?.onServer(m)
  }
  ws.onclose = () => {
    if (socket !== ws) return
    open = false
    // Keep retrying quietly: openstate may start after the app, or restart.
    setTimeout(connect, Math.min(5000, 500 * 2 ** retry++))
  }
  ws.onerror = () => {}
}

function register(make: (id: string) => Instance): Instance {
  const inst = make(String(nextId++))
  instances.set(inst.id, inst)
  return inst
}

// --- redux: the extension's enhancer, built on the same instrument ------------------------------------
type EnhancerOptions = { name?: string; trace?: boolean; traceLimit?: number }

function enhancer(options: EnhancerOptions = {}): StoreEnhancer {
  return (next: any) => (reducer: any, preloaded?: any) => {
    const store = instrument(undefined, {
      maxAge: () => config.maxAge,
      trace: options.trace ?? true,
      traceLimit: options.traceLimit ?? 10,
    })(next)(reducer, preloaded) as any
    const lifted = store.liftedStore
    const inst = register((id) => ({
      id,
      init: () => ({ t: "init", id, name: options.name ?? "redux", lib: "redux", kind: "lifted", lifted: lifted.getState() }),
      onServer: (m) => {
        if (m.t === "lifted") lifted.dispatch(m.action)
        else if (m.t === "dispatch") devtoolsDispatch(() => store.dispatch(m.action))
      },
    }))
    let prev: LiftedState = lifted.getState()
    lifted.subscribe(() => {
      const cur: LiftedState = lifted.getState()
      if (cur === prev) return
      // One appended action goes alone; anything else (skip, sweep, trimming by maxAge…) sends it all.
      const ids = cur.stagedActionIds
      const appended =
        ids.length === prev.stagedActionIds.length + 1 &&
        cur.committedState === prev.committedState &&
        cur.skippedActionIds === prev.skippedActionIds &&
        ids[ids.length - 2] === prev.stagedActionIds[prev.stagedActionIds.length - 1]
      if (appended) {
        const liftedId = ids[ids.length - 1]!
        const entry = cur.actionsById[liftedId]!
        send({
          t: "action",
          id: inst.id,
          action: entry.action,
          state: cur.computedStates[cur.computedStates.length - 1]?.state,
          time: entry.timestamp,
          stack: entry.stack,
          liftedId,
          fromDevtools,
        })
      } else send({ t: "lifted", id: inst.id, lifted: cur })
      prev = cur
    })
    send(inst.init()!)
    return store
  }
}

function devtoolsDispatch(run: () => void) {
  fromDevtools = true
  try {
    run()
  } finally {
    fromDevtools = false
  }
}

// --- connect(): zustand, jotai-devtools and hand-written integrations -------------------------------------
type Listener = (message: any) => void

function connectApi(options: { name?: string } = {}) {
  const listeners = new Set<Listener>()
  let state: unknown
  let started = false
  const name = options.name ?? `store ${nextId}`
  const inst = register((id) => ({
    id,
    init: () => (started ? { t: "init", id, name, lib: guessLib(name), kind: "connect", state } : null),
    onServer: (m) => {
      if (m.t !== "message") return
      // An ACTION message makes the app dispatch; whatever it sends back comes from openstate.
      devtoolsDispatch(() => {
        for (const l of listeners) l(m.message)
      })
    },
  }))
  return {
    init(initial: unknown) {
      state = initial
      started = true
      send(inst.init()!)
    },
    send(action: string | { type: string } | null, next: unknown) {
      // send(null, liftedState) is how zustand acknowledges an import; there is nothing new to record.
      if (action === null) return
      state = next
      if (!started) {
        started = true
        send(inst.init()!)
      }
      send({
        t: "action",
        id: inst.id,
        action: typeof action === "string" ? { type: action } : action,
        state: next,
        time: Date.now(),
        stack: new Error().stack?.split("\n").slice(2, 12).join("\n"),
        fromDevtools,
      })
    },
    subscribe(listener: Listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    unsubscribe() {
      listeners.clear()
    },
    error(message: string) {
      console.warn(`[openstate] ${name}: ${message}`)
    },
  }
}

const guessLib = (name: string) => (/jotai/i.test(name) ? "jotai" : /zustand/i.test(name) ? "zustand" : "store")

// --- the global the libraries look for -------------------------------------------------------------------
// __REDUX_DEVTOOLS_EXTENSION_COMPOSE__({ name })(...enhancers), or called with the enhancers directly.
function compose(...args: any[]): any {
  const withOptions = (options: EnhancerOptions) => (...fns: any[]) => (next: any) =>
    fns.reduceRight((composed, f) => f(composed), enhancer(options)(next))
  if (args.length === 0) return enhancer()
  if (args.length === 1 && typeof args[0] === "object") return withOptions(args[0])
  return withOptions({})(...args)
}

const extension = Object.assign((options?: EnhancerOptions) => enhancer(options), {
  connect: connectApi,
  disconnect() {},
  open() {},
  notifyErrors() {},
  send() {},
})

export function install(options: ClientOptions = {}) {
  if (options.url) config.url = options.url
  if (options.name) config.name = options.name
  // Libraries check `window.__REDUX_DEVTOOLS_EXTENSION__`; outside a browser there is no window, so lend them one.
  if (typeof g.window === "undefined") g.window = g
  g.window.__REDUX_DEVTOOLS_EXTENSION__ = extension
  g.window.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__ = compose
  if (socket) {
    // New URL or name: reconnect so openstate sees it.
    const old = socket
    socket = null
    open = false
    old.close()
  }
  connect()
}

install()
