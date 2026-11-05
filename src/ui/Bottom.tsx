import type { MouseEvent } from "@opentui/core"
import { stringifyKeySequence } from "@opentui/keymap"
import { useActiveKeys, useKeymap, usePendingSequence } from "@opentui/keymap/react"
import { useState } from "react"
import { CLIENT_VERSION } from "../../client/version"
import { CLIENT_UPDATE, clientStatus } from "../model"
import { format, OPTIONS } from "../settings"
import type { AppState } from "../state"
import { mix } from "../theme"
import { BOLD, fit, Line, spread, useApp, type Part } from "./kit"
import { keyLabel } from "./keys"

type Seg = { text: string; fg: string; bg: string; bold?: boolean; click?: () => void }

function modeOf(s: AppState): { name: string; color: string } {
  const t = s.theme
  if (s.help) return { name: "HELP", color: t.sources[1]! }
  if (s.picker) return { name: "THEME", color: t.sources[1]! }
  if (s.settingsCard) return { name: "SET", color: t.sources[1]! }
  if (s.update?.card) return { name: "UPDATE", color: t.sources[1]! }
  if (s.mode === "command") return { name: "COMMAND", color: t.warn }
  if (s.mode === "filter") return { name: "FILTER", color: t.add }
  if (s.mode === "insert") return { name: "INSERT", color: t.add }
  if (s.mode === "visual") return { name: "VISUAL", color: t.sources[2]! }
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

  const u = s.update
  const right: Seg[] = [
    ...(u
      ? [
          u.phase === "running"
            ? { text: ` ↑ ${Math.round(u.progress.value * 100)}% `, fg: t.accent, bg: c, bold: true, click: emit(() => (u.card = true)) }
            : u.phase === "done"
              ? { text: ` ↑ ${u.latest} installed · :update `, fg: t.add, bg: c, bold: true, click: emit(() => (u.card = true)) }
              : { text: ` ↑ ${u.latest} · :update `, fg: t.accent, bg: c, bold: true, click: emit(() => (u.card = true)) },
        ]
      : []),
    s.demo
      ? { text: " demo data ", fg: t.dim, bg: c }
      : s.listenError
        ? { text: ` ✗ :${s.settings.port} `, fg: t.remove, bg: c, bold: true }
        : { text: ` ⇄ ws://localhost:${s.settings.port} `, fg: s.settings.port === 8000 ? t.muted : t.warn, bg: c },
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
  if (s.mode === "visual") {
    const n = s.visualRange().length
    return (
      <Line
        parts={fit([["-- VISUAL -- ", t.fg, BOLD], [`${n} action${n > 1 ? "s" : ""} · s skip · x hide · y yank · esc`, t.muted]], width)}
        bg={t.bg}
      />
    )
  }

  if (s.confirm)
    return <Line parts={fit([[`${s.confirm.text} `, t.warn, BOLD], ["[y/N]", t.fg]], width)} bg={t.bg} />
  const msg = s.message && s.message.until > Date.now() ? s.message : null
  const home = s.selected() && s.home(s.selected()!)
  const src = s.merge ? undefined : s.sourceOf(s.activeKey)
  const status = src ? clientStatus(src) : "ok"
  const left: Part[] = msg
    ? [[msg.text, msg.error ? t.remove : t.fg, msg.error ? BOLD : undefined]]
    : home
      ? [
          ["⇅ ", t.warn, BOLD],
          [`moved ${Math.abs(home.by)} ${home.by < 0 ? "↑" : "↓"} · `, t.muted],
          ["U", t.fg, BOLD],
          [" restores", t.muted],
        ]
      : status !== "ok"
        ? [
            [status === "outdated" ? "↑ " : "! ", status === "outdated" ? t.warn : t.remove, BOLD],
            [`${src!.name}: client ${src!.client!.version ?? "0.1.3 or older"}, ${CLIENT_VERSION} is out · `, t.muted],
            [CLIENT_UPDATE, t.fg],
            [" · ", t.muted],
            ["yc", t.fg, BOLD],
            [" copies it", t.muted],
          ]
        : []
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
  // After "set ", list the options with their values instead of commands.
  const arg = /^set\s+(?:.*\s)?(?:no|inv)?([a-z]*)$/.exec(s.input)
  if (arg) return <SetSuggestions width={width} prefix={arg[1]!} />
  const matches = s.commandMatches(s.input)
  if (!matches.length) return null
  const sel = s.cmdIndex % matches.length
  // Names as wide as the longest, so a description never runs into its name.
  const nameW = Math.max(...matches.map((c) => c.name.length)) + 2
  const w = Math.min(nameW + 1 + Math.max(...matches.map((c) => c.desc.length)) + 3, width - 2)
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
              [c.name.padEnd(nameW), i === sel ? t.fg : t.sources[1]!, BOLD],
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

function SetSuggestions({ width, prefix }: { width: number; prefix: string }) {
  const s = useApp()
  const t = s.theme
  const opts = OPTIONS.filter((o) => o.name.startsWith(prefix))
  if (!opts.length) return null
  const w = Math.min(90, width - 2)
  // Columns as wide as their longest entry across all options, so they stay put while the prefix narrows the list.
  const setW = Math.max(...OPTIONS.map((o) => format(o.name, s.settings).length)) + 2
  const descW = Math.max(...OPTIONS.map((o) => o.desc.length)) + 2
  return (
    <box
      position="absolute"
      bottom={2}
      left={0}
      width={w}
      border
      borderStyle="rounded"
      borderColor={t.borderActive}
      bottomTitle=" noflash · flash! toggle · flash? show · flash& default "
      bottomTitleAlignment="right"
      backgroundColor={t.panel}
      flexDirection="column"
      zIndex={20}
    >
      {opts.map((o) => (
        <Line
          key={o.name}
          bg={t.panel}
          parts={fit(
            [
              [" ", t.dim],
              [format(o.name, s.settings).padEnd(setW), t.sources[1]!, BOLD],
              [o.desc.padEnd(descW), t.muted],
              [o.kind === "bool" ? "on/off" : o.kind === "number" ? `${o.min}–${o.max}` : o.values!().join(" | "), t.dim],
            ],
            w - 2,
          )}
          onMouseDown={() => {
            // Fill the line so only the value is left to type.
            s.input = `set ${o.name}${o.kind === "bool" ? "!" : "="}`
            s.emit()
          }}
        />
      ))}
    </box>
  )
}

// which-key: while a key sequence is pending, list what can complete it; a click finishes it.
export function WhichKey() {
  const s = useApp()
  const t = s.theme
  const keymap = useKeymap()
  const pending = usePendingSequence()
  const active = useActiveKeys({ includeMetadata: true })
  const [hover, setHover] = useState<string | null>(null)
  if (!pending.length || s.mode !== "normal") return null
  const rows = active
    .filter((k) => k.bindingAttrs?.desc)
    .map((k) => ({ key: keyLabel(k.display), desc: String(k.bindingAttrs!.desc), command: k.command }))
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
        <Line
          key={r.key}
          parts={fit([[r.key.padEnd(keyW + 2), t.accent, BOLD], [r.desc, hover === r.key ? t.fg : t.muted]], w - 3)}
          bg={hover === r.key ? t.selBg : t.panel}
          onMouseDown={() => {
            setHover(null)
            keymap.clearPendingSequence()
            // Our bindings' commands are plain functions that ignore their context.
            if (typeof r.command === "function") (r.command as () => void)()
          }}
          onMouseMove={() => setHover(r.key)}
          onMouseOut={() => setHover(null)}
        />
      ))}
    </box>
  )
}
