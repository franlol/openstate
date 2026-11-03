import { stringifyKeySequence } from "@opentui/keymap"
import { useActiveKeys, usePendingSequence } from "@opentui/keymap/react"
import { BOLD, fit, Line, spread, useApp, type Part } from "./kit"

const HINT_ORDER = ["j", "return", "l", "h", "[", "]", "s", "/", ":", "t", "m", "?"]

export function StatusBar({ width }: { width: number }) {
  const s = useApp()
  const t = s.theme
  const active = useActiveKeys({ includeMetadata: true })
  const pending = usePendingSequence()

  if (s.mode !== "normal") return <Prompt width={width} />

  const label = s.help ? " HELP " : s.picker ? " THEME " : " NORMAL "
  let right: Part[]
  if (pending.length) {
    // Show the sequence in progress and what can complete it.
    const next = active.map((k) => `${k.display} ${String(k.bindingAttrs?.desc ?? "")}`).join("  ")
    right = [[` ${stringifyKeySequence(pending, { preferDisplay: true })}… `, t.warn, BOLD], [next + " ", t.muted]]
  } else if (s.message && s.message.until > Date.now()) {
    right = [[` ${s.message.text} `, t.fg]]
  } else {
    // Hints come from the keymap, so they follow the focused panel automatically.
    const hints = active
      .filter((k) => k.bindingAttrs?.desc && HINT_ORDER.includes(k.display))
      .sort((a, b) => HINT_ORDER.indexOf(a.display) - HINT_ORDER.indexOf(b.display))
    right = hints.flatMap((k): Part[] => [
      [` ${k.display}`, t.fg, BOLD],
      [` ${String(k.bindingAttrs!.desc)} `, t.muted],
    ])
  }
  const parts = spread([[" ", t.bg]], right, width - label.length)
  return (
    <box height={1} flexShrink={0} flexDirection="row" backgroundColor={t.bg}>
      <box backgroundColor={t.accent} flexShrink={0}>
        <text>
          <span fg={t.bg} attributes={BOLD}>
            {label}
          </span>
        </text>
      </box>
      <box flexGrow={1}>
        <text>
          {parts.map(([txt, fg, a], i) => (
            <span key={i} fg={fg} attributes={a}>
              {txt}
            </span>
          ))}
        </text>
      </box>
    </box>
  )
}

function Prompt({ width }: { width: number }) {
  const s = useApp()
  const t = s.theme
  const isCmd = s.mode === "command"
  const matches = isCmd ? s.commandMatches(s.input) : []
  const pick = matches.length ? matches[s.cmdIndex % matches.length] : undefined
  return (
    <box height={1} flexShrink={0} flexDirection="row" backgroundColor={t.selBg}>
      <box backgroundColor={isCmd ? t.warn : t.add} flexShrink={0}>
        <text>
          <span fg={t.bg} attributes={BOLD}>
            {isCmd ? " COMMAND " : " FILTER "}
          </span>
        </text>
      </box>
      <text>
        <span fg={t.accent} attributes={BOLD}>
          {isCmd ? " :" : " /"}
        </span>
      </text>
      <input
        focused
        flexGrow={1}
        value={s.input}
        placeholder={isCmd ? "theme, merge, pause, skip, live, clear, help, quit" : "filter actions by type"}
        backgroundColor={t.selBg}
        focusedBackgroundColor={t.selBg}
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
            const full = pick && pick.name !== name ? [pick.name, ...args].join(" ") : v
            if (full.trim()) s.runCommand(full)
          }
          s.emit()
        }}
      />
      {pick && (
        <text>
          <span fg={t.muted}>{fit([[`${pick.name} — ${pick.desc} `, t.muted]], Math.min(48, width / 2))[0]![0]}</span>
        </text>
      )}
    </box>
  )
}

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
      bottom={1}
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
