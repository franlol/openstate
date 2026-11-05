import { RGBA, SyntaxStyle, TextAttributes, type MouseEvent } from "@opentui/core"
import { useRenderer } from "@opentui/react"
import { createContext, useContext, useState, useSyncExternalStore } from "react"
import type { AppState } from "../state"
import type { Theme } from "../theme"

export const AppContext = createContext<AppState | null>(null)

// Subscribes the caller to every state change and returns the live state object.
export function useApp(): AppState {
  const s = useContext(AppContext)
  if (!s) throw new Error("AppContext missing")
  useSyncExternalStore(s.subscribe, s.snapshot)
  return s
}

export type Part = [text: string, fg: string, attrs?: number, bg?: string]
export const BOLD = TextAttributes.BOLD
export const DIM = TextAttributes.DIM
export const STRIKE = TextAttributes.STRIKETHROUGH

// Truncate parts to `width` cells and pad the remainder, so rows paint edge to edge.
export function fit(parts: Part[], width: number, padFg = "#000000"): Part[] {
  const out: Part[] = []
  let left = Math.max(0, width)
  for (const [t, fg, a, bg] of parts) {
    if (left <= 0) break
    const s = t.length > left ? t.slice(0, Math.max(0, left - 1)) + "…" : t
    out.push([s, fg, a, bg])
    left -= s.length
  }
  if (left > 0) out.push([" ".repeat(left), padFg])
  return out
}

// Right-align `right` against `left` within `width`.
export function spread(left: Part[], right: Part[], width: number): Part[] {
  const rw = right.reduce((n, [t]) => n + t.length, 0)
  const l = fit(left, Math.max(0, width - rw))
  return [...l, ...right]
}

export function Line(props: {
  id?: string
  parts: Part[]
  bg?: string
  onMouseDown?: (e: MouseEvent) => void
  onMouseDrag?: (e: MouseEvent) => void
  onMouseUp?: (e: MouseEvent) => void
  onMouseMove?: (e: MouseEvent) => void
  onMouseOut?: (e: MouseEvent) => void
  onMouseScroll?: (e: MouseEvent) => void
}) {
  return (
    <box
      id={props.id}
      height={1}
      flexShrink={0}
      backgroundColor={props.bg}
      onMouseDown={props.onMouseDown}
      onMouseDrag={props.onMouseDrag}
      onMouseUp={props.onMouseUp}
      onMouseDragEnd={props.onMouseUp}
      onMouseMove={props.onMouseMove}
      onMouseOut={props.onMouseOut}
      onMouseScroll={props.onMouseScroll}
    >
      <text selectable={false}>
        {props.parts.map(([t, fg, a, bg], i) => (
          <span key={i} fg={fg} bg={bg} attributes={a}>
            {t}
          </span>
        ))}
      </text>
    </box>
  )
}

// Scrollbars show themselves only when content overflows; rows leave one column for them.
export function scrollbar(t: Theme) {
  return { trackOptions: { foregroundColor: t.dim, backgroundColor: t.panel } }
}

const styleCache = new Map<string, SyntaxStyle>()

// One native syntax style per theme, created lazily and reused across renders.
export function useSyntax(theme: Theme): SyntaxStyle {
  const renderer = useRenderer()
  let s = styleCache.get(theme.id)
  if (!s) {
    const c = (hex: string) => RGBA.fromHex(hex)
    s = SyntaxStyle.fromStyles(
      {
        default: { fg: c(theme.fg) },
        string: { fg: c(theme.add) },
        number: { fg: c(theme.warn) },
        boolean: { fg: c(theme.warn) },
        constant: { fg: c(theme.warn) },
        keyword: { fg: c(theme.accent), bold: true },
        property: { fg: c(theme.sources[1]!) },
        "variable.member": { fg: c(theme.sources[1]!) },
        variable: { fg: c(theme.fg) },
        "punctuation.bracket": { fg: c(theme.muted) },
        "punctuation.delimiter": { fg: c(theme.muted) },
        comment: { fg: c(theme.muted), italic: true },
      },
      renderer.nativeScene,
    )
    styleCache.set(theme.id, s)
  }
  return s
}

// A key on screen that a click runs too, as pressing it would: `enter update · esc later`. Without `run` it is only
// a reminder, as for keys that make no sense as a click.
export type Hint = { key: string; desc: string; run?: () => void; fg?: string }
const HINT_SEP = " · "
export const hintsWidth = (hs: Hint[], sep = HINT_SEP) =>
  hs.reduce((n, h, i) => n + (i ? sep.length : 0) + h.key.length + 1 + h.desc.length, 0)

export function Hints({ hints, bg, sep = HINT_SEP }: { hints: Hint[]; bg?: string; sep?: string }) {
  const s = useApp()
  const t = s.theme
  const [hover, setHover] = useState<number | null>(null)
  // Which hint is at column x of the line.
  const at = (e: MouseEvent) => {
    let x = e.x - e.currentTarget!.x
    for (const [i, h] of hints.entries()) {
      const w = h.key.length + 1 + h.desc.length
      if (x < w) return x >= 0 && h.run ? i : null
      x -= w + sep.length
    }
    return null
  }
  const parts = hints.flatMap((h, i): Part[] => [
    ...(i ? [[sep, t.dim] as Part] : []),
    [h.key, hover === i ? t.accent : (h.fg ?? t.fg), BOLD],
    [` ${h.desc}`, hover === i ? t.fg : t.muted],
  ])
  return (
    <Line
      parts={parts}
      bg={bg}
      onMouseDown={(e) => {
        const i = at(e)
        if (i !== null) hints[i]!.run?.(), s.emit()
      }}
      onMouseMove={(e) => setHover(at(e))}
      onMouseOut={() => setHover(null)}
    />
  )
}

// A card's last row: what is going on at the left (a note, or something of its own such as a link), its keys at the right.
export function Footer(props: { note?: Part[]; left?: React.ReactNode; hints: Hint[]; width: number; bg?: string }) {
  const { note = [], hints, width, bg } = props
  return (
    <box flexDirection="row" height={1} flexShrink={0}>
      <box flexGrow={1} overflow="hidden">
        {props.left ?? <Line parts={fit(note, width - hintsWidth(hints) - 2)} bg={bg} />}
      </box>
      <Hints hints={hints} bg={bg} />
    </box>
  )
}
