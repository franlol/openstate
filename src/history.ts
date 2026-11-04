// Export and import a store's history in Redux DevTools' file format, so files move between
// openstate and the browser extension in both directions.
import type { History, Store } from "./model"

type LiftedAction = { type: string; action: Record<string, unknown>; timestamp?: number; stack?: string }
type Lifted = {
  actionsById: Record<string, LiftedAction>
  computedStates?: { state: unknown; error?: string }[]
  committedState?: unknown
  currentStateIndex?: number
  nextActionId?: number
  skippedActionIds?: number[]
  stagedActionIds?: number[]
  isLocked?: boolean
  isPaused?: boolean
}

// Toolkit-style actions carry `payload`; plain Redux ones spread their fields next to `type`.
export function splitAction(action: Record<string, unknown>): { type: string; payload: unknown } {
  const { type, ...rest } = action
  const payload = "payload" in rest ? rest.payload : Object.keys(rest).length ? rest : undefined
  return { type: String(type), payload }
}

export const parseStack = (stack: string | undefined) =>
  stack ? stack.split("\n").map((l) => l.trim()).filter((l) => l && l !== "Error") : []

// The extension saves `{ payload, preloadedState }` with the lifted state stringified inside `payload`.
export function exportHistory(st: Store): string {
  const actionsById: Record<string, LiftedAction> = {}
  st.actions.forEach((a, i) => {
    const action: Record<string, unknown> = { type: a.type }
    if (a.payload !== undefined) action.payload = a.payload
    actionsById[i] = { type: "PERFORM_ACTION", action, timestamp: a.time, stack: a.trace.join("\n") }
  })
  const lifted: Lifted = {
    actionsById,
    computedStates: st.actions.map((a) => ({ state: a.state })),
    committedState: st.actions[0]?.state,
    currentStateIndex: st.actions.length - 1,
    nextActionId: st.actions.length,
    skippedActionIds: st.actions.flatMap((a, i) => (a.skipped ? [i] : [])),
    stagedActionIds: st.actions.map((_, i) => i),
    isLocked: st.locked,
    isPaused: false,
  }
  return JSON.stringify({ payload: JSON.stringify(lifted), preloadedState: JSON.stringify(st.actions[0]?.state) }, null, 2)
}

// Accepts the extension's wrapped file or a bare lifted state. Throws with a short reason.
export function importHistory(text: string): History {
  let raw: any
  try {
    raw = JSON.parse(text)
  } catch (e) {
    throw new Error(`not JSON (${String((e as Error).message).replace(/^JSON Parse error: /, "")})`)
  }
  const lifted: Lifted = typeof raw?.payload === "string" ? JSON.parse(raw.payload) : raw
  if (!lifted || typeof lifted.actionsById !== "object") throw new Error("not a Redux DevTools export (no actionsById)")
  const ids = lifted.stagedActionIds ?? Object.keys(lifted.actionsById).map(Number).sort((a, b) => a - b)
  const skipped = new Set(lifted.skippedActionIds ?? [])
  const states = lifted.computedStates
  const actions = ids.map((id, i) => {
    const entry = lifted.actionsById[id]
    if (!entry?.action || typeof entry.action.type !== "string") throw new Error(`action ${id} has no type`)
    return {
      ...splitAction(entry.action),
      time: entry.timestamp ?? Date.now(),
      trace: parseStack(entry.stack),
      skipped: skipped.has(id),
      state: states?.[i]?.state,
    }
  })
  if (!actions.length) throw new Error("the file has no actions")
  return { actions, hasStates: !!states && states.length === ids.length }
}
