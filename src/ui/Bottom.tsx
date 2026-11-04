import type { MouseEvent } from "@opentui/core"
import { stringifyKeySequence } from "@opentui/keymap"
import { useActiveKeys, usePendingSequence } from "@opentui/keymap/react"
import type { AppState } from "../state"
import { mix } from "../theme"
import { BOLD, fit, Line, spread, useApp, type Part } from "./kit"
import { keyLabel } from "./keys"

type Seg = { text: string; fg: string; bg: string; bold?: boolean; click?: () => void }

function modeOf(s: AppState): { name: string; color: string } {
  const t = s.theme
  if (s.help) return { name: "HELP", color: t.sources[1]! }
  if (s.picker) return { name: "THEME", color: t.sources[1]! }
  if (s.mode === "command") return { name: "COMMAND", color: t.warn }
  if (s.mode === "filter") return { name: "FILTER", color: t.add }
  if (s.mode === "insert") return { name: "INSERT", color: t.add }
  return { name: "NORMAL", color: t.accent }
}

// Vim's ruler: Top, Bot, All or how far through the history the cursor is.
function ruler(s: AppState): string {
  const n = s.timeline().length
  const i = s.selectedIndex()
  if (n <= 1) return "All"
  if (s.view().cursor === null) return "Bot"
  if (i <= 0) return "Top"
  return `${Math.round((i / (n - 1)) * 100)}%`
}

// Lualine-style statusline: mode, app state and position, as clickable coloured segments.
export function StatusLine({ width }: { width: number }) {
  const s = useApp()
  const t = s.theme
  const mode = modeOf(s)
  const b = mix(t.bg, t.fg, 0.12)
  const c = mix(t.bg, t.fg, 0.05)
  const sel = s.selected()
  const live = s.view().cursor === null
  const tl = s.timeline()
  const emit = (fn: () => void) => () => (fn(), s.emit())

  const left: Seg[] = [
    { text: ` ${mode.name} `, fg: t.bg, bg: mode.color, bold: true },
    live
      ? { text: " ◉ LIVE ", fg: t.add, bg: b, bold: true }
      : { text: " ◷ TRAVEL ", fg: t.warn, bg: b, bold: true, click: emit(() => s.goLive()) },
    s.paused
      ? { text: " ❚❚ paused ", fg: t.warn, bg: c, click: emit(() => s.togglePause()) }
      : { text: " ● rec ", fg: t.remove, bg: c, click: emit(() => s.togglePause()) },
  ]
  const target = s.target()
  if (target?.locked)
    left.push({ text: " ◆ LOCKED ", fg: t.bg, bg: t.remove, bold: true, click: emit(() => s.toggleLock()) })
  if (s.playing)
    left.push({ text: ` ▶ ${s.speed}× `, fg: t.bg, bg: t.accent, bold: true, click: emit(() => s.togglePlay()) })
  if (s.merge) left.push({ text: " ⧉ all apps ", fg: t.fg, bg: c, click: emit(() => s.toggleMerge()) })
  if (s.filter) left.push({ text: ` /${s.filter} `, fg: t.add, bg: c, click: emit(() => (s.filter = "")) })

  const right: Seg[] = [
    { text: " mock data ", fg: t.dim, bg: c },
    { text: ` ${sel?.type ?? "—"} `, fg: t.muted, bg: b },
    { text: ` ${tl.length ? s.selectedIndex() + 1 : 0}/${tl.length}  ${ruler(s)} `, fg: t.bg, bg: mode.color, bold: true },
  ]

  // Drop the least important segments until everything fits.
  const len = (xs: Seg[]) => xs.reduce((n, x) => n + x.text.length, 0)
  while (len(left) + len(right) > width && right.length > 1) right.shift()
  while (len(left) + len(right) > width && left.length > 1) left.pop()

  const fill: Seg = { text: " ".repeat(Math.max(0, width - len(left) - len(right))), fg: c, bg: c }
  const segs = [...left, fill, ...right]
  const onDown = (e: MouseEvent) => {
    let x = 0
    for (const seg of segs) {
      if (e.x < x + seg.text.length) return seg.click?.()
      x += seg.text.length
    }
  }
  return <Line parts={segs.map((x): Part => [x.text, x.fg, x.bold ? BOLD : undefined, x.bg])} bg={c} onMouseDown={onDown} />
}

// Vim's command line: messages, the `:` and `/` prompts, and pending keys (showcmd) on the right.
export function CmdLine({ width }: { width: number }) {
  const s = useApp()
  const t = s.theme
  const pending = usePendingSequence()
  if (s.mode === "command" || s.mode === "filter") return <Prompt width={width} />
  if (s.mode === "insert") return <Line parts={fit([["-- INSERT --", t.fg, BOLD]], width)} bg={t.bg} />

  if (s.confirm)
    return <Line parts={fit([[`${s.confirm.text} `, t.warn, BOLD], ["[y/N]", t.fg]], width)} bg={t.bg} />
  const msg = s.message && s.message.until > Date.now() ? s.message : null
  const left: Part[] = msg ? [[msg.text, msg.error ? t.remove : t.fg, msg.error ? BOLD : undefined]] : []
  const showcmd: Part[] = pending.length ? [[`${keyLabel(stringifyKeySequence(pending, { preferDisplay: true }))} `, t.fg, BOLD]] : []
  return <Line parts={spread(left, showcmd, width)} bg={t.bg} />
}

function Prompt({ width }: { width: number }) {
  const s = useApp()
  const t = s.theme
  const isCmd = s.mode === "command"
  const matches = isCmd ? s.commandMatches(s.input) : []
  const pick = matches.length ? matches[s.cmdIndex % matches.length] : undefined
  return (
    <box height={1} flexShrink={0} flexDirection="row" backgroundColor={t.bg}>
      <text>
        <span fg={t.fg} attributes={BOLD}>
          {isCmd ? ":" : "/"}
        </span>
      </text>
      <input
        focused
        flexGrow={1}
        value={s.input}
        placeholder={isCmd ? "" : "filter actions by type"}
        backgroundColor={t.bg}
        focusedBackgroundColor={t.bg}
        textColor={t.fg}
        cursorColor={t.accent}
        placeholderColor={t.dim}
        onInput={(v) => {
          s.input = v
          s.cmdIndex = 0
          if (!isCmd) s.filter = v
          s.emit()
        }}
        onSubmit={() => {
          const v = s.input
          s.mode = "normal"
          if (isCmd) {
            // Complete to the highlighted suggestion when the typed name is partial.
            const [name = "", ...args] = v.trim().split(/\s+/)
            const full = name && pick && pick.name !== name ? [pick.name, ...args].join(" ") : v
            if (full.trim()) s.runCommand(full)
          }
          s.emit()
        }}
      />
      {pick && (
        <text>
          <span fg={t.dim}>{fit([[`${pick.desc} `, t.dim]], Math.min(48, Math.floor(width / 2)))[0]![0]}</span>
        </text>
      )}
    </box>
  )
}

// Wildmenu-style completion list above the command line.
export function Suggestions({ width }: { width: number }) {
  const s = useApp()
  const t = s.theme
  if (s.mode !== "command") return null
  const matches = s.commandMatches(s.input)
  if (!matches.length) return null
  const sel = s.cmdIndex % matches.length
  const w = Math.min(52, width - 2)
  return (
    <box
      position="absolute"
      bottom={2}
      left={0}
      width={w}
      border
      borderStyle="rounded"
      borderColor={t.borderActive}
      backgroundColor={t.panel}
      flexDirection="column"
      zIndex={20}
    >
      {matches.map((c, i) => (
        <Line
          key={c.name}
          bg={i === sel ? t.selBg : t.panel}
          parts={fit(
            [
              [i === sel ? "▌" : " ", t.accent],
              [c.name.padEnd(8), i === sel ? t.fg : t.sources[1]!, BOLD],
              [c.desc, t.muted],
            ],
            w - 2,
          )}
          onMouseDown={() => {
            s.mode = "normal"
            s.runCommand(c.name)
            s.emit()
          }}
        />
      ))}
    </box>
  )
}

// which-key: while a key sequence is pending, list what can complete it.
export function WhichKey() {
  const s = useApp()
  const t = s.theme
  const pending = usePendingSequence()
  const active = useActiveKeys({ includeMetadata: true })
  if (!pending.length || s.mode !== "normal") return null
  const rows = active
    .filter((k) => k.bindingAttrs?.desc)
    .map((k) => ({ key: keyLabel(k.display), desc: String(k.bindingAttrs!.desc) }))
  if (!rows.length) return null
  const keyW = Math.max(...rows.map((r) => r.key.length))
  const w = Math.max(...rows.map((r) => keyW + r.desc.length + 2)) + 4
  return (
    <box
      position="absolute"
      bottom={2}
      right={1}
      width={w}
      border
      borderStyle="rounded"
      borderColor={t.borderActive}
      title={` ${keyLabel(stringifyKeySequence(pending, { preferDisplay: true }))} `}
      titleColor={t.accent}
      backgroundColor={t.panel}
      paddingLeft={1}
      flexDirection="column"
      zIndex={25}
    >
      {rows.map((r) => (
        <Line key={r.key} parts={fit([[r.key.padEnd(keyW + 2), t.accent, BOLD], [r.desc, t.muted]], w - 3)} bg={t.panel} />
      ))}
    </box>
  )
}
