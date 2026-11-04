import { useEffect, useState } from "react"
import { homedir } from "node:os"
import { CONFIG_PATH, DEFAULTS, format, OPTIONS, show } from "../settings"
import { themes, titleShades } from "../theme"
import { BOLD, fit, Line, useApp, type Part } from "./kit"
import { globalBinds, keyLabel, panelBinds, type Bind } from "./keys"

const SPIN = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"

// The name in large letters, its halves in the header's two shades.
function Logo({ font, bg }: { font: "block" | "tiny"; bg: string }) {
  const c = titleShades(useApp().theme)
  return (
    <box flexDirection="row">
      <ascii-font text="open" font={font} color={c.open} backgroundColor={bg} />
      {/* The letter gap the font puts inside a word, lost between two. */}
      <box width={1} backgroundColor={bg} />
      <ascii-font text="state" font={font} color={c.state} backgroundColor={bg} />
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
export function Waiting() {
  const s = useApp()
  const t = s.theme
  const [frame, setFrame] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setFrame((f) => f + 1), 80)
    return () => clearInterval(id)
  }, [])
  const url = `ws://localhost:${s.settings.port}`
  const code = (text: string): Part[] => [["  " + text, t.fg]]
  const lines: Part[][] = [
    s.listenError
      ? [["✗ ", t.remove, BOLD], [`not listening: ${s.listenError}`, t.remove], [" · :set port=<another>", t.muted]]
      : [[SPIN[frame % SPIN.length]! + " ", t.accent], ["waiting for apps on ", t.muted], [url, t.fg, BOLD]],
    [],
    // Apps send to 8000 by default, so another port is the first thing to suspect when nothing shows up.
    ...(s.settings.port === 8000
      ? []
      : ([
          [["⚠ ", t.warn, BOLD], [`apps send to :8000 by default, not :${s.settings.port}`, t.warn], [" · :set port& to go back", t.muted]],
          [["  or tell the apps: ", t.muted], [`OPENSTATE_URL=${url}`, t.fg], [" · remote ", t.muted], [`port ${s.settings.port}`, t.fg]],
          [],
        ] as Part[][])),
    [["Apps using Redux DevTools remote ", t.muted], ["(React Native, Node)", t.dim]],
    [["connect as they are: openstate speaks that protocol on this port.", t.muted]],
    [],
    [["Anything else: make this the first import of the app.", t.muted]],
    code('import "openstate/client"'),
    [["Redux Toolkit, zustand's devtools and jotai-devtools then report here.", t.muted]],
    [],
    [["No app at hand? ", t.dim], ["openstate --demo", t.fg], [" runs sample apps.", t.dim]],
  ]
  return (
    <box flexGrow={1} alignItems="center" justifyContent="center" flexDirection="column" backgroundColor={t.bg}>
      <Logo font="block" bg={t.bg} />
      <box height={1} />
      <box flexDirection="column" width={72}>
        {lines.map((parts, i) => (
          <Line key={i} parts={parts.length ? fit(parts, 72) : [[" ", t.dim]]} bg={t.bg} />
        ))}
      </box>
    </box>
  )
}

function Modal(props: { title: string; width: number; height: number; children: React.ReactNode }) {
  const t = useApp().theme
  return (
    <box position="absolute" top={0} left={0} width="100%" height="100%" alignItems="center" justifyContent="center" zIndex={30}>
      <box
        width={props.width}
        height={props.height}
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
      </box>
    </box>
  )
}

export function ThemePicker() {
  const s = useApp()
  const t = s.theme
  if (!s.picker) return null
  return (
    <Modal title="theme" width={36} height={themes.length + 4}>
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
        onSelect={(i) => {
          s.picker = null
          s.applySettings({ theme: themes[i]!.id })
          s.emit()
        }}
      />
      <text>
        <span fg={t.dim}>j/k preview · enter keep · esc cancel</span>
      </text>
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
  return (
    <Modal title="settings" width={w} height={OPTIONS.length + 7}>
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
                [o.name.padEnd(8), on ? t.fg : t.sources[1]!, BOLD],
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
      <Line parts={fit([[" j/k option · h/l change · esc close · accent: changed from default", t.dim]], inner)} />
      <Line parts={fit([[` saved to ${CONFIG_PATH.replace(homedir(), "~")}`, t.dim]], inner)} />
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
    if (!["up", "down", "left", "right", "ctrl+l", "ctrl+h"].includes(b.key) && !g.some((x) => x.desc === b.desc)) g.push(b)
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
    <Modal title="keys" width={w} height={Math.min(height - 2, rows + (logo ? 7 : 4))}>
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
      <Line parts={fit([["mouse: click rows, tabs, crumbs · drag the track, actions or borders · esc closes", t.dim]], w - 4)} />
    </Modal>
  )
}
