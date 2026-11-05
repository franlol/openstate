// Messages between an app (through @openstate/client) and openstate, one JSON object per WebSocket frame.
// Redux stores send Redux DevTools' lifted state and take lifted actions back, so the app keeps the
// history and recomputes; other stores only report action + state, and openstate keeps their history.

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
  | { t: "hello"; app: string; runtime: string }
  // A store appeared or the socket reconnected. `kind` says who owns the history.
  | { t: "init"; id: string; name: string; lib: string; kind: "lifted"; lifted: LiftedState }
  | { t: "init"; id: string; name: string; lib: string; kind: "connect"; state: unknown }
  // One new action. `liftedId` is its id in the lifted state, for lifted stores.
  | {
      t: "action"
      id: string
      action: { type: string; [k: string]: unknown }
      state: unknown
      time: number
      stack?: string
      liftedId?: number
      fromDevtools?: boolean
    }
  // The whole lifted state, after anything other than one appended action.
  | { t: "lifted"; id: string; lifted: LiftedState }

export type ServerMessage =
  | { t: "config"; maxAge: number }
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
