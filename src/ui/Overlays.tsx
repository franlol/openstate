import { useEffect, useState } from "react"
import { themes } from "../theme"
import { BOLD, fit, Line, useApp, type Part } from "./kit"
import { globalBinds, keyLabel, panelBinds, type Bind } from "./keys"

const SPIN = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"

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
      <ascii-font text="openstate" font="block" color={[t.accent, t.sources[1]!]} backgroundColor={t.bg} />
      <box height={1} />
      <text>
        <span fg={t.accent}>{SPIN[frame % SPIN.length]} </span>
        <span fg={t.muted}>waiting for apps on </span>
        <span fg={t.fg}>ws://localhost:8000</span>
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
          s.setTheme(themes[i]!.id)
          s.picker = null
          s.notify(`theme · ${themes[i]!.name}`)
          s.emit()
        }}
      />
      <text>
        <span fg={t.dim}>j/k preview · enter keep · esc cancel</span>
      </text>
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
      {logo && <ascii-font text="openstate" font="tiny" color={[t.accent, t.sources[1]!]} backgroundColor={t.panel} />}
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
