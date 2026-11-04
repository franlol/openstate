import type { Renderable } from "@opentui/core"
import { reactiveMatcherFromStore, useBindings } from "@opentui/keymap/react"
import { useMemo, type RefObject } from "react"
import { FOCI, TABS, type AppState, type Focus } from "../state"

export type Bind = { key: string; desc: string; group: string; run: () => void }

// Human form of a binding key: "<g>shift+t" → "gT", "shift+g" → "G".
export function keyLabel(key: string): string {
  return key.replace("<g>", "g").replace(/^(g?)shift\+([a-z])$/, (_, g, c) => g + c.toUpperCase())
}

// Single source of truth for bindings: registered with the keymap and listed in the help overlay.
export function globalBinds(s: AppState): Bind[] {
  const cycle = (d: number) => {
    s.focus = FOCI[(FOCI.indexOf(s.focus) + d + FOCI.length) % FOCI.length]!
  }
  return [
    { key: "tab", desc: "next panel", group: "panels", run: () => cycle(1) },
    { key: "shift+tab", desc: "prev panel", group: "panels", run: () => cycle(-1) },
    { key: "ctrl+l", desc: "panel right", group: "panels", run: () => cycle(1) },
    { key: "ctrl+h", desc: "panel left", group: "panels", run: () => cycle(-1) },
    { key: ">", desc: "widen panel", group: "panels", run: () => s.resize(4) },
    { key: "<", desc: "narrow panel", group: "panels", run: () => s.resize(-4) },
    { key: "=", desc: "reset sizes", group: "panels", run: () => s.resetLayout() },
    { key: "<g>t", desc: "next app", group: "apps", run: () => s.cycleSource(1) },
    { key: "<g>shift+t", desc: "prev app", group: "apps", run: () => s.cycleSource(-1) },
    { key: "m", desc: "merge apps", group: "apps", run: () => s.toggleMerge() },
    { key: "[", desc: "step back", group: "time", run: () => s.step(-1) },
    { key: "]", desc: "step forward", group: "time", run: () => s.step(1) },
    { key: "{", desc: "back 10", group: "time", run: () => s.step(-10) },
    { key: "}", desc: "forward 10", group: "time", run: () => s.step(10) },
    { key: "shift+h", desc: "back half a track", group: "time", run: () => s.travelBy(-s.trackSpan / 2) },
    { key: "shift+l", desc: "fwd half a track", group: "time", run: () => s.travelBy(s.trackSpan / 2) },
    { key: "home", desc: "first action", group: "time", run: () => s.step(-Infinity) },
    { key: "end", desc: "live", group: "time", run: () => s.goLive() },
    { key: "escape", desc: "live / clear", group: "time", run: () => (s.filter ? (s.filter = "") : s.goLive()) },
    { key: "space", desc: "play / pause", group: "time", run: () => s.togglePlay() },
    { key: "-", desc: "slower", group: "time", run: () => s.setSpeed(-1) },
    { key: "+", desc: "faster", group: "time", run: () => s.setSpeed(1) },
    { key: "shift+d", desc: "dispatch", group: "app", run: () => s.openDispatch() },
    { key: "s", desc: "skip action", group: "app", run: () => s.toggleSkip() },
    { key: "c", desc: "commit here", group: "app", run: () => s.commit() },
    { key: "shift+r", desc: "revert to commit", group: "app", run: () => s.revert() },
    { key: "shift+s", desc: "sweep skipped", group: "app", run: () => s.sweep() },
    { key: "!", desc: "lock app", group: "app", run: () => s.toggleLock() },
    { key: "p", desc: "pause rec", group: "app", run: () => s.togglePause() },
    ...TABS.map((t, i) => ({ key: String(i + 1), desc: t, group: "inspector", run: () => (s.tab = t) })),
    { key: "/", desc: "filter", group: "tools", run: () => ((s.mode = "filter"), (s.input = s.filter)) },
    { key: ":", desc: "command", group: "tools", run: () => ((s.mode = "command"), (s.input = ""), (s.cmdIndex = 0)) },
    { key: "t", desc: "theme", group: "tools", run: () => s.openPicker() },
    { key: "?", desc: "help", group: "tools", run: () => (s.help = true) },
    { key: "q", desc: "quit", group: "tools", run: () => s.quit() },
  ]
}

export function panelBinds(s: AppState, panel: Focus): Bind[] {
  const list = (move: (n: number) => void, edge: (end: boolean) => void): Bind[] => [
    { key: "j", desc: "down", group: panel, run: () => move(1) },
    { key: "k", desc: "up", group: panel, run: () => move(-1) },
    { key: "down", desc: "down", group: panel, run: () => move(1) },
    { key: "up", desc: "up", group: panel, run: () => move(-1) },
    { key: "ctrl+d", desc: "half page down", group: panel, run: () => move(10) },
    { key: "ctrl+u", desc: "half page up", group: panel, run: () => move(-10) },
    { key: "<g>g", desc: "top", group: panel, run: () => edge(false) },
    { key: "shift+g", desc: "bottom", group: panel, run: () => edge(true) },
  ]
  if (panel === "sources") {
    const rows = () => s.sourceRows()
    const open = () => {
      const r = rows()[s.srcCursor]
      if (r) s.activate(r.kind === "store" ? r.store.key : r.source.stores[0]!.key)
    }
    return [
      ...list(
        (n) => (s.srcCursor = Math.max(0, Math.min(rows().length - 1, s.srcCursor + n))),
        (end) => (s.srcCursor = end ? rows().length - 1 : 0),
      ),
      { key: "return", desc: "open", group: panel, run: open },
      { key: "l", desc: "open", group: panel, run: open },
      { key: "dd", desc: "remove offline app", group: panel, run: () => s.removeSource(rows()[s.srcCursor]!.source.id) },
    ]
  }
  if (panel === "actions") {
    return [
      ...list(
        (n) => s.step(n),
        (end) => (end ? s.goLive() : s.step(-Infinity)),
      ),
      { key: "return", desc: "inspect", group: panel, run: () => (s.focus = "inspector") },
    ]
  }
  // inspector: tree navigation, only meaningful on the state tab.
  const tree = () => s.treeRows()
  const v = () => s.view()
  const clampMove = (n: number) => (v().treeCursor = Math.max(0, Math.min(tree().length - 1, v().treeCursor + n)))
  const cur = () => tree()[v().treeCursor]
  const toggle = () => {
    const r = cur()
    if (r?.branch) s.setOpen(r.path, !r.open)
  }
  const collapse = () => {
    const r = cur()
    if (!r) return
    if (r.branch && r.open) return s.setOpen(r.path, false)
    const parent = r.path.split(".").slice(0, -1).join(".")
    const i = tree().findIndex((x) => x.path === parent)
    if (i >= 0) v().treeCursor = i
  }
  const expand = () => {
    const r = cur()
    if (r?.branch && !r.open) s.setOpen(r.path, true)
    else if (r?.branch) clampMove(1)
  }
  return [
    ...list(clampMove, (end) => (v().treeCursor = end ? tree().length - 1 : 0)),
    { key: "h", desc: "collapse", group: panel, run: collapse },
    { key: "left", desc: "collapse", group: panel, run: collapse },
    { key: "l", desc: "expand", group: panel, run: expand },
    { key: "right", desc: "expand", group: panel, run: expand },
    { key: "return", desc: "toggle", group: panel, run: toggle },
    { key: "space", desc: "toggle", group: panel, run: toggle },
  ]
}

const layer = (s: AppState, binds: Bind[]) => ({
  bindings: binds.map((b) => ({
    key: b.key,
    desc: b.desc,
    group: b.group,
    cmd: () => {
      b.run()
      s.emit()
    },
  })),
})

// Mode string drives which layers are live: normal-mode keys must not eat typing.
const modeOf = (s: AppState) => (s.help ? "help" : s.picker ? "picker" : s.confirm ? "confirm" : s.mode)

export function useGlobalKeys(s: AppState) {
  const normal = useMemo(() => reactiveMatcherFromStore(s.subscribe, () => modeOf(s), (m) => m === "normal"), [s])
  const help = useMemo(() => reactiveMatcherFromStore(s.subscribe, () => modeOf(s), (m) => m === "help"), [s])
  const picker = useMemo(() => reactiveMatcherFromStore(s.subscribe, () => modeOf(s), (m) => m === "picker"), [s])
  const typing = useMemo(
    () => reactiveMatcherFromStore(s.subscribe, () => modeOf(s), (m) => m === "filter" || m === "command"),
    [s],
  )

  const confirm = useMemo(() => reactiveMatcherFromStore(s.subscribe, () => modeOf(s), (m) => m === "confirm"), [s])
  const insert = useMemo(() => reactiveMatcherFromStore(s.subscribe, () => modeOf(s), (m) => m === "insert"), [s])
  // The type field has its own keys; in the payload field return and arrows belong to the textarea.
  const typeField = useMemo(
    () => reactiveMatcherFromStore(s.subscribe, () => modeOf(s) === "insert" && s.draft?.field === "type", (on) => on),
    [s],
  )

  useBindings(() => ({ enabled: normal, ...layer(s, globalBinds(s)) }), [normal])
  useBindings(
    () => ({
      enabled: confirm,
      ...layer(s, [
        { key: "y", desc: "yes", group: "confirm", run: () => s.answer(true) },
        { key: "n", desc: "no", group: "confirm", run: () => s.answer(false) },
        { key: "return", desc: "no", group: "confirm", run: () => s.answer(false) },
        { key: "escape", desc: "no", group: "confirm", run: () => s.answer(false) },
      ]),
    }),
    [confirm],
  )
  useBindings(
    () => ({
      enabled: insert,
      ...layer(s, [
        { key: "escape", desc: "cancel", group: "dispatch", run: () => s.closeDispatch() },
        { key: "ctrl+s", desc: "dispatch", group: "dispatch", run: () => s.submitDispatch() },
        {
          key: "tab",
          desc: "switch field",
          group: "dispatch",
          run: () => (s.draft?.field === "type" ? s.acceptType() : s.draft && (s.draft.field = "type")),
        },
      ]),
    }),
    [insert],
  )
  useBindings(
    () => ({
      enabled: typeField,
      ...layer(s, [
        { key: "return", desc: "use type", group: "dispatch", run: () => s.acceptType() },
        { key: "down", desc: "next type", group: "dispatch", run: () => s.movePick(1) },
        { key: "up", desc: "prev type", group: "dispatch", run: () => s.movePick(-1) },
      ]),
    }),
    [typeField],
  )
  useBindings(
    () => ({
      enabled: help,
      ...layer(s, [
        { key: "escape", desc: "close", group: "help", run: () => (s.help = false) },
        { key: "?", desc: "close", group: "help", run: () => (s.help = false) },
        { key: "q", desc: "close", group: "help", run: () => (s.help = false) },
      ]),
    }),
    [help],
  )
  useBindings(
    () => ({
      enabled: picker,
      ...layer(s, [
        {
          key: "escape",
          desc: "cancel",
          group: "theme",
          run: () => {
            if (s.picker) s.setTheme(s.picker.prev)
            s.picker = null
          },
        },
      ]),
    }),
    [picker],
  )
  useBindings(
    () => ({
      enabled: typing,
      ...layer(s, [
        {
          key: "escape",
          desc: "cancel",
          group: "input",
          run: () => {
            if (s.mode === "filter") s.filter = ""
            s.mode = "normal"
          },
        },
        { key: "down", desc: "next", group: "input", run: () => s.cmdIndex++ },
        { key: "tab", desc: "next", group: "input", run: () => s.cmdIndex++ },
        { key: "up", desc: "prev", group: "input", run: () => (s.cmdIndex = Math.max(0, s.cmdIndex - 1)) },
      ]),
    }),
    [typing],
  )
}

export function usePanelKeys(s: AppState, panel: Focus, targetRef: RefObject<Renderable | null>) {
  // Panel keys only apply in normal mode, so overlays and prompts own h/l/j/k.
  const normal = useMemo(() => reactiveMatcherFromStore(s.subscribe, () => modeOf(s), (m) => m === "normal"), [s])
  useBindings(() => ({ targetRef, enabled: normal, ...layer(s, panelBinds(s, panel)) }), [s, panel, normal])
}
