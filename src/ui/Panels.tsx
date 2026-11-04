import type { BoxRenderable, ScrollBoxRenderable } from "@opentui/core"
import { Fragment, useEffect, useRef, type ReactNode } from "react"
import { changeCount, clock, since, type Action } from "../model"
import type { AppState, Focus } from "../state"
import { mix } from "../theme"
import { BOLD, DIM, fit, Line, scrollbar, spread, STRIKE, useApp, type Part } from "./kit"
import { usePanelKeys } from "./keys"

// Focusable bordered panel; its keymap layer is active while focus is inside it.
export function Panel(props: {
  id: Focus
  title: string
  bottomTitle?: string
  width?: number
  grow?: boolean
  children: ReactNode
}) {
  const s = useApp()
  const t = s.theme
  const ref = useRef<BoxRenderable>(null)
  usePanelKeys(s, props.id, ref)
  const active = s.focus === props.id
  const typing = s.mode !== "normal" || !!s.picker || s.help
  // The border column shared with the left/right neighbour, as the drag key in AppState.
  const edgeAt = (x: number): "sources" | "actions" | null => {
    const box = ref.current
    if (!box) return null
    const right = x === box.x + box.width - 1
    const left = x === box.x
    if (props.id === "sources") return right ? "sources" : null
    if (props.id === "actions") return left ? "sources" : right ? "actions" : null
    return left ? "actions" : null
  }
  const dragging =
    s.dragging !== null && (props.id === "actions" || (props.id === "sources") === (s.dragging === "sources"))
  return (
    <box
      ref={ref}
      focusable
      focused={active && !typing}
      border
      borderStyle="rounded"
      borderColor={dragging ? t.accent : active ? t.borderActive : t.border}
      title={` ${props.title} `}
      titleColor={active ? t.accent : t.muted}
      bottomTitle={props.bottomTitle}
      bottomTitleAlignment="right"
      backgroundColor={t.panel}
      width={props.width}
      flexGrow={props.grow ? 1 : 0}
      flexShrink={props.grow ? 1 : 0}
      flexDirection="column"
      onMouseDown={(e) => {
        s.dragging = edgeAt(e.x)
        if (s.focus !== props.id) s.focus = props.id
        s.emit()
      }}
      onMouseDrag={(e) => {
        if (s.dragging) s.dragBorder(e.x), s.emit()
      }}
      onMouseUp={() => {
        if (s.dragging) (s.dragging = null), s.emit()
      }}
      onMouseDragEnd={() => {
        if (s.dragging) (s.dragging = null), s.emit()
      }}
    >
      {props.children}
    </box>
  )
}

function useScrollTo(id: string | undefined) {
  const ref = useRef<ScrollBoxRenderable>(null)
  useEffect(() => {
    if (id) ref.current?.scrollChildIntoView(id)
  }, [id])
  return ref
}

export function Sources({ width }: { width: number }) {
  const s = useApp()
  const t = s.theme
  const rows = s.sourceRows()
  const inner = width - 3
  const focused = s.focus === "sources"
  const ref = useScrollTo(`src-${s.srcCursor}`)
  const online = s.sources.filter((x) => x.connected).length
  return (
    <Panel id="sources" title="sources" bottomTitle={` ${online}/${s.sources.length} online `} width={width}>
      <scrollbox ref={ref} flexGrow={1} scrollbarOptions={scrollbar(t)}>
        {rows.map((r, i) => {
          const color = t.sources[r.source.color % t.sources.length]!
          const cursor = focused && i === s.srcCursor
          const off = !r.source.connected
          let parts: Part[]
          let bg = t.panel
          if (r.kind === "source") {
            const unseen = r.source.stores.reduce((n, st) => n + (s.unseen.get(st.key) ?? 0), 0)
            parts = spread(
              [
                [off ? " ○ " : " ● ", off ? t.dim : color],
                [r.source.name, off ? t.muted : t.fg, BOLD],
              ],
              off ? [[" offline ", t.dim]] : unseen ? [[`+${unseen} `, t.warn]] : [],
              inner,
            )
          } else {
            const active = !s.merge && r.store.key === s.activeKey
            const unseen = s.unseen.get(r.store.key)
            if (active) bg = t.selBg
            parts = spread(
              [
                [active ? "▌" : " ", t.accent],
                ["  ", t.dim],
                [r.store.name, active ? t.fg : t.muted, active ? BOLD : undefined],
                [r.store.lib === r.store.name ? "" : ` ${r.store.lib}`, t.dim],
              ],
              [[unseen ? `+${unseen} ` : `${r.store.actions.length} `, unseen ? t.warn : t.dim]],
              inner,
            )
          }
          if (cursor) bg = mix(t.selBg, t.accent, 0.18)
          return (
            <Line
              key={`${r.source.id}/${r.kind === "store" ? r.store.name : ""}`}
              id={`src-${i}`}
              parts={parts}
              bg={bg}
              onMouseDown={() => {
                s.srcCursor = i
                s.activate(r.kind === "store" ? r.store.key : r.source.stores[0]!.key)
                s.emit()
              }}
            />
          )
        })}
      </scrollbox>
    </Panel>
  )
}

const WINDOW = 200

// Row the ghost goes above: the first shown action of the store at or after the original slot.
function ghostIndex(s: AppState, tl: Action[], sel: Action | undefined, home: { before?: Action } | null): number {
  if (!sel || !home) return -1
  const st = s.store(sel.storeKey)
  const before = home.before
  if (!st || !before) return tl.length
  const at = st.actions.indexOf(before)
  const i = tl.findIndex((x) => x.storeKey === st.key && x !== sel && st.actions.indexOf(x) >= at)
  return i < 0 ? tl.length : i
}

export function Actions({ width }: { width: number }) {
  const s = useApp()
  const t = s.theme
  const tl = s.timeline()
  const sel = s.selected()
  const idx = s.selectedIndex()
  const inner = width - 3
  const ref = useScrollTo(sel ? `act-${sel.id}` : undefined)
  // Render a window around the cursor; the store keeps up to `maxage` actions.
  const from = Math.max(0, Math.min(idx - WINDOW / 2, tl.length - WINDOW))
  const visible = tl.slice(from, from + WINDOW)
  const locked = s.target()?.locked ? " · ◆ locked" : ""
  const hidden = s.view().hidden.size
  const delta = s.settings.time === "delta"
  const moved = s.merge ? 0 : s.movedCount(s.activeKey)
  // While a moved action is selected, a ghost row marks the slot it came from.
  const home = sel ? s.home(sel) : null
  const ghostAt = ghostIndex(s, tl, sel, home)
  // Amber like TRAVEL: the list no longer shows what the app really did.
  const soft = mix(t.panel, t.warn, 0.55)
  const ghost = home && sel && (
    <Line
      key="ghost"
      id="ghost"
      parts={fit(
        [
          [" ╌╌ ", soft],
          [sel.type, t.warn],
          [" was here ".padEnd(Math.max(0, inner - sel.type.length - 4), "╌"), soft],
        ],
        inner,
      )}
      bg={t.panel}
      onMouseDown={() => {
        s.restoreAction(sel)
        s.emit()
      }}
    />
  )
  // Visual mode selection, inclusive of anchor and cursor.
  const range = new Set(s.mode === "visual" ? s.visualRange().map((a) => a.id) : [])
  const title = (s.filter ? `actions /${s.filter}` : s.merge ? "actions · all apps" : "actions") + locked
  return (
    <Panel
      id="actions"
      title={title}
      bottomTitle={(moved ? ` ${moved} moved ·` : "") + (hidden ? ` ${hidden} hidden ·` : "") + ` ${tl.length} `}
      width={width}
    >
      <scrollbox ref={ref} flexGrow={1} stickyScroll stickyStart="bottom" scrollbarOptions={scrollbar(t)}>
        {visible.map((a, k) => {
          const i = from + k
          const isSel = a === sel
          const future = i > idx
          const changes = changeCount(a)
          const src = s.merge ? s.sourceOf(a.storeKey) : undefined
          const flash = s.flashLevel(s.flashActions.get(a.id))
          const base = range.has(a.id) ? mix(t.selBg, t.sources[2]!, 0.3) : isSel ? t.selBg : t.panel
          const bg = flash ? mix(base, t.flash, flash) : base
          const typeFg = a.skipped || future ? t.dim : isSel ? t.fg : t.fg
          const attrs = a.skipped ? STRIKE : isSel ? BOLD : undefined
          const out = !!s.home(a)
          const left: Part[] = [
            [isSel ? "▌" : " ", t.accent],
            // Moved actions sit out of time order; dim their clock so that reads as expected.
            [(delta && i > 0 ? since(a.time - tl[i - 1]!.time) : clock(a.time)) + " ", future || out ? t.dim : t.muted],
          ]
          if (src) left.push([src.name.slice(0, 8).padEnd(9), t.sources[src.color % t.sources.length]!])
          if (a.fromDevtools) left.push(["⇡ ", t.add, BOLD])
          if (out) left.push(["⇅ ", t.warn, BOLD])
          left.push([a.type, typeFg, attrs])
          const right: Part[] = changes ? [[` ±${changes} `, future ? t.dim : t.muted]] : [[" ", t.dim]]
          // Revert returns to the state right below this line.
          const committed = s.store(a.storeKey)?.commitId === a.id
          return (
            <Fragment key={a.id}>
              {i === ghostAt && ghost}
              <Line
                id={`act-${a.id}`}
                parts={spread(left, right, inner)}
                bg={bg}
                onMouseDown={() => {
                  s.selectAction(a.id)
                  s.moving = { id: a.id }
                  s.emit()
                }}
                onMouseDrag={(e) => {
                  // The row under the pointer, so ghost and commit lines in between do not count.
                  const row = ref.current?.getChildren().find((c) => c.screenY === e.y && /^(act-|ghost)/.test(c.id))
                  // Over its own ghost: back to the original place.
                  if (row?.id === "ghost") s.restoreAction()
                  else if (row) s.dragTo(Number(row.id.slice(4)))
                  s.emit()
                }}
                onMouseUp={() => {
                  s.moving = null
                  s.emit()
                }}
              />
              {committed && (
                <Line parts={[["── committed " + "─".repeat(Math.max(0, inner - 13)), t.add]]} bg={t.panel} />
              )}
            </Fragment>
          )
        })}
        {ghostAt === tl.length && ghost}
        {!tl.length && <Line parts={fit([["  no actions" + (s.filter ? " match" : " yet"), t.muted, DIM]], inner)} />}
      </scrollbox>
    </Panel>
  )
}
