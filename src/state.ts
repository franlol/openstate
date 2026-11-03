import { diff, flatten, type Action, type Change, type Source, type Store, type TreeRow } from "./model"
import { startMock } from "./mock"
import { findTheme, themes, type Theme } from "./theme"

export type Focus = "sources" | "actions" | "inspector"
export type Tab = "state" | "action" | "diff" | "trace"
export type Mode = "normal" | "filter" | "command"
export const TABS: Tab[] = ["state", "action", "diff", "trace"]
export const FOCI: Focus[] = ["sources", "actions", "inspector"]
export const MERGED = "*"

type View = {
  // Selected action id; null follows the newest action (live).
  cursor: number | null
  expanded: Set<string>
  collapsed: Set<string>
  treeCursor: number
  // Start time of the track's visible window; it only moves to keep the cursor in view.
  trackFrom: number | null
}

export type SourceRow = { kind: "source"; source: Source } | { kind: "store"; source: Source; store: Store }

export type Command = { name: string; desc: string; run: (s: AppState, arg: string) => void }

export const commands: Command[] = [
  { name: "theme", desc: "pick a theme (or :theme <name>)", run: (s, arg) => (arg ? s.setTheme(arg) : s.openPicker()) },
  { name: "merge", desc: "toggle merged timeline of all apps", run: (s) => s.toggleMerge() },
  { name: "pause", desc: "pause / resume recording", run: (s) => s.togglePause() },
  { name: "skip", desc: "skip the selected action", run: (s) => s.toggleSkip() },
  { name: "live", desc: "jump back to the newest action", run: (s) => s.goLive() },
  { name: "clear", desc: "clear actions of the current store", run: (s) => s.clearStore() },
  { name: "help", desc: "show keybindings", run: (s) => (s.help = true) },
  { name: "quit", desc: "exit openstate", run: (s) => s.quit() },
]

const FLASH_MS = 900
const MIN_W: Record<Focus, number> = { sources: 16, actions: 28, inspector: 30 }
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

export class AppState {
  sources: Source[]
  theme: Theme = themes[0]!
  focus: Focus = "actions"
  tab: Tab = "state"
  mode: Mode = "normal"
  input = ""
  filter = ""
  merge = false
  paused = false
  help = false
  picker: { index: number; prev: string } | null = null
  activeKey: string
  srcCursor = 1
  cmdIndex = 0
  pending: string | null = null
  message: { text: string; until: number } | null = null
  unseen = new Map<string, number>()
  // Flash timestamps for changed tree paths and freshly arrived action ids.
  flashPaths = new Map<string, number>()
  flashActions = new Map<number, number>()
  splashUntil = Date.now() + 1800
  // Panel widths in cells; a null actions width means the default split.
  layout: { sources: number; actions: number | null } = { sources: 24, actions: null }
  // Border being dragged with the mouse: the panel on its left.
  dragging: "sources" | "actions" | null = null
  screenW = 120
  // Track cell under the mouse.
  hover: { cell: number } | null = null
  // Seconds shown by the main track, set when it renders; H/L travel half of it.
  trackSpan = 60
  onQuit: () => void = () => {}

  private views = new Map<string, View>()
  private lastSeen = new Map<string, number>()
  private listeners = new Set<() => void>()
  private version = 0
  private animTimer: ReturnType<typeof setInterval> | null = null

  constructor() {
    this.sources = startMock(() => this.onData(), () => this.paused)
    this.activeKey = this.sources[0]!.stores[0]!.key
    for (const st of this.allStores()) this.lastSeen.set(st.key, st.actions.length)
  }

  // --- subscription -------------------------------------------------------
  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  snapshot = () => this.version
  emit() {
    this.version++
    for (const fn of this.listeners) fn()
  }

  // --- data ---------------------------------------------------------------
  allStores(): Store[] {
    return this.sources.flatMap((s) => s.stores)
  }
  store(key = this.activeKey): Store | undefined {
    return this.allStores().find((s) => s.key === key)
  }
  sourceOf(key: string): Source | undefined {
    return this.sources.find((s) => s.stores.some((st) => st.key === key))
  }
  view(key = this.viewKey()): View {
    let v = this.views.get(key)
    if (!v) {
      v = { cursor: null, expanded: new Set(), collapsed: new Set(), treeCursor: 0, trackFrom: null }
      this.views.set(key, v)
    }
    return v
  }
  viewKey() {
    return this.merge ? MERGED : this.activeKey
  }

  timeline(): Action[] {
    const all = this.merge
      ? this.allStores()
          .flatMap((s) => s.actions)
          .sort((a, b) => a.time - b.time || a.id - b.id)
      : (this.store()?.actions ?? [])
    if (!this.filter) return all
    const f = this.filter.toLowerCase()
    return all.filter((a) => a.type.toLowerCase().includes(f))
  }

  selected(): Action | undefined {
    const tl = this.timeline()
    const v = this.view()
    if (v.cursor === null) return tl[tl.length - 1]
    return tl.find((a) => a.id === v.cursor) ?? tl[tl.length - 1]
  }
  selectedIndex(): number {
    const tl = this.timeline()
    const sel = this.selected()
    return sel ? tl.indexOf(sel) : -1
  }
  changes(): Change[] {
    const a = this.selected()
    return a ? diff(a.prev, a.state) : []
  }

  sourceRows(): SourceRow[] {
    return this.sources.flatMap((source) => [
      { kind: "source" as const, source },
      ...source.stores.map((store) => ({ kind: "store" as const, source, store })),
    ])
  }

  private onData() {
    const now = Date.now()
    for (const st of this.allStores()) {
      const seen = this.lastSeen.get(st.key) ?? 0
      const last = st.actions[st.actions.length - 1]
      const total = last ? last.seq + 1 : 0
      if (total <= seen) continue
      const fresh = st.actions.slice(-(total - seen))
      this.lastSeen.set(st.key, total)
      const visible = this.merge || st.key === this.activeKey
      if (!visible) this.unseen.set(st.key, (this.unseen.get(st.key) ?? 0) + fresh.length)
      for (const a of fresh) this.flashActions.set(a.id, now)
      if (visible && this.view().cursor === null) {
        for (const c of diff(fresh[0]!.prev, fresh[fresh.length - 1]!.state)) {
          const parts = c.path.split(".")
          for (let i = 1; i <= parts.length; i++) this.flashPaths.set(parts.slice(0, i).join("."), now)
        }
      }
    }
    this.animate()
    this.emit()
  }

  // Re-render while flashes fade, then stop the timer.
  private animate() {
    if (this.animTimer) return
    this.animTimer = setInterval(() => {
      const now = Date.now()
      for (const [k, t] of this.flashPaths) if (now - t > FLASH_MS) this.flashPaths.delete(k)
      for (const [k, t] of this.flashActions) if (now - t > FLASH_MS) this.flashActions.delete(k)
      if (!this.flashPaths.size && !this.flashActions.size) {
        clearInterval(this.animTimer!)
        this.animTimer = null
      }
      this.emit()
    }, 50)
  }

  flashLevel(t: number | undefined): number {
    if (t === undefined) return 0
    return Math.max(0, 1 - (Date.now() - t) / FLASH_MS)
  }

  // --- actions ------------------------------------------------------------
  notify(text: string) {
    this.message = { text, until: Date.now() + 2500 }
    setTimeout(() => this.emit(), 2600)
  }

  setTheme(id: string) {
    this.theme = findTheme(id)
  }
  openPicker() {
    this.picker = { index: Math.max(0, themes.indexOf(this.theme)), prev: this.theme.id }
  }

  activate(key: string) {
    if (this.merge) this.merge = false
    this.activeKey = key
    this.unseen.delete(key)
    const rows = this.sourceRows()
    const i = rows.findIndex((r) => r.kind === "store" && r.store.key === key)
    if (i >= 0) this.srcCursor = i
  }
  cycleSource(dir: 1 | -1) {
    const i = this.sources.findIndex((s) => s.stores.some((st) => st.key === this.activeKey))
    const next = this.sources[(i + dir + this.sources.length) % this.sources.length]!
    this.activate(next.stores[0]!.key)
  }

  toggleMerge() {
    this.merge = !this.merge
    if (this.merge) this.unseen.clear()
    this.notify(this.merge ? "merged timeline · all apps" : "single store view")
  }
  togglePause() {
    this.paused = !this.paused
    this.notify(this.paused ? "recording paused" : "recording resumed")
  }
  toggleSkip() {
    const a = this.selected()
    if (!a || a.seq === 0) return
    a.skipped = !a.skipped
    this.notify(a.skipped ? `skipped ${a.type}` : `restored ${a.type}`)
  }
  goLive() {
    this.view().cursor = null
  }
  clearStore() {
    const st = this.store()
    if (!st) return
    st.actions.splice(0, st.actions.length - 1)
    this.view().cursor = null
    this.notify(`cleared ${st.name}`)
  }
  removeSource(id: string) {
    const src = this.sources.find((s) => s.id === id)
    if (!src || src.connected) return this.notify("only disconnected apps can be removed")
    this.sources = this.sources.filter((s) => s !== src)
    if (src.stores.some((s) => s.key === this.activeKey)) this.activate(this.sources[0]!.stores[0]!.key)
    this.srcCursor = Math.min(this.srcCursor, this.sourceRows().length - 1)
  }
  quit() {
    this.onQuit()
  }

  // Move the time cursor by n actions; landing past the end returns to live.
  step(n: number) {
    const tl = this.timeline()
    if (!tl.length) return
    const i = this.selectedIndex()
    const j = Math.max(0, Math.min(tl.length - 1, i + n))
    this.view().cursor = j === tl.length - 1 ? null : tl[j]!.id
  }
  // Move the time cursor by about `sec` seconds, always at least one action.
  travelBy(sec: number) {
    const tl = this.timeline()
    const sel = this.selected()
    if (!sel) return
    const i = tl.indexOf(sel)
    const target = sel.time + sec * 1000
    let j: number
    if (sec < 0) {
      j = tl.findLastIndex((a) => a.time <= target)
      j = Math.min(i - 1, Math.max(0, j))
    } else {
      j = tl.findIndex((a) => a.time >= target)
      j = Math.max(i + 1, j < 0 ? tl.length - 1 : j)
    }
    this.step(j - i)
  }
  selectAction(id: number) {
    const tl = this.timeline()
    this.view().cursor = tl[tl.length - 1]?.id === id ? null : id
  }

  // --- layout -------------------------------------------------------------
  widths(total = this.screenW): Record<Focus, number> {
    const sources = clamp(this.layout.sources, MIN_W.sources, total - MIN_W.actions - MIN_W.inspector)
    const rest = total - sources
    const actions = clamp(this.layout.actions ?? Math.max(34, Math.floor(rest * 0.42)), MIN_W.actions, rest - MIN_W.inspector)
    return { sources, actions, inspector: rest - actions }
  }
  // Grow the focused panel by `d` cells; the inspector grows by shrinking actions.
  resize(d: number) {
    const w = this.widths()
    if (this.focus === "sources") this.layout.sources = w.sources + d
    else this.layout.actions = w.actions + (this.focus === "actions" ? d : -d)
    this.layout = this.normalized()
  }
  // Put the dragged border at screen column x.
  dragBorder(x: number) {
    const w = this.widths()
    if (this.dragging === "sources") {
      // Keep the actions panel's width while the sources border moves.
      this.layout = { sources: x + 1, actions: w.actions - (x + 1 - w.sources) }
    } else if (this.dragging === "actions") this.layout.actions = x + 1 - w.sources
    this.layout = this.normalized()
  }
  resetLayout() {
    this.layout = { sources: 24, actions: null }
  }
  private normalized() {
    const w = this.widths()
    return { sources: w.sources, actions: this.layout.actions === null ? null : w.actions }
  }

  // --- tree ---------------------------------------------------------------
  // Paths whose ancestors are opened automatically so changes are visible.
  revealed(): Set<string> {
    const out = new Set<string>()
    for (const c of this.changes()) {
      const parts = c.path.split(".")
      for (let i = 1; i < parts.length; i++) out.add(parts.slice(0, i).join("."))
    }
    return out
  }
  effectiveExpanded(): Set<string> {
    const v = this.view()
    const out = new Set([...v.expanded, ...this.revealed()])
    for (const p of v.collapsed) out.delete(p)
    return out
  }
  treeRows(): TreeRow[] {
    const a = this.selected()
    return a ? flatten(a.state, this.effectiveExpanded()) : []
  }
  setOpen(path: string, open: boolean) {
    const v = this.view()
    if (open) {
      v.expanded.add(path)
      v.collapsed.delete(path)
    } else {
      v.collapsed.add(path)
      v.expanded.delete(path)
    }
  }

  runCommand(line: string) {
    const [name = "", ...rest] = line.trim().split(/\s+/)
    const cmd = commands.find((c) => c.name === name) ?? this.commandMatches(name)[0]
    if (!cmd) return this.notify(`unknown command: ${name}`)
    cmd.run(this, rest.join(" "))
  }
  commandMatches(q: string): Command[] {
    const s = q.trim().split(/\s+/)[0]?.toLowerCase() ?? ""
    // Prefix matches rank above loose subsequence matches.
    const rank = (c: Command) => (c.name.startsWith(s) ? 0 : 1)
    return commands.filter((c) => fuzzy(s, c.name)).sort((a, b) => rank(a) - rank(b))
  }
}

export function fuzzy(q: string, s: string): boolean {
  let i = 0
  for (const ch of s) if (ch === q[i]) i++
  return i === q.length
}
