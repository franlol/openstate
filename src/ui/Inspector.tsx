import type { ScrollBoxRenderable, TabSelectRenderable } from "@opentui/core"
import { createTwoFilesPatch } from "diff"
import { useEffect, useRef } from "react"
import { preview, type TreeRow } from "../model"
import { TABS } from "../state"
import { mix } from "../theme"
import { BOLD, fit, Line, scrollbar, spread, useApp, useSyntax, type Part } from "./kit"
import { Panel } from "./Panels"

export function Inspector({ width }: { width: number }) {
  const s = useApp()
  const t = s.theme
  const a = s.selected()
  const tabsRef = useRef<TabSelectRenderable>(null)
  const tabW = Math.max(7, Math.min(10, Math.floor((width - 2) / TABS.length)))
  const tabIndex = TABS.indexOf(s.tab)
  useEffect(() => {
    if (tabsRef.current && tabsRef.current.getSelectedIndex() !== tabIndex) tabsRef.current.setSelectedIndex(tabIndex)
  }, [tabIndex])

  const title = a ? `${a.type} #${a.seq}` : "inspector"
  return (
    <Panel id="inspector" title={title} grow>
      <box
        height={1}
        flexShrink={0}
        onMouseDown={(e) => {
          const i = Math.floor((e.x - e.currentTarget!.x) / tabW)
          if (TABS[i]) (s.tab = TABS[i]!), s.emit()
        }}
      >
        <tab-select
          ref={tabsRef}
          height={1}
          tabWidth={tabW}
          options={TABS.map((name, i) => ({ name: tabW >= 9 ? `${i + 1} ${name}` : name, description: "", value: name }))}
          showDescription={false}
          showUnderline={false}
          showScrollArrows={false}
          backgroundColor={t.panel}
          textColor={t.muted}
          selectedBackgroundColor={t.selBg}
          selectedTextColor={t.accent}
          focusedBackgroundColor={t.panel}
          focusedTextColor={t.muted}
          onChange={(i) => {
            if (TABS[i] && TABS[i] !== s.tab) (s.tab = TABS[i]!), s.emit()
          }}
        />
      </box>
      {!a ? (
        <Line parts={fit([["  waiting for actions…", t.muted]], width - 2)} />
      ) : s.tab === "state" ? (
        <StateTree width={width - 3} />
      ) : s.tab === "action" ? (
        <CodeView content={JSON.stringify({ type: a.type, payload: a.payload ?? null }, null, 2)} />
      ) : s.tab === "diff" ? (
        <DiffView />
      ) : (
        <TraceView width={width - 2} />
      )}
    </Panel>
  )
}

function StateTree({ width }: { width: number }) {
  const s = useApp()
  const t = s.theme
  const rows = s.treeRows()
  const v = s.view()
  if (v.treeCursor >= rows.length) v.treeCursor = Math.max(0, rows.length - 1)
  const changes = s.changes()
  const focused = s.focus === "inspector"
  const ref = useRef<ScrollBoxRenderable>(null)
  useEffect(() => {
    ref.current?.scrollChildIntoView(`tree-${v.treeCursor}`)
  }, [v.treeCursor])

  const leafChange = new Map(changes.map((c) => [c.path, c]))
  const under = (p: string) => changes.filter((c) => c.path === p || c.path.startsWith(p + ".")).length

  return (
    <scrollbox ref={ref} flexGrow={1} scrollbarOptions={scrollbar(t)}>
      {rows.map((r: TreeRow, i) => {
        const cursor = focused && i === v.treeCursor
        const flash = s.flashLevel(s.flashPaths.get(r.path))
        const c = leafChange.get(r.path)
        const n = r.branch ? under(r.path) : 0
        const indent = "  ".repeat(r.depth)
        const left: Part[] = [
          [cursor ? "▌" : " ", t.accent],
          [indent, t.dim],
          [r.branch ? (r.open ? "▾ " : "▸ ") : "  ", t.muted],
          [r.key, c || n ? t.fg : t.sources[1]!, c ? BOLD : undefined],
          [": ", t.dim],
        ]
        if (!r.open) left.push([preview(r.value, 48), valueColor(r.value, t)])
        const right: Part[] = []
        if (c && !r.branch) right.push([` ← ${preview(c.before, 18)} `, t.remove])
        else if (n && !r.open) right.push([` ${n} changed `, t.warn])
        else if (n) right.push([` ${n} `, t.warn])
        let bg = cursor ? t.selBg : t.panel
        if (c) bg = mix(bg, t.add, 0.08)
        if (flash) bg = mix(bg, t.flash, flash)
        return (
          <Line
            key={r.path}
            id={`tree-${i}`}
            parts={spread(left, right, width)}
            bg={bg}
            onMouseDown={() => {
              v.treeCursor = i
              if (r.branch) s.setOpen(r.path, !r.open)
              s.emit()
            }}
          />
        )
      })}
    </scrollbox>
  )
}

function valueColor(v: unknown, t: { add: string; warn: string; muted: string; fg: string }) {
  if (typeof v === "string") return t.add
  if (typeof v === "number" || typeof v === "boolean") return t.warn
  if (v === null || v === undefined) return t.muted
  return t.fg
}

function CodeView({ content }: { content: string }) {
  const s = useApp()
  const syntax = useSyntax(s.theme)
  return (
    <scrollbox flexGrow={1} paddingLeft={1} scrollbarOptions={scrollbar(s.theme)}>
      <code content={content} filetype="javascript" syntaxStyle={syntax} fg={s.theme.fg} />
    </scrollbox>
  )
}

function DiffView() {
  const s = useApp()
  const t = s.theme
  const a = s.selected()!
  const syntax = useSyntax(t)
  const json = (v: unknown) => (JSON.stringify(v ?? null, null, 2) ?? "null") + "\n"
  const patch = createTwoFilesPatch("before", "after", json(a.prev), json(a.state), "", "", { context: 2 })
  if (!s.changes().length) return <Line parts={fit([["  no state change", t.muted]], 40)} />
  return (
    <diff
      flexGrow={1}
      diff={patch}
      view="unified"
      filetype="javascript"
      syntaxStyle={syntax}
      fg={t.fg}
      showLineNumbers
      lineNumberFg={t.dim}
      addedBg={mix(t.panel, t.add, 0.14)}
      removedBg={mix(t.panel, t.remove, 0.14)}
      addedSignColor={t.add}
      removedSignColor={t.remove}
    />
  )
}

function TraceView({ width }: { width: number }) {
  const s = useApp()
  const t = s.theme
  const a = s.selected()!
  return (
    <box flexDirection="column">
      {a.trace.map((f, i) => {
        const m = /^at (\S+)(?: \((.*)\))?$/.exec(f)
        const parts: Part[] = m?.[2]
          ? [[i ? "  " : "▸ ", t.accent], [m[1]!, i ? t.muted : t.fg, i ? undefined : BOLD], ["  " + m[2], t.dim]]
          : [[i ? "  " : "▸ ", t.accent], [f.replace(/^at /, ""), i ? t.muted : t.sources[1]!, i ? undefined : BOLD]]
        return <Line key={i} parts={fit([[" ", t.dim], ...parts], width)} bg={t.panel} />
      })}
    </box>
  )
}
