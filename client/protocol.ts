// Messages between an app (through @openstate/client) and openstate, as JSON: one object per WebSocket frame,
// or an array of them when the client sends a batch. Redux stores send Redux DevTools' lifted state and take
// lifted actions back, so the app keeps the history and recomputes; other stores report action + state, and
// keep a short history of their own so a reconnect loses nothing.

// Bumped only for changes an older peer would misread; both sides ignore fields and messages they do not know.
export const PROTOCOL = 1

export type LiftedState = {
  actionsById: Record<number, { type: "PERFORM_ACTION"; action: { type: string; [k: string]: unknown }; timestamp: number; stack?: string }>
  computedStates: { state: unknown; error?: string }[]
  stagedActionIds: number[]
  skippedActionIds: number[]
  committedState: unknown
  currentStateIndex: number
  nextActionId: number
  isLocked: boolean
  isPaused: boolean
  monitorState?: unknown
}

export type AppMessage =
  // `run` is new on every start of the app, so openstate can tell a reconnect from a reload.
  | { t: "hello"; v: number; app: string; runtime: string; run: string }
  // A store appeared, the socket reconnected, or the client fell behind and starts over. `kind` says who
  // owns the history. Connect stores send their recent actions (`history`, oldest first) and the state
  // before them, so openstate can fill in what it missed.
  | { t: "init"; id: string; name: string; lib: string; kind: "lifted"; lifted: LiftedState }
  | { t: "init"; id: string; name: string; lib: string; kind: "connect"; state: unknown; history: Entry[] }
  // One new action. `liftedId` is its id in the lifted state, for lifted stores; `drop` how many of the
  // oldest actions (after the first) the app let go to stay within maxAge, folding them into the first.
  // `n` numbers a connect store's actions, so a reconnect can tell which ones openstate already has.
  | {
      t: "action"
      id: string
      action: { type: string; [k: string]: unknown }
      state: unknown
      time: number
      stack?: string
      liftedId?: number
      drop?: number
      n?: number
      fromDevtools?: boolean
    }
  // The whole lifted state, after anything other than one appended action.
  | { t: "lifted"; id: string; lifted: LiftedState }

// A connect store's action as kept by the client.
export type Entry = { n: number; action: { type: string; [k: string]: unknown }; state: unknown; time: number; stack?: string; fromDevtools?: boolean }

export type ServerMessage =
  | { t: "config"; v?: number; maxAge: number }
  // A lifted action (TOGGLE_ACTION, SWEEP, IMPORT_STATE…) for a lifted store.
  | { t: "lifted"; id: string; action: { type: string; [k: string]: unknown } }
  // An action to run in the app, as typed in openstate's dispatch card.
  | { t: "dispatch"; id: string; action: { type: string; [k: string]: unknown } }
  // A message in the extension's own format ({ type: "DISPATCH", payload, state }), for connect() listeners.
  | { t: "message"; id: string; message: unknown }

// JSON for app state that may hold what JSON cannot: cycles, functions, Map, Set, BigInt.
// Shared references are fine; only real cycles become "[Circular]".
export function toJSON(value: unknown): string {
  const stack: object[] = []
  const walk = (v: unknown): unknown => {
    if (typeof v === "bigint") return `${v}n`
    if (typeof v === "function") return `[Function ${v.name || "anonymous"}]`
    if (typeof v === "symbol") return v.toString()
    if (v === null || typeof v !== "object") return v
    if (stack.includes(v)) return "[Circular]"
    if (typeof (v as { toJSON?: unknown }).toJSON === "function") return walk((v as { toJSON: () => unknown }).toJSON())
    stack.push(v)
    let out: unknown
    if (v instanceof Map) out = Object.fromEntries([...v].map(([k, x]) => [String(k), walk(x)]))
    else if (v instanceof Set) out = [...v].map(walk)
    else if (Array.isArray(v)) out = v.map(walk)
    else out = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]))
    stack.pop()
    return out
  }
  return JSON.stringify(walk(value))
}
