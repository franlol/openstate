import { ScrollBarRenderable, type TextareaRenderable } from "@opentui/core"
import { extend } from "@opentui/react"
import { useEffect, useRef, useState } from "react"
import { BOLD, fit, Footer, Line, scrollbar, spread, useApp, type Part } from "./kit"

const PAYLOAD_ROWS = 7

// The textarea scrolls but draws no scrollbar, and OpenTUI's own has no React element: register it as one.
declare module "@opentui/react" {
  interface OpenTUIComponents {
    scrollBar: typeof ScrollBarRenderable
  }
}
extend({ scrollBar: ScrollBarRenderable })

// Insert-mode card for writing an action: a type with completion from the store's history,
// then a JSON payload prefilled from the last action of that type.
export function DispatchCard({ width }: { width: number }) {
  const s = useApp()
  const t = s.theme
  const d = s.draft
  const area = useRef<TextareaRenderable>(null)
  // The textarea scrolls by itself; this redraws the scrollbar beside it when it does.
  const [, setScroll] = useState(0)
  const onScroll = () => setScroll(area.current?.scrollY ?? 0)
  const bar = useRef<ScrollBarRenderable>(null)
  // Sizes are not options of the scrollbar, so they are set on it after each render. Lines do not wrap here, so
  // the buffer's lines are the rows to scroll through.
  useEffect(() => {
    const b = bar.current
    const ta = area.current
    if (!b || !ta) return
    b.scrollSize = ta.lineCount
    b.viewportSize = PAYLOAD_ROWS
    b.scrollPosition = ta.scrollY
    b.visible = ta.lineCount > PAYLOAD_ROWS
  })
  // The payload is prefilled from state when a type is accepted; push it into the editor.
  useEffect(() => {
    if (d && area.current && area.current.plainText !== d.payload) {
      area.current.setText(d.payload)
      area.current.gotoBufferEnd()
    }
  }, [d?.payload, d?.field])
  if (!d) return null

  const st = s.store(d.storeKey)
  const src = s.sourceOf(d.storeKey)
  const w = Math.min(76, width - 4)
  const inner = w - 4
  const matches = s.typeMatches()
  const pick = Math.min(d.pick, matches.length - 1)

  // Live JSON check, shown in the card's last row instead of an error after submit.
  let status: [string, string]
  if (d.error) status = ["✗ not dispatched", t.remove]
  else if (!d.payload.trim()) status = ["no payload", t.dim]
  else {
    try {
      JSON.parse(d.payload)
      status = ["✓ valid JSON", t.add]
    } catch {
      status = ["✗ invalid JSON", t.remove]
    }
  }

  const label = (text: string, on: boolean): Part => [text.padEnd(9), on ? t.accent : t.muted, on ? BOLD : undefined]

  return (
    // Centred like the other cards.
    <box position="absolute" top={0} left={0} width="100%" height="100%" alignItems="center" justifyContent="center" zIndex={30}>
      <box
        width={w}
        border
        borderStyle="rounded"
        borderColor={t.add}
        title={` ⇡ dispatch → ${src?.name ?? "?"} / ${st?.name ?? "?"} `}
        titleColor={t.add}
        backgroundColor={t.panel}
        paddingLeft={1}
        paddingRight={1}
        flexDirection="column"
      >
        <box flexDirection="row" height={1}>
          <text>
            <span fg={d.field === "type" ? t.accent : t.muted} attributes={d.field === "type" ? BOLD : undefined}>
              {"type".padEnd(9)}
            </span>
          </text>
          <input
            focused={d.field === "type"}
            flexGrow={1}
            value={d.type}
            placeholder="action type, e.g. cart/add"
            backgroundColor={t.panel}
            focusedBackgroundColor={t.selBg}
            textColor={t.fg}
            cursorColor={t.add}
            placeholderColor={t.dim}
            onInput={(v) => {
              d.type = v
              d.pick = 0
              d.error = undefined
              s.emit()
            }}
            onMouseDown={() => ((d.field = "type"), s.emit())}
          />
        </box>
        {/* The full error once dispatch is refused. */}
        <Line parts={fit([[" ".repeat(9), t.dim], [d.error ?? "", t.remove]], inner, t.dim)} bg={t.panel} />
        <Line parts={fit([label("payload", d.field === "payload")], inner)} bg={t.panel} />
        <box flexDirection="row" height={PAYLOAD_ROWS}>
          <textarea
            flexGrow={1}
            ref={area}
            focused={d.field === "payload"}
            height={PAYLOAD_ROWS}
            initialValue={d.payload}
            placeholder={'{ "id": 42, "qty": 1 }'}
            backgroundColor={t.panel}
            focusedBackgroundColor={t.selBg}
            textColor={t.fg}
            focusedTextColor={t.fg}
            cursorColor={t.add}
            placeholderColor={t.dim}
            wrapMode="none"
            onContentChange={() => {
              d.payload = area.current?.plainText ?? ""
              d.error = undefined
              s.emit()
            }}
            onCursorChange={onScroll}
            onMouseScroll={onScroll}
            onMouseDown={() => ((d.field = "payload"), s.emit())}
          />
          <scrollBar
          orientation="vertical"
          ref={bar}
          width={1}
          height={PAYLOAD_ROWS}
          // The thumb's size; re-applied with the colours on every render, so it goes here too.
          trackOptions={{ ...scrollbar(t).trackOptions, viewPortSize: PAYLOAD_ROWS }}
          // Dragging it moves the cursor to the first or last row in view, which scrolls the textarea there.
          onChange={(pos: number) => {
            const ta = area.current
            if (!ta || Math.round(pos) === ta.scrollY) return
            ta.gotoLine(pos < ta.scrollY ? Math.round(pos) : Math.round(pos) + PAYLOAD_ROWS - 1)
            onScroll()
          }}
        />
        </box>
        <Footer
          note={[[status[0], status[1]]]}
          width={inner}
          bg={t.panel}
          hints={[
            { key: "tab", desc: "field" },
            { key: "^S", desc: "dispatch", run: () => s.submitDispatch() },
            { key: "esc", desc: "cancel", run: () => s.closeDispatch() },
          ]}
        />
        {d.field === "type" && <TypeList matches={matches} pick={pick} width={inner - 9} />}
      </box>
    </box>
  )
}

const LIST_ROWS = 6

// Combobox dropdown under the type field; it covers the payload while a type is being chosen.
function TypeList(props: { matches: { type: string; uses: number }[]; pick: number; width: number }) {
  const s = useApp()
  const t = s.theme
  const { matches, pick } = props
  const d = s.draft!
  // Only an exact single match left means the type is chosen; nothing to suggest.
  if (!matches.length || (matches.length === 1 && matches[0]!.type === d.type)) return null
  // Scroll so the highlighted row stays visible.
  const start = Math.max(0, Math.min(pick - Math.floor(LIST_ROWS / 2), matches.length - LIST_ROWS))
  const rows = matches.slice(start, start + LIST_ROWS)
  const w = Math.min(props.width, Math.max(...matches.map((m) => m.type.length)) + 12)
  return (
    <box
      position="absolute"
      top={1}
      left={10}
      width={w}
      zIndex={35}
      border
      borderStyle="rounded"
      borderColor={t.border}
      bottomTitle={` ${pick + 1}/${matches.length} `}
      bottomTitleAlignment="right"
      backgroundColor={t.panel}
      flexDirection="column"
    >
      {rows.map((m, k) => {
        const on = start + k === pick
        return (
          <Line
            key={m.type}
            parts={spread(
              [
                [on ? "▌" : " ", t.add],
                [m.type, on ? t.fg : t.muted, on ? BOLD : undefined],
              ],
              [[`×${m.uses} `, t.dim]],
              w - 2,
            )}
            bg={on ? t.selBg : t.panel}
            onMouseDown={() => {
              d.pick = start + k
              s.acceptType()
              s.emit()
            }}
          />
        )
      })}
    </box>
  )
}
