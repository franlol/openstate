export type Lib = "redux" | "zustand" | "jotai"

export type Action = {
  id: number
  seq: number
  storeKey: string
  type: string
  payload: unknown
  time: number
  prev: unknown
  state: unknown
  trace: string[]
  skipped: boolean
  // Dispatched from openstate instead of by the app itself.
  fromDevtools?: boolean
}

export type ActionInput = { type: string; payload?: unknown }

// A history loaded from a file. States are kept when the file has one per action; otherwise the app replays them.
export type History = {
  actions: (ActionInput & { time: number; trace: string[]; skipped: boolean; state: unknown })[]
  hasStates: boolean
}

// What openstate can ask a connected store to do. It mirrors Redux DevTools' lifted
// actions: the app owns the history and recomputes states after each change.
export interface StoreConn {
  dispatch(action: ActionInput): void
  // Skip or restore an action; later states are recomputed without it.
  toggle(id: number): void
  // That action's state becomes the base revert returns to; null resets to the initial state.
  commit(id: number | null): void
  // Drop every action after the commit (or after init) and restore that state.
  revert(): void
  // Move an action in front of another one (null: to the end); later states are recomputed.
  reorder(id: number, beforeId: number | null): void
  // Remove skipped actions for good.
  sweep(): void
  // While locked the app's own dispatches are ignored.
  lock(on: boolean): void
  // Replace the whole history, like the extension's import.
  import(history: History): void
}

export type Store = {
  key: string
  sourceId: string
  lib: Lib
  name: string
  actions: Action[]
  // Id of the last committed action; revert returns to its state.
  commitId: number | null
  locked: boolean
  conn: StoreConn
}

export type Source = {
  id: string
  name: string
  color: number
  connected: boolean
  // Connection history, oldest first; drawn as offline spans on the track.
  links: { time: number; connected: boolean }[]
  stores: Store[]
}

export type Change = { path: string; before: unknown; after: unknown }

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null

const changeCache = new WeakMap<Action, { prev: unknown; state: unknown; n: number }>()

// Number of leaf changes an action made. Cached until skip or revert recomputes its states.
export function changeCount(a: Action): number {
  const c = changeCache.get(a)
  if (c && c.prev === a.prev && c.state === a.state) return c.n
  const n = diff(a.prev, a.state).length
  changeCache.set(a, { prev: a.prev, state: a.state, n })
  return n
}

// Leaf-level structural diff, keyed by dotted paths ("cart.items.1.qty").
export function diff(a: unknown, b: unknown, path = ""): Change[] {
  if (Object.is(a, b)) return []
  if (isObj(a) && isObj(b) && Array.isArray(a) === Array.isArray(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    const out: Change[] = []
    for (const k of keys) out.push(...diff(a[k], b[k], path ? `${path}.${k}` : k))
    return out
  }
  return [{ path, before: a, after: b }]
}

// Value at a dotted path ("cart.items.1"); undefined when any segment is missing.
export function getPath(value: unknown, path: string): unknown {
  let v = value
  for (const k of path ? path.split(".") : []) {
    if (!isObj(v)) return undefined
    v = v[k]
  }
  return v
}

export function preview(v: unknown, max = 40): string {
  let s: string
  if (v === undefined) s = "undefined"
  else if (typeof v === "string") s = JSON.stringify(v)
  else if (Array.isArray(v)) s = `Array(${v.length})`
  else if (isObj(v)) {
    const inner = Object.entries(v)
      .map(([k, x]) => `${k}: ${isObj(x) ? (Array.isArray(x) ? `[…${x.length}]` : "{…}") : preview(x, 12)}`)
      .join(", ")
    s = `{${inner}}`
  } else s = String(v)
  return s.length > max ? s.slice(0, max - 1) + "…" : s
}

export type TreeRow = {
  path: string
  key: string
  depth: number
  value: unknown
  branch: boolean
  open: boolean
}

export function flatten(value: unknown, expanded: Set<string>, path = "", depth = 0): TreeRow[] {
  if (!isObj(value)) return []
  const rows: TreeRow[] = []
  for (const [k, v] of Object.entries(value)) {
    const p = path ? `${path}.${k}` : k
    const branch = isObj(v)
    const open = branch && expanded.has(p)
    rows.push({ path: p, key: k, depth, value: v, branch, open })
    if (open) rows.push(...flatten(v, expanded, p, depth + 1))
  }
  return rows
}

export function clock(t: number): string {
  const d = new Date(t)
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":")
}

// Time since the previous action, 8 columns wide like the clock: "  +0.12s", "  +12.3s", " +2m05s".
export function since(ms: number): string {
  const sign = ms < 0 ? "-" : "+"
  const a = Math.abs(ms) / 1000
  let s: string
  if (a < 10) s = `${a.toFixed(2)}s`
  else if (a < 60) s = `${a.toFixed(1)}s`
  else if (a < 3600) s = `${Math.floor(a / 60)}m${String(Math.floor(a % 60)).padStart(2, "0")}s`
  else s = `${Math.floor(a / 3600)}h${String(Math.floor((a % 3600) / 60)).padStart(2, "0")}m`
  return (sign + s).padStart(8)
}

export type JsonLine = { text: string; path: string }

// JSON.stringify(value, null, 2) split into lines, each tagged with the dotted path it belongs to,
// so the raw view can mark lines the same way the tree marks keys. Closing brackets share their opener's path.
export function jsonLines(value: unknown): JsonLine[] {
  const out: JsonLine[] = []
  const walk = (v: unknown, path: string, indent: string, head: string, tail: string) => {
    if (isObj(v) && typeof (v as { toJSON?: unknown }).toJSON === "function") v = (v as { toJSON: () => unknown }).toJSON()
    const arr = Array.isArray(v)
    const entries: [string, unknown][] = !isObj(v)
      ? []
      : arr
        ? (v as unknown as unknown[]).map((x, i) => [String(i), x === undefined || typeof x === "function" ? null : x])
        : Object.entries(v).filter(([, x]) => x !== undefined && typeof x !== "function" && typeof x !== "symbol")
    if (!isObj(v) || !entries.length) {
      const text = isObj(v) ? (arr ? "[]" : "{}") : (JSON.stringify(v) ?? "null")
      out.push({ text: indent + head + text + tail, path })
      return
    }
    out.push({ text: indent + head + (arr ? "[" : "{"), path })
    entries.forEach(([k, x], i) => {
      const key = arr ? "" : `${JSON.stringify(k)}: `
      walk(x, path ? `${path}.${k}` : k, indent + "  ", key, i < entries.length - 1 ? "," : "")
    })
    out.push({ text: indent + (arr ? "]" : "}") + tail, path })
  }
  walk(value ?? null, "", "", "", "")
  return out
}
