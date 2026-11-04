import type { MouseEvent, ScrollBoxRenderable } from "@opentui/core"
import { Fragment, useEffect, useRef, useState } from "react"
import { homedir } from "node:os"
import { CONFIG_PATH, DEFAULTS, format, OPTIONS, show } from "../settings"
import { REPO_URL, SHINE_MS } from "../state"
import { updateCommand, VERSION } from "../update"
import { mix, shineGlow, themes, titleShades } from "../theme"
import { BOLD, fit, Footer, Hints, Line, scrollbar, spread, useApp, type Hint, type Part } from "./kit"
import { globalBinds, keyLabel, panelBinds, type Bind } from "./keys"

const SPIN = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"

// A font's two colours: the fill, and its shadow (the block font's ╗═ edges) sunk halfway into the background.
const shaded = (fill: string, bg: string) => [fill, mix(fill, bg, 0.5)]

// The name in large letters, its halves in the header's two shades. Drawn a letter at a time (the font's one-cell
// gap between letters added back), so a shine centred on letter `at` can run across it.
function Logo({ font, bg, at = -Infinity }: { font: "block" | "tiny"; bg: string; at?: number }) {
  const t = useApp().theme
  const c = titleShades(t)
  return (
    <box flexDirection="row">
      {[..."openstate"].map((ch, i) => (
        <Fragment key={i}>
          {i > 0 && <box width={1} backgroundColor={bg} />}
          <ascii-font text={ch} font={font} color={shaded(mix(i < 4 ? c.open : c.state, t.shine, shineGlow(i, at)), bg)} backgroundColor={bg} />
        </Fragment>
      ))}
    </box>
  )
}

export function Splash() {
  const s = useApp()
  const t = s.theme
  const [frame, setFrame] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setFrame((f) => f + 1), 80)
    return () => clearInterval(id)
  }, [])
  const found = s.sources.filter((x) => x.stores.some((st) => st.actions.length > 1))
  return (
    <box flexGrow={1} alignItems="center" justifyContent="center" flexDirection="column" backgroundColor={t.bg}>
      <Logo font="block" bg={t.bg} />
      <box height={1} />
      <text>
        <span fg={t.accent}>{SPIN[frame % SPIN.length]} </span>
        <span fg={t.muted}>{s.demo ? "starting demo apps" : "waiting for apps on "}</span>
        <span fg={t.fg}>{s.demo ? "" : `ws://localhost:${s.settings.port}`}</span>
      </text>
      <box height={1} />
      {found.map((src) => (
        <text key={src.id}>
          <span fg={t.sources[src.color % t.sources.length]!}>● </span>
          <span fg={t.fg} attributes={BOLD}>
            {src.name}
          </span>
          <span fg={t.muted}> connected · {src.stores.map((st) => st.lib).join(", ")}</span>
        </text>
      ))}
    </box>
  )
}

// No app connected yet: how to connect one, in place of the panels.
// Before any app connects: the logo, a signal that searches while openstate listens, and the few keys that help.
// How to connect lives in the card behind `c`.
const SHINE_EVERY_MS = 4000
const RADAR = 5
export function Waiting() {
  const s = useApp()
  const t = s.theme
  const [frame, setFrame] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setFrame((f) => f + 1), 80)
    return () => clearInterval(id)
  }, [])
  // The shine of the header title, again every few seconds; the 9 letters plus 2 on each side.
  const since = (frame * 80) % SHINE_EVERY_MS
  const at = s.settings.flash ? (since / SHINE_MS) * 13 - 2 : -Infinity
  // The dot goes back and forth, a cell every other frame, its neighbours half lit.
  const step = Math.floor(frame / 2) % (2 * (RADAR - 1))
  const pos = step < RADAR ? step : 2 * (RADAR - 1) - step
  const radar: Part[] = Array.from({ length: RADAR }, (_, i): Part =>
    i === pos ? ["●", t.accent, BOLD] : ["·", Math.abs(i - pos) === 1 ? t.muted : t.dim],
  ).flatMap((p, i) => (i ? [["  ", t.bg] as Part, p] : [p]))
  const status: Part[] = s.listenError
    ? [["✗ ", t.remove, BOLD], [`not listening: ${s.listenError}`, t.remove], [" · :set port=<another>", t.muted]]
    : [...radar, ["   listening on ", t.muted], [`:${s.settings.port}`, t.fg, BOLD]]
  const sep = "  ·  "
  const keys: Hint[] = [
    { key: "c", desc: "connect an app", run: () => (s.connectCard = true) },
    { key: "d", desc: "demo", run: () => s.startDemo() },
    { key: "?", desc: "keys", run: () => (s.help = true) },
  ]
  return (
    <box flexGrow={1} alignItems="center" justifyContent="center" flexDirection="column" backgroundColor={t.bg}>
      <Logo font="block" bg={t.bg} at={at} />
      <box height={2} />
      <Line parts={status} bg={t.bg} />
      {/* Apps send to 8000 by default, so another port is the first thing to suspect when nothing shows up. */}
      {s.settings.port !== 8000 && (
        <Line parts={[["⚠ ", t.warn, BOLD], [`apps send to :8000 by default · :set port& goes back · c says how to point them here`, t.warn]]} bg={t.bg} />
      )}
      <box height={2} />
      <box flexDirection="row" height={1}>
        <Hints hints={keys} bg={t.bg} sep={sep} />
        <RepoLink label="github" bg={t.bg} before={[[sep, t.dim]]} />
      </box>
    </box>
  )
}

// `c` on the waiting screen: how each kind of app reaches openstate.
export function ConnectCard({ width }: { width: number }) {
  const s = useApp()
  const t = s.theme
  if (!s.connectCard) return null
  const port = s.settings.port
  const url = `ws://localhost:${port}`
  const head = (text: string): Part[] => [[text, t.fg, BOLD]]
  const code = (text: string, note = ""): Part[] => [[`  ${text}`, t.add], [note ? `   ${note}` : "", t.dim]]
  const lines: Part[][] = [
    head("Redux, zustand or jotai"),
    code("npm install openstate"),
    code('import "openstate/client"', "first import of the app"),
    [],
    head("Already using @redux-devtools/remote"),
    [[port === 8000 ? "  Nothing to add: it already sends to port 8000." : `  Nothing to add but port: ${port} in its options.`, t.muted]],
    ...(port === 8000
      ? []
      : ([
          [],
          head(`openstate is on port ${port}`),
          code(`OPENSTATE_URL=${url}`),
          code(`NEXT_PUBLIC_OPENSTATE_URL=${url}`, "Next.js"),
        ] as Part[][])),
  ]
  const w = Math.min(width - 4, 72)
  return (
    <Modal title="connect an app" width={w} height={lines.length + 3} foot={{ hints: [{ key: "esc", desc: "close", run: () => (s.connectCard = false) }] }}>
      {lines.map((parts, i) => (
        <Line key={i} parts={parts.length ? fit(parts, w - 4) : [[" ", t.dim]]} />
      ))}
      <box height={1} />
    </Modal>
  )
}

// Words into lines of at most `width` cells.
function wrap(text: string, width: number): string[] {
  const out: string[] = []
  let line = ""
  for (const word of text.split(/\s+/)) {
    if (line && line.length + 1 + word.length > width) out.push(line), (line = "")
    line = line ? `${line} ${word}` : word
  }
  return [...out, line]
}

// A thin bar: heavy line for what is done (half cells too), the same line faint for what is left.
function bar(value: number, width: number, color: string, track: string): Part[] {
  const halves = Math.round(Math.max(0, Math.min(1, value)) * width * 2)
  const done = "━".repeat(halves >> 1) + (halves & 1 ? "╸" : "")
  return [[done, color], ["━".repeat(width - done.length), track]]
}

const NOTES_ROWS = 7

// :update, or the ↑ in the statusline: what the new version brings, then the install as it goes, then restart.
export function UpdateCard({ width }: { width: number }) {
  const s = useApp()
  const t = s.theme
  const u = s.update
  const notesRef = useRef<ScrollBoxRenderable>(null)
  useEffect(() => {
    s.scrollNotes = (rows) => notesRef.current?.scrollBy(rows)
    return () => void (s.scrollNotes = () => {})
  }, [s])
  if (!u?.card) return null
  const w = Math.min(width - 4, 64)
  const inner = w - 4
  const canInstall = !!updateCommand()

  // Room for the text inside the box's border and padding, and its scrollbar when the notes do not fit.
  const long = (u.notes ?? []).reduce((n, note) => n + wrap(note, inner - 4).length, 0) > NOTES_ROWS
  const textWidth = inner - (long ? 5 : 4)
  const notes: Part[][] =
    u.notes === undefined
      ? [[["loading…", t.dim]]]
      : u.notes.length
        ? u.notes.flatMap((note) => wrap(note, textWidth).map((l, i): Part[] => [[i ? "  " : "• ", t.accent], [l, i ? t.muted : t.fg]]))
        : [[["no notes for this version", t.dim]]]
  const notesRows = Math.min(notes.length, NOTES_ROWS)

  const enter = (desc: string): Hint => ({ key: "enter", desc, run: () => s.confirmUpdate() })
  const esc = (desc: string): Hint => ({ key: "esc", desc, run: () => s.closeUpdate() })
  const keys = (...hs: Hint[]) => hs
  const pct = Math.round(u.progress.value * 100)
  const [color, status, hint]: [string, Part[], Hint[]] =
    !canInstall
      ? [t.dim, [["from a clone of the repo: git pull", t.muted]], keys(esc("close"))]
      : u.phase === "offer"
        ? [t.accent, [["ready to install", t.muted]], keys(enter("update"), esc("later"))]
        : u.phase === "running"
          ? [t.accent, [[`${u.progress.stage}…`, t.fg]], keys(esc("hide"))]
          : u.phase === "done"
            ? [t.add, [["✓ installed", t.add, BOLD]], keys(enter("restart"), esc("later"))]
            : [t.remove, [["✗ ", t.remove, BOLD], [u.output ?? "failed", t.remove]], keys(enter("retry"), esc("close"))]
  const shown = u.phase === "offer" ? 0 : pct

  return (
    <Modal title="update" width={w} height={notesRows + 8} foot={{ note: status, hints: hint }}>
      <Line parts={spread([], [[VERSION, t.dim], ["  →  ", t.muted], [u.latest, t.accent, BOLD]], inner)} />
      <box height={1} />
      <box
        height={notesRows + 2}
        border
        borderStyle="rounded"
        borderColor={t.border}
        title=" what's new "
        titleColor={t.muted}
        paddingLeft={1}
        paddingRight={1}
      >
        <scrollbox ref={notesRef} flexGrow={1} verticalScrollbarOptions={{ ...scrollbar(t), visible: long }}>
          {notes.map((parts, i) => (
            <Line key={i} parts={parts} />
          ))}
        </scrollbox>
      </box>
      <box height={1} />
      <Line parts={[...bar(shown / 100, inner - 5, color, t.border), [`${shown}%`.padStart(5), shown ? t.fg : t.dim, BOLD]]} />
    </Modal>
  )
}

// The project's page, to star it; lights up under the pointer, a click opens it. `before` and `after` frame it
// without being part of the link.
function RepoLink(props: { width?: number; bg?: string; label?: string; before?: Part[]; after?: Part[] }) {
  const { width, bg, label = REPO_URL.replace(/^https:\/\//, ""), before = [], after = [] } = props
  const s = useApp()
  const t = s.theme
  const [hover, setHover] = useState(false)
  const link: Part[] = [
    ["★ ", t.warn, hover ? BOLD : undefined],
    [label, hover ? t.fg : t.muted, hover ? BOLD : undefined],
  ]
  const lenOf = (ps: Part[]) => ps.reduce((n, [x]) => n + x.length, 0)
  const parts = [...before, ...link, ...after]
  // Only the link itself responds, not what frames it or the rest of the line.
  const over = (e: MouseEvent) => {
    const x = e.x - e.currentTarget!.x
    return x >= lenOf(before) && x < lenOf(before) + lenOf(link)
  }
  return (
    <Line
      parts={width ? fit(parts, width) : parts}
      bg={bg}
      onMouseDown={(e) => over(e) && (s.openRepo(), s.emit())}
      onMouseMove={(e) => setHover(over(e))}
      onMouseOut={() => setHover(false)}
    />
  )
}

// A centred card. `foot` is its last row (a note, then its keys); `footer` sits on the bottom border.
function Modal(props: {
  title: string
  width: number
  height: number
  foot?: { note?: Part[]; hints: Hint[] }
  footer?: React.ReactNode
  children: React.ReactNode
}) {
  const t = useApp().theme
  return (
    <box position="absolute" top={0} left={0} width="100%" height="100%" alignItems="center" justifyContent="center" zIndex={30}>
      <box
        width={props.width}
        height={props.height + (props.foot ? 1 : 0)}
        border
        borderStyle="rounded"
        borderColor={t.borderActive}
        title={` ${props.title} `}
        titleColor={t.accent}
        backgroundColor={t.panel}
        flexDirection="column"
        paddingLeft={1}
        paddingRight={1}
      >
        {props.children}
        {props.foot && <Footer note={props.foot.note} hints={props.foot.hints} width={props.width - 4} />}
        {/* Over the bottom border, at the right, like the panels' counters. */}
        {props.footer && (
          <box position="absolute" bottom={-1} right={1}>
            {props.footer}
          </box>
        )}
      </box>
    </box>
  )
}

export function ThemePicker() {
  const s = useApp()
  const t = s.theme
  if (!s.picker) return null
  return (
    <Modal
      title="theme"
      width={36}
      height={themes.length + 3}
      foot={{
        hints: [
          { key: "enter", desc: "keep", run: () => s.keepTheme() },
          { key: "esc", desc: "cancel", run: () => s.cancelTheme() },
        ],
      }}
    >
      <select
        focused
        flexGrow={1}
        options={themes.map((th) => ({ name: th.name, description: "", value: th.id }))}
        selectedIndex={s.picker.index}
        showDescription={false}
        backgroundColor={t.panel}
        focusedBackgroundColor={t.panel}
        textColor={t.muted}
        focusedTextColor={t.muted}
        selectedBackgroundColor={t.selBg}
        selectedTextColor={t.accent}
        onChange={(i) => {
          // Live preview while moving through the list.
          s.setTheme(themes[i]!.id)
          if (s.picker) s.picker.index = i
          s.emit()
        }}
        onSelect={() => {
          s.keepTheme()
          s.emit()
        }}
        // A click previews a theme, like moving to it; a click on the previewed one keeps it, like enter.
        onMouseDown={(e) => {
          const i = e.y - e.currentTarget!.y
          if (!s.picker || !themes[i]) return
          if (i === s.picker.index) s.keepTheme()
          else (s.picker.index = i), s.setTheme(themes[i]!.id)
          s.emit()
        }}
      />
      <box height={1} />
    </Modal>
  )
}

// `:set` with no arguments: every option, its value and what it does; changes save at once.
export function SettingsCard({ width }: { width: number }) {
  const s = useApp()
  const t = s.theme
  const card = s.settingsCard
  if (!card) return null
  const w = Math.min(width - 4, 72)
  const inner = w - 4
  const valW = Math.max(...OPTIONS.flatMap((o) => (o.values?.() ?? [show(o.name, s.settings)]).map((v) => v.length))) + 5
  const cur = OPTIONS[card.index]!
  const nameW = Math.max(...OPTIONS.map((o) => o.name.length)) + 2
  return (
    <Modal
      title="settings"
      width={w}
      height={OPTIONS.length + 5}
      foot={{
        note: [[` saved to ${CONFIG_PATH.replace(homedir(), "~")}`, t.dim]],
        hints: [
          { key: "esc", desc: "close", run: () => (s.settingsCard = null) },
        ],
      }}
    >
      {OPTIONS.map((o, i) => {
        const on = i === card.index
        const v = show(o.name, s.settings)
        const changed = s.settings[o.name] !== DEFAULTS[o.name]
        const value = on && !o.typed ? `‹ ${v} ›` : `  ${v}  `
        return (
          <Line
            key={o.name}
            bg={on ? t.selBg : t.panel}
            parts={fit(
              [
                [on ? "▌" : " ", t.accent],
                [o.name.padEnd(nameW), on ? t.fg : t.sources[1]!, BOLD],
                [value.padEnd(valW), changed ? t.accent : t.fg, changed ? BOLD : undefined],
                [o.desc, t.muted],
              ],
              inner,
            )}
            onMouseDown={() => {
              if (on) s.stepSetting(1)
              else card.index = i
              s.emit()
            }}
          />
        )
      })}
      <Line parts={[[" ", t.dim]]} />
      {/* The command-line form of the highlighted option, so the card also teaches :set. */}
      <Line parts={fit([[" :set ", t.dim], [format(cur.name, s.settings), t.fg], [`  ${cur.help}`, t.muted]], inner)} />
      <Line parts={[[" ", t.dim]]} />
    </Modal>
  )
}

export function Help({ width, height }: { width: number; height: number }) {
  const s = useApp()
  const t = s.theme
  if (!s.help) return null
  // List navigation is shared by every panel, so it is listed once under "lists".
  const nav = new Set(["j", "k", "up", "down", "left", "right", "ctrl+d", "ctrl+u", "<g>g", "shift+g", "ctrl+l", "ctrl+h"])
  const all = [
    // Said once here, for panels and cards alike, so the cards need not repeat it.
    { key: "hjkl", desc: "move everywhere", group: "lists", run: () => {} },
    ...globalBinds(s),
    ...panelBinds(s, "actions").map((b) => ({ ...b, group: nav.has(b.key) ? "lists" : "actions" })),
    ...panelBinds(s, "sources").filter((b) => !nav.has(b.key)),
    ...panelBinds(s, "inspector").filter((b) => !nav.has(b.key) || b.key === "h" || b.key === "l"),
    // Not keys, but the way into options; listed so they are found from here.
    { key: ":set", desc: "settings", group: "tools", run: () => {} },
    { key: ":set x=v", desc: "change one", group: "tools", run: () => {} },
  ]
  const groups = new Map<string, Bind[]>()
  for (const b of all) {
    const g = groups.get(b.group) ?? []
    if (!["j", "k", "up", "down", "left", "right", "ctrl+l", "ctrl+h"].includes(b.key) && !g.some((x) => x.desc === b.desc)) g.push(b)
    groups.set(b.group, g)
  }
  const w = Math.min(width - 4, 96)
  const colW = Math.floor((w - 4) / 3)
  const cols: Part[][][] = [[], [], []]
  // Greedy fill: each group goes to the currently shortest column.
  for (const [name, binds] of groups) {
    const col = cols.reduce((a, b) => (b.length < a.length ? b : a))
    col.push([[name, t.accent, BOLD]])
    for (const b of binds) col.push([[` ${keyLabel(b.key).padEnd(10)}`, t.fg, BOLD], [b.desc, t.muted]])
    col.push([[" ", t.dim]])
  }
  const rows = Math.max(...cols.map((x) => x.length))
  // The logo is the first thing to go when the terminal is short.
  const logo = height - 2 >= rows + 7
  return (
    <Modal
      title="keys"
      width={w}
      height={Math.min(height - 2, rows + (logo ? 6 : 3))}
      footer={<RepoLink label="github" bg={t.panel} before={[[" ", t.dim]]} after={[[" ", t.dim]]} />}
    >
      {logo && <Logo font="tiny" bg={t.panel} />}
      <box flexDirection="row" flexGrow={1} overflow="hidden">
        {cols.map((col, i) => (
          <box key={i} width={colW} flexDirection="column">
            {col.map((parts, j) => (
              <Line key={j} parts={fit(parts, colW)} />
            ))}
          </box>
        ))}
      </box>
    </Modal>
  )
}
