// Shown next to the store name: "redux" for stores instrumented like the extension does, otherwise what the app reported.
export type Lib = string

let lastActionId = 0
// Action ids are unique across every store, so the cursor and React keys never collide.
export const newActionId = () => ++lastActionId

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
// A store that cannot do something (zustand has no reducer to replay) throws an Error saying so.
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
  // Actions the app keeps when it sets its own limit (Redux DevTools remote); otherwise `:set maxage`.
  limit?: number
  conn: StoreConn
}

export type Source = {
  id: string
  name: string
  color: number
  connected: boolean
  // The web page it runs in (https://shop.dev), from the browser's Origin header; none outside a browser.
  origin?: string
  // Connection history, oldest first; drawn as offline spans on the track.
  links: { time: number; connected: boolean }[]
  stores: Store[]
}

// Any page open in the browser can reach localhost, so a page from elsewhere waits for a yes before it gets in.
// Pages on this machine and apps outside a browser come straight in; a "no" is kept, so it can be undone later.
export type Origin = {
  origin: string
  access: "pending" | "blocked"
  tries: number
  time: number
  // Sockets from it open right now: a yes lets them in at once.
  live: number
}
export type Access = {
  origins: Origin[]
  allow(origin: string): void
  block(origin: string): void
  // Back to unknown: its next try asks again.
  forget(origin: string): void
  // Cuts a connected app off; a page from elsewhere is asked about again if it comes back.
  disconnect(src: Source): void
}

// What the list shows for an origin: the host, as the scheme says little.
export const hostOf = (origin: string) => origin.replace(/^[a-z]+:\/\//, "")
export const isLocal = (origin: string) => /^[a-z]+:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)

export type Change = { path: string; before: unknown; after: unknown }

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null

const changeCache = new WeakMap<Action, { prev: unknown; state: unknown; n: number }>()

// Number of leaf changes an action made. Cached until skip or revert recomputes its states.
export function changeCount(a: Action): number {
  const c = changeCache.get(a)
  if (c && c.prev === a.prev && c.state === a.state) return c.n
  const n = countChanges(a.prev, a.state)
  changeCache.set(a, { prev: a.prev, state: a.state, n })
  return n
}

// What diff(a, b).length would be, without building paths: states from remote apps share no objects, so every
// count walks the whole state.
function countChanges(a: unknown, b: unknown): number {
  if (Object.is(a, b)) return 0
  if (!isObj(a) || !isObj(b) || Array.isArray(a) !== Array.isArray(b)) return 1
  let n = 0
  for (const k in a) n += countChanges(a[k], b[k])
  for (const k in b) if (!(k in a) && b[k] !== undefined) n++
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

// States are never changed in place, so an object's preview holds for as long as the object lives.
const previews = new WeakMap<object, Map<number, string>>()

export function preview(v: unknown, max = 40): string {
  if (!isObj(v)) return previewOf(v, max)
  let byMax = previews.get(v)
  if (!byMax) previews.set(v, (byMax = new Map()))
  let s = byMax.get(max)
  if (s === undefined) byMax.set(max, (s = previewOf(v, max)))
  return s
}

function previewOf(v: unknown, max: number): string {
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

// Per second: every row of the action list asks on every render.
const clocks = new Map<number, string>()

export function clock(t: number): string {
  const sec = Math.floor(t / 1000)
  let s = clocks.get(sec)
  if (s === undefined) {
    const d = new Date(t)
    s = [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":")
    if (clocks.size > 10_000) clocks.clear()
    clocks.set(sec, s)
  }
  return s
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
