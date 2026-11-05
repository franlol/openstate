import type { Renderable } from "@opentui/core"
import { reactiveMatcherFromStore, useBindings } from "@opentui/keymap/react"
import { useMemo, type RefObject } from "react"
import { OPTIONS } from "../settings"
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
    { key: "v", desc: "visual select", group: "actions", run: () => s.startVisual() },
    { key: "x", desc: "hide this type", group: "actions", run: () => s.hideType() },
    { key: "ya", desc: "yank action", group: "yank", run: () => s.yank("action") },
    { key: "ys", desc: "yank state", group: "yank", run: () => s.yank("state") },
    { key: "yp", desc: "yank tree path", group: "yank", run: () => s.yank("path") },
    { key: "yv", desc: "yank tree value", group: "yank", run: () => s.yank("value") },
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
    // The page asked about on the cursor's row: on its own, or on the row of the app it comes back to (from that
    // app's stores too, where a click on the app puts the cursor).
    const asked = () => {
      const r = rows()[s.srcCursor]
      if (r?.kind !== "store") return r?.origin
      const head = rows().find((x) => x.kind === "source" && x.source === r.source)
      return head?.kind === "source" ? head.origin : undefined
    }
    // enter: lets a page in, opens an app.
    const open = () => {
      const r = rows()[s.srcCursor]
      const o = asked()
      if (o) s.answerOrigin(o.origin, "allow")
      else if (r && r.kind !== "origin") s.activate(r.kind === "store" ? r.store.key : r.source.stores[0]!.key)
    }
    // dd: blocks a waiting page, forgets a blocked one, cuts off a connected app, removes one that is gone.
    const remove = () => {
      const r = rows()[s.srcCursor]
      const o = asked()
      if (o) s.answerOrigin(o.origin, o.access === "pending" ? "block" : "forget")
      else if (r && r.kind !== "origin") s.removeSource(r.source.id)
    }
    return [
      ...list(
        (n) => (s.srcCursor = Math.max(0, Math.min(rows().length - 1, s.srcCursor + n))),
        (end) => (s.srcCursor = end ? rows().length - 1 : 0),
      ),
      { key: "return", desc: "open", group: panel, run: open },
      { key: "l", desc: "open", group: panel, run: open },
      { key: "dd", desc: "disconnect / remove", group: panel, run: remove },
    ]
  }
  if (panel === "actions") {
    return [
      ...list(
        (n) => s.step(n),
        (end) => (end ? s.goLive() : s.step(-Infinity)),
      ),
      { key: "shift+j", desc: "move action down", group: panel, run: () => s.moveAction(1) },
      { key: "shift+k", desc: "move action up", group: panel, run: () => s.moveAction(-1) },
      { key: "shift+u", desc: "restore moved action", group: panel, run: () => s.restoreAction() },
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
    { key: "shift+p", desc: "pin subtree", group: panel, run: () => s.togglePin() },
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
const modeOf = (s: AppState) =>
  s.help ? "help" : s.picker ? "picker" : s.settingsCard ? "settings" : s.confirm ? "confirm" : s.connectCard ? "connect" : s.update?.card ? "update" : s.mode

export function useGlobalKeys(s: AppState) {
  const normal = useMemo(() => reactiveMatcherFromStore(s.subscribe, () => modeOf(s), (m) => m === "normal"), [s])
  const help = useMemo(() => reactiveMatcherFromStore(s.subscribe, () => modeOf(s), (m) => m === "help"), [s])
  const picker = useMemo(() => reactiveMatcherFromStore(s.subscribe, () => modeOf(s), (m) => m === "picker"), [s])
  const settings = useMemo(() => reactiveMatcherFromStore(s.subscribe, () => modeOf(s), (m) => m === "settings"), [s])
  const typing = useMemo(
    () => reactiveMatcherFromStore(s.subscribe, () => modeOf(s), (m) => m === "filter" || m === "command"),
    [s],
  )

  const confirm = useMemo(() => reactiveMatcherFromStore(s.subscribe, () => modeOf(s), (m) => m === "confirm"), [s])
  const visual = useMemo(() => reactiveMatcherFromStore(s.subscribe, () => modeOf(s), (m) => m === "visual"), [s])
  const insert = useMemo(() => reactiveMatcherFromStore(s.subscribe, () => modeOf(s), (m) => m === "insert"), [s])
  // The type field has its own keys; in the payload field return and arrows belong to the textarea.
  const typeField = useMemo(
    () => reactiveMatcherFromStore(s.subscribe, () => modeOf(s) === "insert" && s.draft?.field === "type", (on) => on),
    [s],
  )

  // The waiting screen, before any app: its own keys, above the normal ones (c is commit once there is a store).
  const waiting = useMemo(() => reactiveMatcherFromStore(s.subscribe, () => modeOf(s) === "normal" && !s.store(), (on) => on), [s])
  const update = useMemo(() => reactiveMatcherFromStore(s.subscribe, () => modeOf(s), (m) => m === "update"), [s])
  const connect = useMemo(() => reactiveMatcherFromStore(s.subscribe, () => modeOf(s), (m) => m === "connect"), [s])

  useBindings(() => ({ enabled: normal, ...layer(s, globalBinds(s)) }), [normal])
  useBindings(
    () => ({
      enabled: waiting,
      priority: 10,
      ...layer(s, [
        { key: "c", desc: "connect an app", group: "waiting", run: () => (s.connectCard = true) },
        { key: "d", desc: "demo apps", group: "waiting", run: () => s.startDemo() },
        // The first page waiting for an answer, as shown under the logo.
        { key: "return", desc: "allow page", group: "waiting", run: () => s.waitingOrigin() && s.allowOrigin(s.waitingOrigin()!.origin) },
        { key: "x", desc: "block page", group: "waiting", run: () => s.waitingOrigin()?.access === "pending" && s.blockOrigin(s.waitingOrigin()!.origin) },
      ]),
    }),
    [waiting],
  )
  useBindings(
    () => ({
      enabled: connect,
      ...layer(s, [
        { key: "escape", desc: "close", group: "connect", run: () => (s.connectCard = false) },
        { key: "c", desc: "close", group: "connect", run: () => (s.connectCard = false) },
        { key: "q", desc: "close", group: "connect", run: () => (s.connectCard = false) },
      ]),
    }),
    [connect],
  )
  useBindings(() => {
    const close = () => s.closeUpdate()
    return {
      enabled: update,
      ...layer(s, [
        {
          key: "return",
          desc: "update / restart",
          group: "update",
          run: () => s.confirmUpdate(),
        },
        { key: "j", desc: "scroll the notes", group: "update", run: () => s.scrollNotes(1) },
        { key: "k", desc: "scroll the notes", group: "update", run: () => s.scrollNotes(-1) },
        { key: "down", desc: "scroll the notes", group: "update", run: () => s.scrollNotes(1) },
        { key: "up", desc: "scroll the notes", group: "update", run: () => s.scrollNotes(-1) },
        { key: "escape", desc: "close", group: "update", run: close },
        { key: "q", desc: "close", group: "update", run: close },
      ]),
    }
  }, [update])
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
      enabled: visual,
      ...layer(s, [
        { key: "j", desc: "extend down", group: "visual", run: () => s.step(1) },
        { key: "k", desc: "extend up", group: "visual", run: () => s.step(-1) },
        { key: "down", desc: "extend down", group: "visual", run: () => s.step(1) },
        { key: "up", desc: "extend up", group: "visual", run: () => s.step(-1) },
        { key: "]", desc: "extend down", group: "visual", run: () => s.step(1) },
        { key: "[", desc: "extend up", group: "visual", run: () => s.step(-1) },
        { key: "s", desc: "skip range", group: "visual", run: () => s.visualSkip() },
        { key: "x", desc: "hide types", group: "visual", run: () => s.visualHide() },
        { key: "y", desc: "yank range", group: "visual", run: () => s.visualYank() },
        { key: "v", desc: "exit", group: "visual", run: () => s.endVisual() },
        { key: "escape", desc: "exit", group: "visual", run: () => s.endVisual() },
      ]),
    }),
    [visual],
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
          run: () => s.cancelTheme(),
        },
      ]),
    }),
    [picker],
  )
  useBindings(() => {
    const move = (n: number) => {
      const c = s.settingsCard
      if (c) c.index = Math.max(0, Math.min(OPTIONS.length - 1, c.index + n))
    }
    const close = () => (s.settingsCard = null)
    return {
      enabled: settings,
      ...layer(s, [
        { key: "j", desc: "next option", group: "settings", run: () => move(1) },
        { key: "k", desc: "prev option", group: "settings", run: () => move(-1) },
        { key: "down", desc: "next option", group: "settings", run: () => move(1) },
        { key: "up", desc: "prev option", group: "settings", run: () => move(-1) },
        { key: "l", desc: "next value", group: "settings", run: () => s.stepSetting(1) },
        { key: "h", desc: "prev value", group: "settings", run: () => s.stepSetting(-1) },
        { key: "right", desc: "next value", group: "settings", run: () => s.stepSetting(1) },
        { key: "left", desc: "prev value", group: "settings", run: () => s.stepSetting(-1) },
        { key: "space", desc: "next value", group: "settings", run: () => s.stepSetting(1) },
        { key: "return", desc: "pick or next value", group: "settings", run: () => s.enterSetting() },
        { key: "escape", desc: "close", group: "settings", run: close },
        { key: "q", desc: "close", group: "settings", run: close },
      ]),
    }
  }, [settings])
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
