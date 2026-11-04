import type { TextareaRenderable } from "@opentui/core"
import { useEffect, useRef } from "react"
import { BOLD, fit, Line, spread, useApp, type Part } from "./kit"

const PAYLOAD_ROWS = 7

// Insert-mode card for writing an action: a type with completion from the store's history,
// then a JSON payload prefilled from the last action of that type.
export function DispatchCard({ width }: { width: number }) {
  const s = useApp()
  const t = s.theme
  const d = s.draft
  const area = useRef<TextareaRenderable>(null)
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

  // Live JSON check, shown in the bottom border instead of an error after submit.
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
    <box
      position="absolute"
      bottom={2}
      left={Math.floor((width - w) / 2)}
      width={w}
      zIndex={30}
      border
      borderStyle="rounded"
      borderColor={t.add}
      title={` ⇡ dispatch → ${src?.name ?? "?"} / ${st?.name ?? "?"} `}
      titleColor={t.add}
      bottomTitle={` ${status[0]} · tab field · ^S dispatch · esc cancel `}
      bottomTitleAlignment="right"
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
      <textarea
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
        onMouseDown={() => ((d.field = "payload"), s.emit())}
      />
      {d.field === "type" && <TypeList matches={matches} pick={pick} width={inner - 9} />}
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
