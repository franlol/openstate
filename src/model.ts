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
}

export type Store = {
  key: string
  sourceId: string
  lib: Lib
  name: string
  actions: Action[]
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

const changeCache = new WeakMap<Action, number>()

// Number of leaf changes an action made; actions are immutable, so it is cached.
export function changeCount(a: Action): number {
  let n = changeCache.get(a)
  if (n === undefined) changeCache.set(a, (n = diff(a.prev, a.state).length))
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
