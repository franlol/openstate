import type { MouseEvent, ScrollBoxRenderable } from "@opentui/core"
import { useEffect, useRef, useState } from "react"
import { homedir } from "node:os"
import { CONFIG_PATH, DEFAULTS, OPTIONS, parseValue, show, type Option, type Settings } from "../settings"
import { hostOf } from "../model"
import { REPO_URL, SHINE_MS } from "../state"
import { updateCommand, VERSION } from "../update"
import { mix, shineGlow, themes, titleShades } from "../theme"
import { BOLD, fit, Footer, Hints, Line, scrollbar, spread, STRIKE, useApp, type Hint, type Part } from "./kit"
import { globalBinds, keyLabel, panelBinds, type Bind } from "./keys"
import { WORDMARK, type Wordmark } from "./wordmark"

const SPIN = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"

// The dots of a braille cell: [column, row, bit].
const BRAILLE_DOTS = [[0, 0, 1], [0, 1, 2], [0, 2, 4], [1, 0, 8], [1, 1, 16], [1, 2, 32], [0, 3, 64], [1, 3, 128]] as const

// The wordmark as a dot grid, so earlier copies of it can be drawn shifted.
function dotGrid(mark: Wordmark): (x: number, y: number) => boolean {
  const w = mark.rows[0]!.length * 2
  const h = mark.rows.length * 4
  const grid = new Uint8Array(w * h)
  mark.rows.forEach((row, r) =>
    [...row].forEach((ch, c) => {
      const bits = ch.codePointAt(0)! - 0x2800
      if (bits > 0) for (const [dx, dy, bit] of BRAILLE_DOTS) if (bits & bit) grid[(r * 4 + dy) * w + c * 2 + dx] = 1
    }),
  )
  return (x, y) => x >= 0 && y >= 0 && x < w && y < h && grid[y * w + x] === 1
}

// The two earlier frames behind the name: how many dots back, and how far each sinks into the background.
const GHOSTS = [
  [0, 0],
  [1, 0.72],
  [2, 0.86],
] as const

// The name in braille, its halves in the header's two shades, trailed by two fainter copies of itself: the states
// it has left behind. A shine centred on letter `at` can run across it.
function Logo({ bg, at = -Infinity }: { bg: string; at?: number }) {
  const t = useApp().theme
  const c = titleShades(t)
  const mark = WORDMARK.big
  const on = dotGrid(mark)
  // Dots between one copy and the next.
  const shift = 4
  const cols = mark.rows[0]!.length + shift
  const letterAt = (col: number) => mark.letters.reduce((n, start, i) => (col >= start ? i : n), 0)
  const colorOf = (col: number) => {
    const i = letterAt(col)
    return mix(i < 4 ? c.open : c.state, t.shine, shineGlow(i, at))
  }
  return (
    <box flexDirection="column" flexShrink={0}>
      {mark.rows.map((_, r) => {
        const parts: Part[] = []
        for (let col = 0; col < cols; col++) {
          let cell: Part = [" ", bg]
          // A cell shows the newest copy that reaches it, in that copy's colour.
          for (const [back, fade] of GHOSTS) {
            const offset = shift * (2 - back)
            let bits = 0
            for (const [dx, dy, bit] of BRAILLE_DOTS) if (on(col * 2 + dx - offset, r * 4 + dy)) bits |= bit
            if (bits) {
              cell = [String.fromCodePoint(0x2800 + bits), mix(colorOf(col - offset / 2), bg, fade)]
              break
            }
          }
          const last = parts.at(-1)
          if (last && last[1] === cell[1]) last[0] += cell[0]
          else parts.push(cell)
        }
        return <Line key={r} parts={parts} bg={bg} />
      })}
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
      <Logo bg={t.bg} />
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
  const asking = s.waitingOrigin()
  const keys: Hint[] = [
    { key: "c", desc: "connect an app", run: () => (s.connectCard = true) },
    { key: "d", desc: "demo", run: () => s.startDemo() },
    { key: "?", desc: "keys", run: () => (s.help = true) },
  ]
  return (
    <box flexGrow={1} alignItems="center" justifyContent="center" flexDirection="column" backgroundColor={t.bg}>
      <Logo bg={t.bg} at={at} />
      <box height={2} />
      <Line parts={status} bg={t.bg} />
      {/* Apps send to 8000 by default, so another port is the first thing to suspect when nothing shows up. */}
      {s.settings.port !== 8000 && (
        <Line parts={[["⚠ ", t.warn, BOLD], [`apps send to :8000 by default · :set port& goes back · c says how to point them here`, t.warn]]} bg={t.bg} />
      )}
      {asking && (
        <box flexDirection="row" height={1} marginTop={1}>
          {asking.access === "pending" ? (
            <Line parts={[["? ", t.warn, BOLD], [hostOf(asking.origin), t.fg, BOLD], [" wants to connect   ", t.muted]]} bg={t.bg} />
          ) : (
            <Line parts={[["✗ ", t.remove, BOLD], [hostOf(asking.origin), t.muted, STRIKE], [" is blocked, still trying   ", t.muted]]} bg={t.bg} />
          )}
          <Hints
            hints={[
              { key: "✓", desc: "allow", run: () => s.allowOrigin(asking.origin), fg: t.add },
              ...(asking.access === "pending" ? [{ key: "✗", desc: "block", run: () => s.blockOrigin(asking.origin), fg: t.remove }] : []),
            ]}
            bg={t.bg}
          />
        </box>
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
    code("npm i -D @openstate-devtools/client"),
    code('import "@openstate-devtools/client"', "first import of the app"),
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
  foot?: { note?: Part[]; left?: React.ReactNode; hints: Hint[] }
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
        {props.foot && <Footer note={props.foot.note} left={props.foot.left} hints={props.foot.hints} width={props.width - 4} />}
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
// Every value an option can take, so the card shows the choice rather than one value. A typed option shows its own.
function choices(o: Option, st: Settings): string[] {
  if (o.typed || o.name === "theme") return [show(o.name, st)]
  if (o.kind === "bool") return ["on", "off"]
  if (o.kind === "number") return [...new Set([...(o.steps ?? []), st[o.name] as number])].sort((a, b) => a - b).map(String)
  return o.values!()
}

export function SettingsCard({ width }: { width: number }) {
  const s = useApp()
  const t = s.theme
  const card = s.settingsCard
  if (!card) return null
  const w = Math.min(width - 4, 66)
  const inner = w - 4
  const cur = OPTIONS[card.index]!
  // What enter does on the highlighted option, when it is more than stepping to the next value.
  const action = cur.name === "theme" ? "pick" : cur.typed ? "edit" : cur.kind === "number" ? "custom" : null
  const nameW = Math.max(...OPTIONS.map((o) => o.name.length)) + 3
  const chip = (v: string) => ` ${v} `
  return (
    <Modal
      title="settings"
      width={w}
      height={OPTIONS.length + 7}
      foot={{
        hints: [
          ...(action ? [{ key: "enter", desc: action, run: () => s.enterSetting() }] : []),
          { key: "esc", desc: "close", run: () => (s.settingsCard = null) },
        ],
      }}
    >
      {OPTIONS.map((o, i) => {
        const on = i === card.index
        const value = show(o.name, s.settings)
        const values = choices(o, s.settings)
        const changed = s.settings[o.name] !== DEFAULTS[o.name]
        const left: Part[] = [
          [on ? "▌" : " ", t.accent],
          [o.name, on ? t.fg : t.sources[1]!, BOLD],
          [changed ? " •" : "  ", t.accent],
          [" ".repeat(nameW - o.name.length - 2), t.fg],
          ...(o.name === "theme" ? [[" ", t.fg] as Part, ...t.sources.map((c): Part => ["●", c])] : []),
          ...values.flatMap((v, j): Part[] => [
            [!j && o.name === "theme" ? " " : "", t.fg],
            // The value in use looks the same on every row, so the highlight of the row never hides it.
            v === value ? [chip(v), t.accent, BOLD] : [chip(v), t.dim],
          ]),
        ]
        return (
          <Line
            key={o.name}
            bg={on ? t.selBg : t.panel}
            parts={fit(left, inner)}
            onMouseDown={(e) => {
              card.index = i
              // Which value was clicked: the chips start after the name and, for themes, the swatch.
              let x = e.x - e.currentTarget!.x - 1 - nameW - (o.name === "theme" ? t.sources.length + 2 : 0)
              for (const v of values) {
                if (x >= 0 && x < chip(v).length) {
                  if (o.name === "theme" || o.typed) s.enterSetting()
                  else if (v !== value) s.applySettings({ [o.name]: parseValue(o, v) })
                  break
                }
                x -= chip(v).length
              }
              s.emit()
            }}
          />
        )
      })}
      <Line parts={[["─".repeat(inner), t.border]]} />
      <Line parts={fit([[` ${cur.desc}`, t.fg, BOLD]], inner)} />
      <Line parts={fit([[` ${cur.help}`, t.muted], [cur.kind === "number" ? ` · ${cur.min}–${cur.max}` : "", t.dim]], inner)} />
      <Line parts={[[" ", t.dim]]} />
      <Line parts={fit([[` saved to ${CONFIG_PATH.replace(homedir(), "~")}`, t.dim]], inner)} />
    </Modal>
  )
}

// Keys that do one thing and its opposite share a row in the help: `[ ]  step back / forward`.
const PAIRS: [string, string, string][] = [
  ["tab", "shift+tab", "next / prev panel"],
  [">", "<", "widen / narrow"],
  ["<g>t", "<g>shift+t", "next / prev app"],
  ["[", "]", "step back / forward"],
  ["{", "}", "back / forward 10"],
  ["shift+h", "shift+l", "½ track back / fwd"],
  ["home", "end", "first / live"],
  ["-", "+", "slower / faster"],
  ["shift+j", "shift+k", "move down / up"],
  ["ctrl+d", "ctrl+u", "half page down / up"],
  ["<g>g", "shift+g", "top / bottom"],
  ["h", "l", "collapse / expand"],
]
const SHORT: Record<string, string> = { return: "enter", escape: "esc", "shift+tab": "S-tab", "ctrl+d": "^d", "ctrl+u": "^u" }
const helpKey = (key: string) => SHORT[key] ?? keyLabel(key)
// Fixed columns, so related groups sit together and the card reads left to right.
const HELP_COLUMNS = [
  ["lists", "panels", "apps", "tools"],
  ["time", "inspector", "yank"],
  ["app", "actions", "sources"],
]

export function Help({ width, height }: { width: number; height: number }) {
  const s = useApp()
  const t = s.theme
  if (!s.help) return null
  // List navigation is shared by every panel, so it is listed once under "lists".
  const nav = new Set(["j", "k", "up", "down", "left", "right", "ctrl+d", "ctrl+u", "<g>g", "shift+g", "ctrl+l", "ctrl+h"])
  const all: Bind[] = [
    // Said once here, for panels and cards alike, so the cards need not repeat it.
    { key: "hjkl", desc: "move everywhere", group: "lists", run: () => {} },
    ...globalBinds(s),
    ...panelBinds(s, "actions").map((b) => ({ ...b, group: nav.has(b.key) ? "lists" : "actions" })),
    ...panelBinds(s, "sources").filter((b) => !nav.has(b.key)),
    ...panelBinds(s, "inspector").filter((b) => !nav.has(b.key) || b.key === "h" || b.key === "l"),
    // Not keys, but the way into options; listed so they are found from here.
    { key: ":set", desc: "settings", group: "tools", run: () => {} },
  ]
  const groups = new Map<string, [string, string][]>()
  for (const b of all) {
    const rows = groups.get(b.group) ?? []
    groups.set(b.group, rows)
    if (["j", "k", "up", "down", "left", "right", "ctrl+l", "ctrl+h", "space"].includes(b.key) && b.group !== "time") continue
    const pair = PAIRS.find(([a, z]) => a === b.key || z === b.key)
    if (pair) {
      if (pair[0] === b.key) rows.push([`${helpKey(pair[0])} ${helpKey(pair[1])}`, pair[2]])
      continue
    }
    // Under "yank", the word itself goes without saying.
    const desc = b.group === "yank" ? b.desc.replace(/^yank /, "") : b.desc
    if (!rows.some(([, d]) => d === desc)) rows.push([helpKey(b.key), desc])
  }
  // The inspector's tabs, one row instead of five.
  const tabs = groups.get("inspector")
  if (tabs) groups.set("inspector", [["1-5", "state … raw tabs"], ...tabs.filter(([k]) => !/^[1-5]$/.test(k))])
  const w = Math.min(width - 4, 100)
  const cols: Part[][][] = HELP_COLUMNS.map((names) => {
    const keyW = Math.max(...names.flatMap((n) => groups.get(n) ?? []).map(([k]) => k.length)) + 2
    return names.flatMap((name, i) => {
      const rows = groups.get(name) ?? []
      if (!rows.length) return []
      return [
        ...(i ? [[[" ", t.dim]] as Part[]] : []),
        [[` ${name}`, t.accent, BOLD]] as Part[],
        ...rows.map(([k, d]): Part[] => [[`  ${k.padEnd(keyW)}`, t.fg, BOLD], [d, t.muted]]),
      ]
    })
  })
  // Each column as wide as its longest row, the room left over shared out evenly.
  const natural = cols.map((col) => Math.max(...col.map((parts) => parts.reduce((n, [x]) => n + x.length, 0))) + 2)
  const spare = Math.floor((w - 4 - natural.reduce((a, b) => a + b, 0)) / cols.length)
  const colWs = natural.map((n) => Math.max(8, n + spare))
  const rows = Math.max(...cols.map((x) => x.length))
  return (
    <Modal
      title="keys"
      width={w}
      height={Math.min(height - 3, rows + 3)}
      foot={{
        left: <RepoLink label="github" bg={t.panel} before={[[" ", t.dim]]} />,
        hints: [{ key: "esc", desc: "close", run: () => (s.help = false) }],
      }}
    >
      <box flexDirection="row" flexGrow={1} overflow="hidden">
        {cols.map((col, i) => (
          <box key={i} width={colWs[i]} flexDirection="column">
            {col.map((parts, j) => (
              <Line key={j} parts={fit(parts, colWs[i]!)} />
            ))}
          </box>
        ))}
      </box>
      <Line parts={[[" ", t.dim]]} />
    </Modal>
  )
}
