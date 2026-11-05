import type { MouseEvent } from "@opentui/core"
import { useEffect } from "react"
import { changeCount, clock, type Action } from "../model"
import { SHINE_MS, type AppState } from "../state"
import { VERSION } from "../update"
import { mix, shineGlow, titleShades } from "../theme"
import { BOLD, fit, Line, spread, useApp, type Part } from "./kit"

const SEP = " › "

export function Header({ width }: { width: number }) {
  const s = useApp()
  useEffect(() => s.shineTitle(), [])
  const t = s.theme
  const store = s.store()
  const src = s.sourceOf(s.activeKey)
  const row = s.tab === "state" ? s.treeRows()[s.view().treeCursor] : undefined
  const pinned = s.view().pinned
  const segs = (row?.path ?? pinned ?? "").split(".").filter(Boolean)
  const pinDepth = pinned ? pinned.split(".").length : 0

  // Each crumb remembers what clicking it does.
  const crumbs: { parts: Part[]; click?: () => void }[] = [{ parts: [[" ", t.bg], ...title(s)] }]
  if (s.merge) crumbs.push({ parts: [["all apps", t.fg]] })
  else if (src && store) {
    crumbs.push({ parts: [[src.name, t.sources[src.color % t.sources.length]!]], click: () => (s.focus = "sources") })
    crumbs.push({ parts: [[store.name, t.fg]], click: () => ((s.view().treeCursor = 0), (s.focus = "actions")) })
  }
  segs.forEach((seg, i) => {
    const path = segs.slice(0, i + 1).join(".")
    const last = i === segs.length - 1
    // The pinned part of the path is marked; clicking it unpins.
    const inPin = i < pinDepth
    crumbs.push({
      parts: [[i === pinDepth - 1 ? `${seg} ⌖` : seg, inPin ? t.accent : last ? t.fg : t.muted, last || inPin ? BOLD : undefined]],
      click: () => {
        if (inPin) s.view().pinned = null
        const idx = s.treeRows().findIndex((r) => r.path === path)
        if (idx >= 0) s.view().treeCursor = idx
        s.focus = "inspector"
      },
    })
  })

  const left: Part[] = crumbs.flatMap((c, i) => (i ? [[SEP, t.dim] as Part, ...c.parts] : c.parts))
  const onDown = (e: MouseEvent) => {
    let x = 0
    for (let i = 0; i < crumbs.length; i++) {
      const w = crumbs[i]!.parts.reduce((n, p) => n + p[0].length, 0) + (i ? SEP.length : 0)
      if (e.x < x + w) return (crumbs[i]!.click?.(), s.emit())
      x += w
    }
  }
  return <Line parts={spread(left, [[`${VERSION} `, t.dim]], width)} bg={t.bg} onMouseDown={onDown} />
}

// "open" in the accent colour and "state" a shade lighter; a shine runs across it once, left to right, when
// openstate opens.
function title(s: AppState): Part[] {
  const t = s.theme
  const name = "openstate"
  const shades = titleShades(t)
  const since = s.titleShine === null || !s.settings.flash ? Infinity : Date.now() - s.titleShine
  // The shine's centre, from before the first letter to past the last, and its glow two letters wide.
  const at = (since / SHINE_MS) * (name.length + 4) - 2
  return [...name].map((ch, i): Part => [ch, mix(i < 4 ? shades.open : shades.state, t.shine, shineGlow(i, at)), BOLD])
}

const BARS = "▁▂▃▄▅▆▇█"
const LABEL_W = 14

// A cell is one second, or a share of a pause: a stretch with no actions longer than GAP_MIN seconds is drawn
// GAP_W cells wide whatever it lasted, so activity is not lost in idle time.
type Cell = { from: number; to: number; gap: boolean; weight: number; actions: Action[]; colors: Map<number, number>; offline: boolean }
const GAP_MIN = 4
const GAP_W = 3

// The columns from the first action to now, in seconds since the epoch: one per second, or a pause's GAP_W.
export function columns(seconds: number[], now: number): { from: number; to: number; gap: boolean }[] {
  const cols: { from: number; to: number; gap: boolean }[] = []
  const marks = [...new Set([...seconds, now])].sort((a, b) => a - b)
  marks.forEach((sec, i) => {
    const prev = marks[i - 1]
    if (prev !== undefined && sec - prev - 1 > GAP_MIN) for (let k = 0; k < GAP_W; k++) cols.push({ from: prev + 1, to: sec - 1, gap: true })
    else if (prev !== undefined) for (let x = prev + 1; x < sec; x++) cols.push({ from: x, to: x, gap: false })
    cols.push({ from: sec, to: sec, gap: false })
  })
  return cols
}

// Cells anchored to the first action, so past ones never move: the chart fills from the left and scrolls only once it
// reaches the right edge. A cell's weight is how much state changed in it, scaled against the whole history.
function trackModel(s: AppState, cells: number) {
  const tl = s.timeline()
  const sel = s.selected()
  const secOf = (time: number) => Math.floor(time / 1000)
  const nowSec = secOf(Date.now())
  const { cols, colOf } = s.cached("track-cols", [tl, nowSec, s.dataRev], () => {
    const cols = columns(
      tl.map((a) => secOf(a.time)),
      nowSec,
    )
    // The column of a second: its own, or the first of the pause it falls in.
    const index = new Map<number, number>()
    cols.forEach((c, i) => !c.gap && index.set(c.from, i))
    const colOf = (time: number) => {
      const sec = secOf(time)
      const own = index.get(sec)
      if (own !== undefined) return own
      const i = cols.findIndex((c) => c.to >= sec)
      return i < 0 ? cols.length - 1 : i
    }
    return { cols, colOf }
  })
  // Live, the window ends at "now". Time travelling, it stays put and only slides the
  // minimum needed to keep the cursor (plus a small margin) in view.
  const v = s.view()
  const latest = Math.max(0, cols.length - cells)
  let start = latest
  if (v.cursor !== null && sel) {
    start = v.trackFrom === null ? latest : colOf(v.trackFrom)
    const c = colOf(sel.time)
    const margin = Math.min(4, Math.floor(cells / 6))
    if (c < start + margin) start = c - margin
    else if (c > start + cells - 1 - margin) start = c - cells + 1 + margin
    start = Math.max(0, Math.min(latest, start))
  }
  v.trackFrom = cols[start]!.from * 1000
  const last = Math.min(cells - 1, cols.length - 1 - start)
  const timeOf = (c: number) => cols[start + c]!.from * 1000

  // Rebuilt when the data, the window or the current second changes, not for every animation frame.
  const { grid, peak } = s.cached("track", [cols, cells, start, s.merge], () => {
    const perCol = new Map<number, number>()
    for (const a of tl) perCol.set(colOf(a.time), (perCol.get(colOf(a.time)) ?? 0) + changeCount(a))
    const peak = Math.max(3, ...perCol.values())
    const watched = s.merge ? s.sources : s.sources.filter((x) => x.id === s.sourceOf(s.activeKey)?.id)
    const grid: Cell[] = Array.from({ length: cells }, (_, c) => {
      const col = cols[start + c]
      const from = (col?.from ?? 0) * 1000
      const to = ((col?.to ?? 0) + 1) * 1000
      return {
        from,
        to,
        gap: !!col?.gap,
        weight: perCol.get(start + c) ?? 0,
        actions: [],
        colors: new Map(),
        offline:
          c <= last &&
          watched.some((src) => src.links.some((l, i) => !l.connected && l.time < to && (src.links[i + 1]?.time ?? Date.now()) > from)),
      }
    })
    for (const a of tl) {
      const g = grid[colOf(a.time) - start]
      if (!g) continue
      g.actions.push(a)
      const color = s.sourceOf(a.storeKey)?.color ?? 0
      g.colors.set(color, (g.colors.get(color) ?? 0) + changeCount(a) + 1)
    }
    return { grid, peak }
  })
  const cur = sel ? colOf(sel.time) - start : last
  return { tl, last, cur, peak, grid, timeOf, more: { before: start > 0, after: start + cells < cols.length } }
}

// 1m 02s, 34s, 2h 05m.
function duration(ms: number): string {
  const sec = Math.round(ms / 1000)
  if (sec < 60) return `${sec}s`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${String(sec % 60).padStart(2, "0")}s`
  return `${Math.floor(sec / 3600)}h ${String(Math.floor(sec / 60) % 60).padStart(2, "0")}m`
}

// Activity over time plus the time cursor; click or drag to travel, hover to see what happened.
export function Track({ width }: { width: number }) {
  const s = useApp()
  const t = s.theme
  const cells = Math.max(1, width - 2 - LABEL_W)
  const { tl, last, cur, peak, grid, timeOf, more } = trackModel(s, cells)
  s.trackSpan = cells
  const hovered = s.hover?.cell ?? null

  // Merged view colours each cell by the app that changed the most there.
  const base = (g: Cell) => {
    const top = [...g.colors].sort((a, b) => b[1] - a[1])[0]?.[0]
    return s.merge && top !== undefined ? t.sources[top % t.sources.length]! : t.accent
  }
  const row = (ch: (g: Cell, c: number) => Part): Part[] => grid.map((g, c): Part => (c > last ? [" ", t.dim] : ch(g, c)))

  const bars = row((g, c) => {
    if (g.gap) return [" ", t.dim]
    const fg = c === cur || c === hovered ? t.fg : c > cur ? t.dim : base(g)
    return [BARS[Math.max(0, Math.min(8, Math.ceil((g.weight / peak) * 8)) - 1)]!, g.weight ? fg : t.dim]
  })
  const rail = row((g, c) => {
    if (c === cur) return ["●", t.fg, BOLD]
    if (g.actions.some((a) => a.skipped)) return ["×", t.warn, BOLD]
    if (g.offline) return ["┄", t.remove]
    // A pause: the line breaks, so time is plainly not to scale there.
    if (g.gap) return ["╌", c < cur ? t.accent : t.dim]
    return c < cur ? ["━", t.accent] : ["─", t.dim]
  })
  // Arrows tell there is more history outside the window.
  const label = ` ${tl.length ? s.selectedIndex() + 1 : 0}/${tl.length}`.padEnd(LABEL_W)
  const rows: Part[][] = [
    info(),
    [[" ", t.dim], ...bars, [" ".repeat(LABEL_W + 1), t.dim]],
    [more.before ? ["‹", t.warn, BOLD] : [" ", t.dim], ...rail, [more.after ? "›" : " ", t.warn, BOLD], [label, t.muted]],
  ]

  // Line above the chart, blank until hover: what happened in the hovered cell.
  function info(): Part[] {
    const g = hovered === null ? undefined : grid[hovered]
    if (!g) return [[" ".repeat(width), t.dim]]
    const changes = g.actions.reduce((n, a) => n + changeCount(a), 0)
    const first = g.actions[0]
    const text: Part[] = first
      ? [
          [first.type, t.fg, BOLD],
          [g.actions.length > 1 ? ` +${g.actions.length - 1}` : "", t.muted],
          [changes ? `  ±${changes}` : "", t.muted],
          [`  ${clock(timeOf(hovered!))}`, t.dim],
        ]
      : g.gap
        ? [[`nothing for ${duration(g.to - g.from)}  ${clock(g.from)} → ${clock(g.to)}`, t.dim]]
        : [[`${clock(timeOf(hovered!))}  nothing happened`, t.dim]]
    const len = text.reduce((n, [x]) => n + x.length, 0)
    const col = 1 + hovered!
    // Text runs right of the marker when it fits, otherwise it ends at the marker.
    const parts: Part[] =
      col + 2 + len <= width
        ? [[" ".repeat(col), t.dim], ["▾ ", t.fg], ...text]
        : [[" ".repeat(Math.max(0, col - len - 1)), t.dim], ...text, [" ▾", t.fg]]
    return fit(parts, width, t.dim)
  }

  const cellAt = (e: MouseEvent) => Math.max(0, Math.min(last, e.x - e.currentTarget!.x - 1))
  // A cell selects its first action; clicking the same cell again moves to its next one.
  // An empty cell selects the closest action in time.
  const travel = (e: MouseEvent, cycle: boolean) => {
    if (!tl.length) return
    const c = cellAt(e)
    const inCell = grid[c]!.actions
    let best: Action
    if (inCell.length) {
      const i = inCell.indexOf(s.selected()!)
      best = i < 0 ? inCell[0]! : cycle ? inCell[(i + 1) % inCell.length]! : inCell[i]!
    } else {
      const target = (grid[c]!.from + grid[c]!.to) / 2
      best = tl[0]!
      for (const a of tl) if (Math.abs(a.time - target) < Math.abs(best.time - target)) best = a
    }
    s.selectAction(best.id)
    s.emit()
  }
  const mouse = {
    onMouseDown: (e: MouseEvent) => travel(e, true),
    onMouseDrag: (e: MouseEvent) => travel(e, false),
    onMouseMove: (e: MouseEvent) => {
      const c = cellAt(e)
      if (s.hover?.cell !== c) (s.hover = { cell: c }), s.emit()
    },
    // Wheel travels a few cells at a time: up/left goes back.
    onMouseScroll: (e: MouseEvent) => {
      const d = e.scroll?.direction
      s.travelBy(d === "up" || d === "left" ? -3 : 3)
      s.emit()
    },
    onMouseOut: () => {
      if (s.hover) (s.hover = null), s.emit()
    },
  }
  return (
    <box flexDirection="column" flexShrink={0}>
      {rows.map((r, i) => (
        <Line key={i} parts={r} bg={t.bg} {...(i ? mouse : {})} />
      ))}
    </box>
  )
}
