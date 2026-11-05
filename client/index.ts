// openstate client: stands in for the Redux DevTools browser extension and reports to openstate instead.
//
//   import "@openstate-devtools/client"   // first import of the app, before any store library
//
// Redux Toolkit's configureStore, redux's __REDUX_DEVTOOLS_EXTENSION_COMPOSE__, zustand's `devtools`
// middleware and jotai-devtools then connect without changes. Configure with install({ url, name }).
// The import does nothing in production builds and while Next renders on the server; install() still does.
import { instrument } from "@redux-devtools/instrument"
import type { StoreEnhancer } from "redux"
import { PROTOCOL, toJSON, type AppMessage, type Entry, type LiftedState, type ServerMessage } from "./protocol"

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
const runtime = typeof window !== "undefined" ? "browser" : g.Bun ? "bun" : "node"

// Each variable is read as written, `process.env.NAME`, because that is the text bundlers replace with
// its value; in a browser bundle without a `process` the read throws and counts as unset.
function read(get: () => string | undefined): string | undefined {
  try {
    return get()
  } catch {
    return undefined
  }
}
const env = {
  // NEXT_PUBLIC_ is how Next lets a variable reach the browser.
  url: read(() => process.env.OPENSTATE_URL) || read(() => process.env.NEXT_PUBLIC_OPENSTATE_URL),
  production: read(() => process.env.NODE_ENV) === "production",
  // Next sets NEXT_RUNTIME on the server. Rendering there, a lent `window` would make code take its browser path.
  nextServer: typeof window === "undefined" && !!read(() => process.env.NEXT_RUNTIME),
}

const config = {
  url: env.url || "ws://localhost:8000",
  name: defaultName(),
  maxAge: 500,
}
// Messages wait this long and leave as one frame; their states are serialized then, not on every action.
const LATENCY = 50
// Bytes the socket may hold unsent before the client waits for it to drain.
const BUFFER_MAX = 4 << 20
// Messages that may wait; a client further behind drops them and sends each store's init instead.
const QUEUE_MAX = 1000

const instances = new Map<string, Instance>()
let socket: WebSocket | null = null
let open = false
let retry = 0
let nextId = 1
let queue: AppMessage[] = []
let timer: ReturnType<typeof setTimeout> | null = null
let behind = false
let warned = false
const run = Math.random().toString(36).slice(2)
// True while openstate's own dispatch runs, so the resulting action is marked as coming from openstate.
let fromDevtools = false

function defaultName(): string {
  if (typeof location !== "undefined" && location.host) return location.host
  const script = typeof process !== "undefined" ? process.argv[1] : undefined
  return script ? (script.split(/[\\/]/).pop() ?? "app").replace(/\.[cm]?[jt]sx?$/, "") : "app"
}

// Queued while connected; while not, the init sent on connecting covers it.
function send(m: AppMessage) {
  if (!open) return
  // A whole lifted state replaces whatever that store had waiting.
  if (m.t === "lifted") queue = queue.filter((q) => !((q.t === "action" || q.t === "lifted") && q.id === m.id))
  queue.push(m)
  if (queue.length > QUEUE_MAX) {
    queue = []
    behind = true
  }
  timer ??= setTimeout(flush, LATENCY)
}

function flush() {
  timer = null
  if (!open) return
  // openstate is slower than the app: wait for the socket to drain, then catch up.
  if (socket!.bufferedAmount > BUFFER_MAX) return void (timer = setTimeout(flush, LATENCY))
  if (behind) {
    behind = false
    queue = inits()
  }
  const out = queue
  queue = []
  if (out.length) socket!.send(toJSON(out.length === 1 ? out[0] : out))
}

const inits = () => [...instances.values()].flatMap((inst) => inst.init() ?? [])

function connect() {
  if (typeof WebSocket === "undefined") return console.warn("[openstate] no WebSocket in this runtime; nothing is reported")
  const ws = new WebSocket(config.url)
  socket = ws
  ws.onopen = () => {
    open = true
    retry = 0
    queue = []
    behind = false
    ws.send(toJSON([{ t: "hello", v: PROTOCOL, app: config.name, runtime, run }, ...inits()]))
  }
  ws.onmessage = (e) => {
    let m: ServerMessage
    try {
      m = JSON.parse(String(e.data))
    } catch {
      return
    }
    if (m.t === "config") {
      config.maxAge = m.maxAge
      if (m.v !== PROTOCOL && !warned) {
        warned = true
        console.warn(`[openstate] openstate speaks protocol ${m.v ?? 0}, this @openstate-devtools/client ${PROTOCOL}; update the older one`)
      }
    } else instances.get(m.id)?.onServer(m)
  }
  ws.onclose = () => {
    if (socket !== ws) return
    open = false
    queue = []
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
      // One appended action goes alone, with how many old ones maxAge pushed out; anything else (skip,
      // sweep, reorder…) sends it all.
      const ids = cur.stagedActionIds
      const was = prev.stagedActionIds
      const drop = was.length + 1 - ids.length
      const appended =
        drop >= 0 &&
        ids.length >= 2 &&
        ids[ids.length - 2] === was[was.length - 1] &&
        (drop === 0
          ? cur.committedState === prev.committedState && cur.skippedActionIds === prev.skippedActionIds
          : ids[1] === was[drop + 1])
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
          drop: drop || undefined,
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
  // The state before the kept history, and the history: the last maxAge actions, sent again on (re)connect.
  let base: unknown
  let history: Entry[] = []
  let started = false
  let n = 0
  const name = options.name ?? `store ${nextId}`
  const inst = register((id) => ({
    id,
    init: () => (started ? { t: "init", id, name, lib: guessLib(name), kind: "connect", state: base, history: [...history] } : null),
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
      // Also how zustand answers openstate's rollback or import: a new start, as openstate already knows.
      base = initial
      history = []
      started = true
      send(inst.init()!)
    },
    send(action: string | { type: string } | null, next: unknown) {
      // send(null, liftedState) is how zustand acknowledges an import; there is nothing new to record.
      if (action === null) return
      if (!started) {
        base = next
        started = true
        send(inst.init()!)
      }
      const entry: Entry = {
        n: n++,
        action: typeof action === "string" ? { type: action } : action,
        state: next,
        time: Date.now(),
        stack: new Error().stack?.split("\n").slice(2, 12).join("\n"),
        fromDevtools,
      }
      history.push(entry)
      while (history.length > config.maxAge) base = history.shift()!.state
      send({ t: "action", id: inst.id, ...entry })
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

// On import, for development only: a production build would have every visitor's browser try localhost.
if (!env.production && !env.nextServer) install()
