import { CLIENT_UPDATE, diff, flatten, getPath, hostOf, isLocal, type Access, type Action, type Change, type Origin, type Source, type Store, type TreeRow } from "./model"
import { homedir } from "node:os"
import { resolve } from "node:path"
import { exportHistory, importHistory } from "./history"
import { startBridge, type Bridge } from "./bridge"
import { installedVersion, latestVersion, newer, releaseNotes, runUpdate, updateCommand, VERSION, type Progress } from "./update"
import { mockAccess, startMock } from "./mock"
import { DEFAULTS, format, OPTIONS, parseSet, saveSettings, stepValue, type OptionName, type Settings } from "./settings"
import { findTheme, themes, type Theme } from "./theme"

export type Focus = "sources" | "actions" | "inspector"
export type Tab = "state" | "action" | "diff" | "trace" | "raw"
export type Mode = "normal" | "filter" | "command" | "insert" | "visual"
export const TABS: Tab[] = ["state", "action", "diff", "trace", "raw"]
export const FOCI: Focus[] = ["sources", "actions", "inspector"]
export const MERGED = "*"
// How long a page's row shows the answer given to it.
const ANSWER_MS = 450

type View = {
  // Selected action id; null follows the newest action (live).
  cursor: number | null
  expanded: Set<string>
  collapsed: Set<string>
  treeCursor: number
  // Start time of the track's visible window; it only moves to keep the cursor in view.
  trackFrom: number | null
  // State tree shows only this subtree.
  pinned: string | null
  // Action types hidden from the list (a persistent denylist, unlike the / filter).
  hidden: Set<string>
}

export type SourceRow =
  // `origin`: the app is offline and its page is waiting for an answer or blocked, asked about on its own row.
  | { kind: "source"; source: Source; origin?: Origin }
  | { kind: "store"; source: Source; store: Store }
  // A page from elsewhere, waiting for a yes or said no to.
  | { kind: "origin"; origin: Origin }

export type Command = { name: string; desc: string; run: (s: AppState, arg: string) => void }

export const commands: Command[] = [
  { name: "set", desc: "settings (or :set name=value)", run: (s, arg) => s.runSet(arg) },
  { name: "theme", desc: "pick a theme (or :theme <name>)", run: (s, arg) => (arg ? s.applySettings({ theme: findTheme(arg).id }) : s.openPicker()) },
  { name: "merge", desc: "toggle merged timeline of all apps", run: (s) => s.toggleMerge() },
  { name: "pause", desc: "pause / resume recording", run: (s) => s.togglePause() },
  { name: "skip", desc: "skip the selected action", run: (s) => s.toggleSkip() },
  { name: "live", desc: "jump back to the newest action", run: (s) => s.goLive() },
  { name: "dispatch", desc: "dispatch an action to the store", run: (s) => s.openDispatch() },
  { name: "commit", desc: "make the selected state the base", run: (s) => s.commit() },
  { name: "revert", desc: "drop actions after the commit", run: (s) => s.revert() },
  { name: "sweep", desc: "remove skipped actions", run: (s) => s.sweep() },
  { name: "reset", desc: "back to the initial state", run: (s) => s.reset() },
  { name: "lock", desc: "lock / unlock the app's own changes", run: (s) => s.toggleLock() },
  { name: "unmove", desc: "put moved actions back in arrival order", run: (s) => s.unmoveAll() },
  { name: "unhide", desc: "show hidden action types again", run: (s) => s.unhideAll() },
  { name: "pin", desc: "pin / unpin the subtree under the cursor", run: (s) => s.togglePin() },
  { name: "play", desc: "play / pause actions from the cursor", run: (s) => s.togglePlay() },
  { name: "export", desc: "save history as Redux DevTools JSON", run: (s, arg) => void s.exportTo(arg) },
  { name: "import", desc: "load a Redux DevTools history file", run: (s, arg) => void s.importFrom(arg) },
  { name: "update", desc: "look for a new version and install it", run: (s) => void s.checkUpdate(true) },
  { name: "help", desc: "show keybindings", run: (s) => (s.help = true) },
  { name: "quit", desc: "exit openstate", run: (s) => s.quit() },
]

const FLASH_MS = 900
export const SHINE_MS = 700
export const SPEEDS = [0.5, 1, 2, 4, 8]
export const REPO_URL = "https://github.com/franlol/openstate"

export type Draft = {
  storeKey: string
  // Known action types with their use count, snapshotted on open so the list holds still while typing.
  types: { type: string; uses: number }[]
  type: string
  payload: string
  field: "type" | "payload"
  pick: number
  error?: string
}
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
  // The :set card, with the highlighted option.
  settingsCard: { index: number } | null = null
  settings: Settings
  // Mock apps instead of the bridge (--demo).
  demo = false
  // The "connect an app" card of the waiting screen.
  connectCard = false
  // A newer version on npm, and the :update card: offered, installing, installed or failed.
  update: {
    latest: string
    card: boolean
    phase: "offer" | "running" | "done" | "failed"
    progress: Progress
    // The release's notes; undefined while they load.
    notes?: string[]
    output?: string
  } | null = null
  bridge: Bridge | null = null
  // Who may connect: the bridge's, or the demo's stand-in.
  access!: Access
  // Pending pages already announced.
  private asked = new Set<string>()
  // Why the bridge is not listening, e.g. the port is taken.
  listenError: string | null = null
  // Problems reading the config file, shown instead of the greeting.
  configErrors: string[] = []
  activeKey: string
  srcCursor = 1
  cmdIndex = 0
  pending: string | null = null
  // Command-line message, vim style; errors stay longer.
  message: { text: string; error: boolean; until: number } | null = null
  unseen = new Map<string, number>()
  // Flash timestamps for changed tree paths and freshly arrived action ids.
  flashPaths = new Map<string, number>()
  flashActions = new Map<number, number>()
  // When the shine across the header title started: once, when the header first shows.
  titleShine: number | null = null
  splashUntil = Date.now() + 1800
  // Vim-style startup message once the splash is gone.
  greeted = false
  // Panel widths in cells; a null actions width means the default split.
  layout: { sources: number; actions: number | null } = { sources: 24, actions: null }
  // Border being dragged with the mouse: the panel on its left.
  dragging: "sources" | "actions" | null = null
  // Action being dragged to a new place in the list.
  // The action being dragged with the mouse: the list as it was, and whether it had been moved before.
  moving: { id: number; before: Action[]; wasMoved: boolean; hitCommit?: boolean } | null = null
  screenW = 120
  // Vim-style y/N question in the command line.
  confirm: { text: string; run: () => void } | null = null
  // Action being written in the dispatch card (insert mode).
  draft: Draft | null = null
  playing = false
  speed = 1
  private playTimer: ReturnType<typeof setTimeout> | null = null
  // Track cell under the mouse.
  hover: { cell: number } | null = null
  // Seconds shown by the main track, set when it renders; H/L travel half of it.
  trackSpan = 60
  onQuit: () => void = () => {}
  // Scrolls the update card's notes; set by the card while it shows.
  scrollNotes: (rows: number) => void = () => {}
  // Ends this openstate and starts the installed one in the same terminal.
  onRestart: () => void = () => {}
  // Writes to the clipboard (host and OSC 52); set up by main with the renderer.
  copyText: (text: string) => Promise<boolean> = async () => false
  // Visual mode anchor: the action id where the selection started.
  visual: number | null = null

  private views = new Map<string, View>()
  // Actions the user moved, per store; one counts as moved while it is out of its arrival slot.
  private moved = new Map<string, Set<number>>()
  private lastSeen = new Map<string, number>()
  private listeners = new Set<() => void>()
  private version = 0
  private animTimer: ReturnType<typeof setInterval> | null = null
  private dataTimer: ReturnType<typeof setTimeout> | null = null

  constructor(settings: Settings = DEFAULTS, demo = false) {
    this.settings = { ...settings }
    this.theme = findTheme(this.settings.theme)
    this.demo = demo
    // The splash lists the demo apps as they start; with the bridge the waiting screen says it all.
    if (!demo) this.splashUntil = 0
    const hooks = [() => this.onData(), () => this.paused, () => this.settings.maxage] as const
    if (demo) {
      this.sources = startMock(...hooks)
      this.access = mockAccess(hooks[0])
    } else {
      this.bridge = startBridge({ onChange: hooks[0], isPaused: hooks[1], maxAge: hooks[2], warn: (text, error = true) => this.notify(text, error) })
      this.sources = this.bridge.sources
      this.access = this.bridge.access
      this.listen()
    }
    this.activeKey = this.sources[0]?.stores[0]?.key ?? ""
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
      v = { cursor: null, expanded: new Set(), collapsed: new Set(), treeCursor: 0, trackFrom: null, pinned: null, hidden: new Set() }
      this.views.set(key, v)
    }
    return v
  }
  viewKey() {
    return this.merge ? MERGED : this.activeKey
  }

  // The UI asks for these several times per render, and again for every animation frame; each is
  // recomputed only when one of the values it depends on changes (compared by identity).
  private memos = new Map<string, { deps: unknown[]; value: unknown }>()
  cached<T>(name: string, deps: unknown[], compute: () => T): T {
    const m = this.memos.get(name)
    if (m && m.deps.length === deps.length && m.deps.every((d, i) => Object.is(d, deps[i]))) return m.value as T
    const value = compute()
    this.memos.set(name, { deps, value })
    return value
  }
  // Bumped where a list is reordered in place, which leaves its identity and length as they were.
  private reorders = 0
  // Bumped whenever apps send something: states, actions, connections.
  dataRev = 0

  timeline(): Action[] {
    const stores = this.merge ? this.allStores() : [this.store()]
    const v = this.view()
    const deps = [this.merge, this.filter, [...v.hidden].join("\n"), this.reorders, ...stores.flatMap((s) => [s?.actions, s?.actions.length])]
    return this.cached("timeline", deps, () => this.computeTimeline())
  }
  private computeTimeline(): Action[] {
    const all = this.merge
      ? this.allStores()
          .flatMap((s) => s.actions)
          .sort((a, b) => a.time - b.time || a.id - b.id)
      : (this.store()?.actions ?? [])
    const hidden = this.view().hidden
    const f = this.filter.toLowerCase()
    if (!f && !hidden.size) return all
    return all.filter((a) => !hidden.has(a.type) && a.type.toLowerCase().includes(f))
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
  // Asked several times per render; cached while the selected action's states stay the same objects.
  private changesOf: { prev: unknown; state: unknown; out: Change[] } | null = null
  changes(): Change[] {
    const a = this.selected()
    if (!a) return []
    const c = this.changesOf
    if (c && c.prev === a.prev && c.state === a.state) return c.out
    this.changesOf = { prev: a.prev, state: a.state, out: diff(a.prev, a.state) }
    return this.changesOf.out
  }

  // A page that comes back to an app already listed (offline) is asked about on that app's row. Other pages go
  // last, those waiting before those said no to, so the apps above never move.
  sourceRows(): SourceRow[] {
    const attached = new Set<string>()
    const apps = this.sources.flatMap((source) => {
      const o = source.connected ? undefined : this.access.origins.find((x) => x.origin === source.origin && !attached.has(x.origin))
      if (o) attached.add(o.origin)
      return [
        { kind: "source" as const, source, origin: o },
        ...source.stores.map((store) => ({ kind: "store" as const, source, store })),
      ]
    })
    const origins = (access: Origin["access"]) =>
      this.access.origins
        .filter((o) => o.access === access && !attached.has(o.origin))
        .map((origin) => ({ kind: "origin" as const, origin }))
    return [...apps, ...origins("pending"), ...origins("blocked")]
  }
  // The rows ahead of the cursor can only go, never come, so the cursor stays put unless it is past the end.
  private clampSrcCursor() {
    this.srcCursor = Math.max(0, Math.min(this.srcCursor, this.sourceRows().length - 1))
  }

  // --- pages from elsewhere ------------------------------------------------------------------
  // A page answered from the list: its row shows the answer for a moment, then moves or goes.
  answered: { origin: string; verdict: "allow" | "block" | "forget" } | null = null
  answerOrigin(origin: string, verdict: "allow" | "block" | "forget") {
    if (this.answered) return
    this.answered = { origin, verdict }
    setTimeout(() => {
      this.answered = null
      if (verdict === "allow") this.allowOrigin(origin)
      else if (verdict === "block") this.blockOrigin(origin)
      else this.forgetOrigin(origin)
      this.emit()
    }, ANSWER_MS)
  }
  // The page the waiting screen asks about: one waiting for an answer, else a blocked one trying right now.
  waitingOrigin(): Origin | undefined {
    const os = this.access.origins
    return os.find((o) => o.access === "pending") ?? os.find((o) => o.access === "blocked" && o.live > 0)
  }
  allowOrigin(origin: string) {
    this.access.allow(origin)
    this.notify(`${hostOf(origin)} allowed · its apps show up as they connect`)
    this.clampSrcCursor()
  }
  blockOrigin(origin: string) {
    this.access.block(origin)
    this.notify(`${hostOf(origin)} blocked · ✓ in sources lets it in later`)
  }
  forgetOrigin(origin: string) {
    this.access.forget(origin)
    this.notify(`${hostOf(origin)} forgotten · it is asked about again next time`)
    this.clampSrcCursor()
  }

  // Apps may report thousands of actions a second; the screen catches up at most once a frame.
  private onData() {
    this.dataTimer ??= setTimeout(() => {
      this.dataTimer = null
      this.takeData()
    }, 16)
  }

  private takeData() {
    this.dataRev++
    const now = Date.now()
    // A page asking to come in is said once, as it arrives; the list keeps it until it is answered.
    for (const o of this.access.origins) {
      if (o.access !== "pending" || this.asked.has(o.origin)) continue
      this.asked.add(o.origin)
      this.notify(`${hostOf(o.origin)} wants to connect · ✓ or ✗ in sources`)
    }
    for (const o of this.asked) if (!this.access.origins.some((x) => x.origin === o && x.access === "pending")) this.asked.delete(o)
    // The first store to connect (or the next one, once the active app is removed) opens by itself.
    if (!this.store()) {
      const first = this.allStores()[0]
      if (first) this.activate(first.key)
    }
    for (const st of this.allStores()) {
      const seen = this.lastSeen.get(st.key) ?? 0
      const last = st.actions[st.actions.length - 1]
      const total = last ? last.seq + 1 : 0
      if (total <= seen) continue
      // Revert and sweep leave gaps in seq, so pick new actions by seq rather than by count.
      const fresh = st.actions.filter((a) => a.seq >= seen)
      this.lastSeen.set(st.key, total)
      const visible = this.merge || st.key === this.activeKey
      if (!visible) this.unseen.set(st.key, (this.unseen.get(st.key) ?? 0) + fresh.length)
      for (const a of fresh) this.flashActions.set(a.id, now)
      if (visible && this.view().cursor === null) this.flashChanges(fresh[0]!.prev, fresh[fresh.length - 1]!.state)
    }
    this.animate()
    this.emit()
  }

  // Flash every changed path (and its ancestors) in the state tree.
  private flashChanges(before: unknown, after: unknown) {
    const now = Date.now()
    for (const c of diff(before, after)) {
      const parts = c.path.split(".")
      for (let i = 1; i <= parts.length; i++) this.flashPaths.set(parts.slice(0, i).join("."), now)
    }
    this.animate()
  }

  // Re-render while flashes fade, then stop the timer. 15 frames a second: each one repaints everything.
  private animate() {
    if (this.animTimer) return
    this.animTimer = setInterval(() => {
      const now = Date.now()
      for (const [k, t] of this.flashPaths) if (now - t > FLASH_MS) this.flashPaths.delete(k)
      for (const [k, t] of this.flashActions) if (now - t > FLASH_MS) this.flashActions.delete(k)
      const shining = this.titleShine !== null && now - this.titleShine < SHINE_MS
      if (!this.flashPaths.size && !this.flashActions.size && !shining) {
        clearInterval(this.animTimer!)
        this.animTimer = null
      }
      this.emit()
    }, 1000 / 15)
  }

  shineTitle() {
    if (this.titleShine !== null) return
    this.titleShine = Date.now()
    this.animate()
  }

  flashLevel(t: number | undefined): number {
    if (t === undefined || !this.settings.flash) return 0
    return Math.max(0, 1 - (Date.now() - t) / FLASH_MS)
  }

  // --- actions ------------------------------------------------------------
  notify(text: string, error = false) {
    const ms = error ? 5000 : 2500
    this.message = { text, error, until: Date.now() + ms }
    setTimeout(() => this.emit(), ms + 100)
  }

  // --- settings ------------------------------------------------------------------
  // `:set` alone opens the card; with arguments it works like vim's.
  runSet(arg: string) {
    if (!arg.trim()) return void (this.settingsCard = { index: 0 })
    try {
      const { changed, shown } = parseSet(arg.trim().split(/\s+/), this.settings)
      if (Object.keys(changed).length) this.applySettings(changed)
      if (shown.length) this.notify(shown.join("  "))
    } catch (e) {
      this.notify(`E: ${(e as Error).message}`, true)
    }
  }
  // Listens on the port; when it is taken, finds out whether by another openstate, the usual case.
  private listen(): string | null {
    const port = this.settings.port
    this.listenError = this.bridge!.listen(port, this.settings.lan)
    if (this.listenError?.endsWith("in use"))
      fetch(`http://localhost:${port}`, { signal: AbortSignal.timeout(1000) })
        .then((res) => res.text())
        .then((text) => {
          if (!text.startsWith("openstate:") || this.settings.port !== port || !this.listenError) return
          this.listenError = `another openstate is listening on port ${port}`
          this.emit()
        })
        .catch(() => {})
    return this.listenError
  }
  applySettings(changed: Partial<Settings>) {
    Object.assign(this.settings, changed)
    if (changed.theme) this.theme = findTheme(changed.theme)
    if (changed.maxage !== undefined) this.bridge?.setMaxAge(changed.maxage)
    if ((changed.port !== undefined || changed.lan !== undefined) && this.bridge) {
      if (this.listen()) return this.notify(`E: ${this.listenError} · :set port=<another>`, true)
    }
    const names = Object.keys(changed) as OptionName[]
    const note = names.map((n) => format(n, this.settings)).join("  ")
    const hint = changed.maxage !== undefined ? " · older actions drop as new ones arrive" : ""
    saveSettings(this.settings).then(
      () => (this.notify(`${note}${hint}`), this.emit()),
      (e) => (this.notify(`E: ${note} applied but not saved: ${(e as Error).message}`, true), this.emit()),
    )
  }
  // h/l and space in the settings card.
  stepSetting(dir: 1 | -1) {
    const card = this.settingsCard
    const o = card && OPTIONS[card.index]
    if (!o) return
    if (o.typed) return this.typeSetting(o.name)
    this.applySettings({ [o.name]: stepValue(o, this.settings, dir) })
  }
  // Hand over to the command line, ready for the value.
  typeSetting(name: OptionName) {
    this.settingsCard = null
    this.mode = "command"
    this.input = `set ${name}=`
    this.cmdIndex = 0
  }

  // enter in the settings card: themes open the picker, numbers the command line for any value, the rest step.
  enterSetting() {
    const o = this.settingsCard && OPTIONS[this.settingsCard.index]
    if (o?.name === "theme") this.openPicker()
    else if (o?.kind === "number") this.typeSetting(o.name)
    else this.stepSetting(1)
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
  // --- app commands (sent through the store connection) ----------------------
  // The store the user is acting on: the selected action's store, so it works merged too.
  target(): Store | undefined {
    const a = this.selected()
    return a ? this.store(a.storeKey) : this.store()
  }
  // Send a command to the app; stores that cannot do it throw, and that becomes the message.
  private via(st: Store, run: (c: Store["conn"]) => void): boolean {
    try {
      run(st.conn)
      return true
    } catch (e) {
      this.notify(`E: ${(e as Error).message}`, true)
      return false
    }
  }
  private committedIndex(st: Store) {
    return st.actions.findIndex((a) => a.id === st.commitId)
  }
  toggleSkip() {
    const a = this.selected()
    const st = this.target()
    if (!a || !st || a.seq === 0) return
    if (st.actions.indexOf(a) <= this.committedIndex(st)) return this.notify("E: committed actions cannot be skipped", true)
    // Read before sending: a real app answers later, so the flag has not flipped yet.
    const was = a.skipped
    if (this.via(st, (c) => c.toggle(a.id))) this.notify(was ? `restored ${a.type}` : `skipped ${a.type}, later states recomputed`)
  }
  commit() {
    const a = this.selected()
    const st = this.target()
    if (!a || !st) return
    if (this.via(st, (c) => c.commit(a.id))) this.notify(`committed at ${a.type} #${a.seq} · revert returns here`)
  }
  revert() {
    const st = this.target()
    if (!st) return
    const n = st.actions.length - 1 - Math.max(0, this.committedIndex(st))
    if (!n) return this.notify("nothing to revert")
    this.ask(`revert ${n} action${n > 1 ? "s" : ""} to ${st.commitId === null ? "the initial state" : "the commit"}?`, () => {
      if (!this.via(st, (c) => c.revert())) return
      this.moved.delete(st.key)
      this.goLive()
      this.notify(`reverted ${n} action${n > 1 ? "s" : ""}`)
    })
  }
  reset() {
    const st = this.target()
    if (!st) return
    this.ask(`reset ${st.name} to its initial state, dropping all ${st.actions.length - 1} actions?`, () => {
      if (!this.via(st, (c) => (c.commit(null), c.revert()))) return
      this.moved.delete(st.key)
      this.goLive()
      this.notify(`${st.name} reset`)
    })
  }
  sweep() {
    const st = this.target()
    if (!st) return
    const n = st.actions.filter((a) => a.skipped).length
    if (!n) return this.notify("no skipped actions to sweep")
    this.ask(`remove ${n} skipped action${n > 1 ? "s" : ""} for good?`, () => {
      if (this.via(st, (c) => c.sweep())) this.notify(`swept ${n} action${n > 1 ? "s" : ""}`)
    })
  }
  // Move the selected action past its neighbour in the list (same store, as shown).
  moveAction(dir: 1 | -1): boolean {
    const a = this.selected()
    const st = this.target()
    if (!a || !st) return false
    const shown = this.timeline().filter((x) => x.storeKey === st.key)
    const other = shown[shown.indexOf(a) + dir]
    if (!other) return false
    // Neither @@INIT nor anything up to the commit can change place.
    const base = this.committedIndex(st)
    if (Math.min(st.actions.indexOf(a), st.actions.indexOf(other)) <= Math.max(0, base))
      return this.notify(base > 0 ? "E: cannot move across the commit" : "E: the initial action cannot move", true), false
    const beforeId = dir < 0 ? other.id : (st.actions[st.actions.indexOf(other) + 1]?.id ?? null)
    if (!this.via(st, (c) => c.reorder(a.id, beforeId))) return false
    this.movedIds(st.key).add(a.id)
    this.selectAction(a.id)
    return true
  }
  private movedIds(key: string) {
    let set = this.moved.get(key)
    if (!set) this.moved.set(key, (set = new Set()))
    return set
  }
  // Where an action came from: in front of the first later-arrived action that has not moved, as the app
  // recorded it. Moved ones are left out, or one moved up would drag the others' slots along with it.
  // `by` is how many places it now sits below (positive) or above (negative) that slot.
  home(a: Action): { before: Action | undefined; by: number } | null {
    const st = this.store(a.storeKey)
    const moved = st && this.moved.get(st.key)
    if (!st || !moved?.has(a.id)) return null
    const others = st.actions.filter((x) => x !== a)
    const before = others.find((x) => x.seq > a.seq && !moved.has(x.id))
    const slot = before ? others.indexOf(before) : others.length
    const by = st.actions.indexOf(a) - slot
    return by ? { before, by } : null
  }
  movedCount(key: string): number {
    const st = this.store(key)
    return st ? st.actions.filter((a) => this.home(a)).length : 0
  }
  // Put an action back in its original place.
  restoreAction(a = this.selected()): boolean {
    const h = a && this.home(a)
    const st = a && this.store(a.storeKey)
    if (!a || !h || !st) return this.notify("not a moved action"), false
    const base = this.committedIndex(st)
    if (h.before && st.actions.indexOf(h.before) <= base) return this.notify("E: its place is behind the commit", true), false
    if (!this.via(st, (c) => c.reorder(a.id, h.before?.id ?? null))) return false
    this.movedIds(st.key).delete(a.id)
    this.selectAction(a.id)
    this.notify(`${a.type} back in place · later states recomputed`)
    return true
  }
  unmoveAll() {
    const st = this.target()
    if (!st) return
    const moved = st.actions.filter((a) => this.home(a))
    if (!moved.length) return this.notify("no moved actions")
    const n = moved.length
    this.ask(`put ${n} moved action${n > 1 ? "s" : ""} back in arrival order?`, () => {
      // Oldest first, so each one lands next to neighbours that are already back.
      let done = 0
      for (const a of moved.sort((x, y) => x.seq - y.seq)) if (this.home(a) && this.restoreAction(a)) done++
      this.notify(`${done} action${done === 1 ? "" : "s"} back in place`)
    })
  }
  // Mouse drag. The row moves here only, at once; the app gets a single reorder on release, since it
  // recomputes and sends back its whole history for each one.
  startDrag(id: number) {
    const a = this.timeline().find((x) => x.id === id)
    const st = a && this.store(a.storeKey)
    if (!a || !st) return
    this.selectAction(id)
    // Up to the commit the history is fixed, as with J/K.
    const base = this.committedIndex(st)
    if (st.actions.indexOf(a) <= Math.max(0, base))
      return this.notify(base > 0 ? "E: committed actions cannot move" : "E: the initial action cannot move", true)
    const moved = this.movedIds(st.key)
    this.moving = { id, before: [...st.actions], wasMoved: moved.has(id) }
    // So the ghost marks where it came from while it moves.
    moved.add(id)
  }
  private dragged() {
    const m = this.moving
    const a = m && this.timeline().find((x) => x.id === m.id)
    const st = a && this.store(a.storeKey)
    return m && a && st ? { m, a, st } : null
  }
  // Put the dragged action where the pointed-at action is, or back home over its ghost (target undefined).
  dragTo(targetId?: number) {
    const d = this.dragged()
    if (!d) return
    const { a, st } = d
    const acts = st.actions
    let to: number
    if (targetId === undefined) {
      const h = this.home(a)
      if (!h) return
      to = h.before ? acts.indexOf(h.before) : acts.length
      if (to > acts.indexOf(a)) to--
    } else {
      const target = acts.find((x) => x.id === targetId)
      if (!target || target === a) return
      to = acts.indexOf(target)
    }
    // Neither @@INIT nor anything up to the commit can change place: stop just below them.
    const base = this.committedIndex(st)
    if (to <= Math.max(0, base)) {
      to = Math.max(0, base) + 1
      if (!d.m.hitCommit) this.notify(base > 0 ? "E: cannot move across the commit" : "E: the initial action cannot move", true)
      d.m.hitCommit = true
    }
    const from = acts.indexOf(a)
    if (to === from) return
    acts.splice(from, 1)
    acts.splice(to, 0, a)
    this.reorders++
    // The last action is selected as "follow the end"; once moved up, keep it selected by id.
    this.selectAction(a.id)
  }
  // Mouse up: tell the app where the action ended up, or put the list back if it cannot reorder.
  endDrag() {
    const d = this.dragged()
    this.moving = null
    if (!d) return
    const { m, a, st } = d
    const moved = this.movedIds(st.key)
    const at = st.actions.indexOf(a)
    if (at === m.before.indexOf(a)) {
      if (!m.wasMoved) moved.delete(a.id)
      return
    }
    if (!this.via(st, (c) => c.reorder(a.id, st.actions[at + 1]?.id ?? null))) {
      st.actions = m.before
      if (!m.wasMoved) moved.delete(a.id)
      return
    }
    if (!this.home(a)) moved.delete(a.id)
  }
  toggleLock() {
    const st = this.target()
    if (!st) return
    const was = st.locked
    if (this.via(st, (c) => c.lock(!was)))
      this.notify(was ? `${st.name} unlocked` : `${st.name} locked · the app's own changes are ignored`)
  }
  ask(text: string, run: () => void) {
    this.confirm = { text, run }
  }
  answer(yes: boolean) {
    const c = this.confirm
    this.confirm = null
    if (yes) c?.run()
  }

  // --- dispatch -----------------------------------------------------------------
  openDispatch() {
    const st = this.target()
    if (!st) return
    this.stopPlay()
    const uses = new Map<string, number>()
    for (const a of st.actions) if (a.type !== "@@INIT") uses.set(a.type, (uses.get(a.type) ?? 0) + 1)
    const types = [...uses]
      .map(([type, n]) => ({ type, uses: n }))
      .sort((a, b) => b.uses - a.uses || a.type.localeCompare(b.type))
    this.draft = { storeKey: st.key, types, type: "", payload: "", field: "type", pick: 0 }
    this.mode = "insert"
  }
  closeDispatch() {
    this.draft = null
    this.mode = "normal"
  }
  // Known types matching the typed text: prefix matches first, then by use (stable sort).
  typeMatches(): { type: string; uses: number }[] {
    const d = this.draft
    if (!d) return []
    const q = d.type.toLowerCase()
    const rank = (t: string) => (t.toLowerCase().startsWith(q) ? 0 : 1)
    return d.types.filter((x) => fuzzy(q, x.type.toLowerCase())).sort((a, b) => rank(a.type) - rank(b.type))
  }
  movePick(n: number) {
    const d = this.draft
    if (d) d.pick = clamp(d.pick + n, 0, Math.max(0, this.typeMatches().length - 1))
  }
  // Take the highlighted type and prefill the payload from its last use.
  acceptType() {
    const d = this.draft
    if (!d) return
    const pick = this.typeMatches()[d.pick]?.type
    if (pick && pick !== d.type) {
      d.type = pick
      const last = this.store(d.storeKey)?.actions.findLast((a) => a.type === pick)
      if (!d.payload.trim() && last?.payload !== undefined) d.payload = JSON.stringify(last.payload, null, 2)
    }
    d.field = "payload"
    d.error = undefined
  }
  submitDispatch() {
    const d = this.draft
    if (!d) return
    if (!d.type.trim()) return void (d.error = "type is required")
    let payload: unknown
    try {
      payload = d.payload.trim() ? JSON.parse(d.payload) : undefined
    } catch (e) {
      d.field = "payload"
      return void (d.error = `invalid JSON: ${(e as Error).message.replace(/^JSON Parse error: /, "")}`)
    }
    const st = this.store(d.storeKey)
    if (!st || !this.via(st, (c) => c.dispatch({ type: d.type.trim(), payload }))) return
    this.closeDispatch()
    this.goLive()
    this.notify(`⇡ dispatched ${d.type.trim()}`)
  }

  // --- playback -----------------------------------------------------------------
  // Replays actions from the cursor at their real pace (scaled by speed), flashing each change.
  togglePlay() {
    if (this.playing) return this.stopPlay()
    const tl = this.timeline()
    if (tl.length < 2) return
    if (this.view().cursor === null) this.view().cursor = tl[0]!.id
    this.playing = true
    this.scheduleNext()
  }
  stopPlay() {
    this.playing = false
    if (this.playTimer) clearTimeout(this.playTimer)
    this.playTimer = null
  }
  setSpeed(dir: 1 | -1) {
    const i = SPEEDS.indexOf(this.speed)
    this.speed = SPEEDS[clamp(i + dir, 0, SPEEDS.length - 1)]!
    this.notify(`playback ${this.speed}×`)
  }
  private scheduleNext() {
    const tl = this.timeline()
    const i = this.selectedIndex()
    const cur = tl[i]
    const next = tl[i + 1]
    if (!cur || !next || this.view().cursor === null) return this.stopPlay()
    const gap = clamp(next.time - cur.time, 120, 1500) / this.speed
    this.playTimer = setTimeout(() => {
      if (!this.playing) return
      this.step(1)
      const a = this.selected()
      if (a) this.flashChanges(a.prev, a.state)
      if (this.view().cursor === null) this.stopPlay()
      else this.scheduleNext()
      this.emit()
    }, gap)
  }

  // --- yank -------------------------------------------------------------------
  yank(what: "action" | "state" | "path" | "value" | "client") {
    if (what === "client") return this.put(CLIENT_UPDATE, "the client update command")
    const a = this.selected()
    if (!a) return
    const row = this.tab === "state" ? this.treeRows()[this.view().treeCursor] : undefined
    let text: string
    let label: string
    if (what === "action") (text = json({ type: a.type, payload: a.payload })), (label = a.type)
    else if (what === "state") (text = json(a.state)), (label = "state")
    else if (!row) return this.notify("E: put the tree cursor on a node first (inspector, state tab)", true)
    else if (what === "path") (text = row.path), (label = row.path)
    else (text = json(row.value)), (label = `value of ${row.path}`)
    this.put(text, label)
  }
  private put(text: string, label: string) {
    void this.copyText(text).then((ok) => {
      this.notify(ok ? `yanked ${label} · ${text.length} chars` : "E: clipboard not available", !ok)
      this.emit()
    })
  }

  // ★ github in the help and the waiting screen. Starring needs GitHub's page, so open the repo there; over SSH the
  // browser would open on the other machine, so copy the link instead.
  openRepo() {
    const copy = () =>
      void this.copyText(REPO_URL).then((ok) => {
        this.notify(ok ? `★ ${REPO_URL} · link copied` : `★ ${REPO_URL}`)
        this.emit()
      })
    if (process.env.SSH_CONNECTION) return copy()
    const cmd = process.platform === "darwin" ? ["open"] : process.platform === "win32" ? ["cmd", "/c", "start", ""] : ["xdg-open"]
    try {
      Bun.spawn([...cmd, REPO_URL], { stdio: ["ignore", "ignore", "ignore"] }).exited.then((code) => (code ? copy() : undefined))
      this.notify(`★ opening ${REPO_URL} · thanks!`)
    } catch {
      copy()
    }
  }

  // --- import / export ------------------------------------------------------------
  async exportTo(arg: string) {
    const st = this.target()
    if (!st) return
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")
    const path = filePath(arg || `openstate-${st.sourceId}-${st.name}-${stamp}.json`)
    try {
      await Bun.write(path, exportHistory(st))
      this.notify(`"${shortPath(path)}" written · ${st.actions.length} actions of ${st.name}`)
    } catch (e) {
      this.notify(`E: cannot write ${shortPath(path)}: ${(e as Error).message}`, true)
    }
    this.emit()
  }
  // Without a file name, the newest export in the working directory.
  async importFrom(arg: string) {
    const st = this.target()
    if (!st) return
    const path = arg ? filePath(arg) : await newestExport()
    if (!path) return this.notify("E: no openstate-*.json here · :import <file>", true), this.emit()
    let h
    try {
      const f = Bun.file(path)
      if (!(await f.exists())) throw new Error("no such file")
      h = importHistory(await f.text())
    } catch (e) {
      this.notify(`E: ${shortPath(path)}: ${(e as Error).message}`, true)
      return this.emit()
    }
    const n = h.actions.length
    this.ask(`replace ${st.actions.length} actions of ${st.name} with ${n} from ${shortPath(path)}?`, () => {
      this.stopPlay()
      // The app renumbers from zero; nothing here is new, so nothing flashes.
      this.lastSeen.set(st.key, n)
      if (!this.via(st, (c) => c.import(h))) return
      this.moved.delete(st.key)
      const v = this.view(st.key)
      v.cursor = null
      v.trackFrom = null
      this.notify(`imported ${n} actions into ${st.name}${h.hasStates ? "" : " · states replayed"}`)
    })
    this.emit()
  }

  // --- hide -------------------------------------------------------------------
  hideType(type?: string) {
    const t = type ?? this.selected()?.type
    if (!t) return
    this.view().hidden.add(t)
    this.notify(`hid ${t} · :unhide to show again`)
  }
  unhideAll() {
    const n = this.view().hidden.size
    this.view().hidden.clear()
    this.notify(n ? `showing ${n} hidden type${n > 1 ? "s" : ""} again` : "nothing hidden")
  }

  // --- visual -----------------------------------------------------------------
  startVisual() {
    const a = this.selected()
    if (!a) return
    this.stopPlay()
    if (this.view().cursor === null) this.view().cursor = a.id
    this.visual = a.id
    this.mode = "visual"
    this.focus = "actions"
  }
  endVisual() {
    this.visual = null
    this.mode = "normal"
  }
  // Actions between the anchor and the cursor, inclusive.
  visualRange(): Action[] {
    const tl = this.timeline()
    const i = tl.findIndex((a) => a.id === this.visual)
    const j = this.selectedIndex()
    if (i < 0 || j < 0) return []
    return tl.slice(Math.min(i, j), Math.max(i, j) + 1)
  }
  visualSkip() {
    // Init and committed actions cannot be skipped.
    const range = this.visualRange().filter((a) => {
      const st = this.store(a.storeKey)
      return a.seq > 0 && !!st && st.actions.indexOf(a) > this.committedIndex(st)
    })
    const ok = range.every((a) => this.via(this.store(a.storeKey)!, (c) => c.toggle(a.id)))
    this.endVisual()
    if (!ok) return
    this.notify(`toggled skip on ${range.length} action${range.length > 1 ? "s" : ""}`)
  }
  visualHide() {
    const types = new Set(this.visualRange().map((a) => a.type))
    for (const t of types) this.view().hidden.add(t)
    this.endVisual()
    this.notify(`hid ${types.size} type${types.size > 1 ? "s" : ""} · :unhide to show again`)
  }
  visualYank() {
    const range = this.visualRange()
    this.endVisual()
    this.put(json(range.map((a) => ({ type: a.type, payload: a.payload }))), `${range.length} actions`)
  }

  goLive() {
    this.stopPlay()
    this.view().cursor = null
  }
  // dd: a connected app is cut off (it stays listed, offline), one that is gone leaves the list.
  removeSource(id: string) {
    const src = this.sources.find((s) => s.id === id)
    if (!src) return
    if (src.connected) {
      this.access.disconnect(src)
      // Apps outside a browser and pages on this machine are let in again as soon as they reconnect.
      const asks = src.origin && !isLocal(src.origin)
      return this.notify(`${src.name} disconnected${asks ? " · it is asked about if it comes back" : " · it is back if it reconnects"} · dd again removes it`)
    }
    // In place: the bridge keeps adding to this same list.
    this.sources.splice(this.sources.indexOf(src), 1)
    if (src.stores.some((s) => s.key === this.activeKey)) {
      const next = this.sources[0]?.stores[0]
      if (next) this.activate(next.key)
      else this.activeKey = ""
    }
    this.clampSrcCursor()
  }
  quit() {
    this.onQuit()
  }

  // On start (unless :set noupdatecheck) a newer version shows in the statusline; :update opens its card.
  async checkUpdate(manual = false) {
    if (this.update?.phase === "running" || this.update?.phase === "done") return void (this.update.card = true)
    if (manual) this.notify("looking for a new version…")
    const latest = await latestVersion()
    if (latest && newer(latest, VERSION)) {
      const u: NonNullable<AppState["update"]> = { latest, card: manual, phase: "offer", progress: { value: 0, stage: "" } }
      this.update = u
      void releaseNotes(latest).then((notes) => ((u.notes = notes), this.emit()))
    } else if (manual) {
      // No answer covers offline, not published yet, or only someone else's package by that name.
      this.notify(latest ? `openstate ${VERSION} · up to date` : `openstate ${VERSION} · no newer version found on npm`)
    }
    this.emit()
  }

  installUpdate() {
    const u = this.update
    const cmd = updateCommand()
    if (!u || u.phase === "running") return
    // From a clone of the repo the card says to git pull; there is nothing to run.
    if (!cmd) return
    u.phase = "running"
    void runUpdate(cmd, (p) => ((u.progress = { ...p }), this.emit())).then(({ ok, output }) => {
      const installed = ok ? installedVersion() : null
      // Restarting into the same version would offer the update again, round and round.
      const stale = installed !== null && installed !== u.latest
      u.phase = ok && !stale ? "done" : "failed"
      u.output = stale ? `the install finished, but ${installed} is still the one installed, not ${u.latest}` : output.split("\n").filter(Boolean).at(-1)
      this.emit()
    })
  }

  // enter in the theme picker: the previewed theme stays and is saved.
  keepTheme() {
    if (!this.picker) return
    const id = themes[this.picker.index]!.id
    this.picker = null
    this.applySettings({ theme: id })
  }

  // esc in the theme picker: back to the theme it opened with.
  cancelTheme() {
    if (this.picker) this.setTheme(this.picker.prev)
    this.picker = null
  }

  // enter in the update card, or a click on it: install, or restart once installed.
  confirmUpdate() {
    if (this.update?.phase === "done") this.restart()
    else this.installUpdate()
  }

  // A failed install is not kept: :update offers it again.
  closeUpdate() {
    const u = this.update
    if (!u) return
    u.card = false
    if (u.phase === "failed") u.phase = "offer"
  }

  restart() {
    this.bridge?.close()
    this.onRestart()
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
    const changes = this.changes()
    return this.cached("revealed", [changes], () => this.computeRevealed(changes))
  }
  private computeRevealed(changes: Change[]): Set<string> {
    const out = new Set<string>()
    for (const c of changes) {
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
    if (!a) return []
    const v = this.view()
    const pin = v.pinned
    // expanded and collapsed change in place, so they take part by content.
    const deps = [a.state, pin, this.revealed(), [...v.expanded].join("\n"), [...v.collapsed].join("\n")]
    return this.cached("treeRows", deps, () =>
      pin ? flatten(getPath(a.state, pin), this.effectiveExpanded(), pin) : flatten(a.state, this.effectiveExpanded()),
    )
  }
  // Pin the subtree under the tree cursor, or unpin when something is pinned already.
  togglePin() {
    const v = this.view()
    if (v.pinned) {
      this.notify(`unpinned ${v.pinned}`)
      v.pinned = null
    } else {
      const r = this.treeRows()[v.treeCursor]
      if (!r?.branch) return this.notify("E: pin an object or array, not a value", true)
      v.pinned = r.path
      this.setOpen(r.path, true)
      this.notify(`pinned ${r.path} · P again to unpin`)
    }
    v.treeCursor = 0
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
    if (!cmd) return this.notify(`E: not a command: ${name}`, true)
    cmd.run(this, rest.join(" "))
  }
  commandMatches(q: string): Command[] {
    const s = q.trim().split(/\s+/)[0]?.toLowerCase() ?? ""
    // Prefix matches rank above loose subsequence matches.
    const rank = (c: Command) => (c.name.startsWith(s) ? 0 : 1)
    return commands.filter((c) => fuzzy(s, c.name)).sort((a, b) => rank(a) - rank(b))
  }
}

const json = (v: unknown) => JSON.stringify(v ?? null, null, 2)

const filePath = (p: string) => resolve(p.replace(/^~(?=\/|$)/, homedir()))
const shortPath = (p: string) => p.replace(process.cwd() + "/", "").replace(homedir(), "~")

async function newestExport(): Promise<string | undefined> {
  const files = [...new Bun.Glob("openstate-*.json").scanSync({ cwd: process.cwd(), absolute: true })]
  const dated = await Promise.all(files.map(async (f) => ({ f, t: (await Bun.file(f).stat()).mtimeMs })))
  return dated.sort((a, b) => b.t - a.t)[0]?.f
}

export function fuzzy(q: string, s: string): boolean {
  let i = 0
  for (const ch of s) if (ch === q[i]) i++
  return i === q.length
}
