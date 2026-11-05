// React contexts as stores. React reports each commit to __REACT_DEVTOOLS_GLOBAL_HOOK__, the global React DevTools
// and Fast Refresh hook into; the client chains onto it, finds the context providers the app renders and reports each
// one's value like a connect() store: @@INIT when it mounts, "update" when the value changes. Read only: nothing can
// set a context's value from outside. Only the app's own contexts are watched, not those of Next, react-redux, Radix…
// Each "update" carries what changed: the top-level keys whose values differ, or the whole value when it is not an object.
// It relies on React's fiber tree, as the React DevTools do; any surprise there turns it off instead of breaking the app.

import { CONTEXT_LIB } from "./protocol"

// What it reads of a fiber; stable since React 16.
type Fiber = {
  tag: number
  type: any
  memoizedProps: any
  child: Fiber | null
  sibling: Fiber | null
  return: Fiber | null
  alternate: Fiber | null
  // Development builds only: the component that rendered it, and where its element was made (React 19 keeps the
  // stack, React 18 the file).
  _debugOwner?: Fiber | null
  _debugStack?: { stack?: string } | null
  _debugSource?: { fileName?: string } | null
}

export type ContextConn = { init(state: unknown): void; send(action: { type: string; payload: unknown }, state: unknown): void }
export type ConnectContext = (options: { name: string; lib: string; trace: false; readOnly: true }) => ContextConn

const CONTEXT_PROVIDER = 10
// Function, class, forwardRef, memo and simple memo components.
const COMPONENTS = new Set([0, 1, 11, 14, 15])
// Frames of React itself, also as bundled by Next (next/dist/compiled/react-dom) and the test renderer.
const REACT_FRAME = /[\\/_](react|react-dom|react-reconciler|react-test-renderer|scheduler|react-server-dom-[\w-]+)[\\/_]|react[-_]stack/
const LIBRARY = /[\\/_]node_modules[\\/_]/
// A walk this slow, commit after commit, means an app too big for it: it stops rather than slow the app down.
const SLOW_MS = 20
const SLOW_COMMITS = 3

type Watched = { context: object; name: string; conn: ContextConn; last: unknown; mounted: boolean }

export function watchContexts(connect: ConnectContext, enabled: () => boolean) {
  const g = globalThis as any
  let hook = g.__REACT_DEVTOOLS_GLOBAL_HOOK__
  if (!hook) {
    // Outside a browser a hook made here would keep react-devtools-core from installing its own, should the app use it.
    if (typeof document === "undefined") return
    // Neither React DevTools (installed before any page script) nor Fast Refresh: the bare hook React looks for when
    // it loads, so it reports its commits.
    let ids = 0
    hook = g.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      renderers: new Map(),
      supportsFiber: true,
      inject(renderer: unknown) {
        this.renderers.set(++ids, renderer)
        return ids
      },
      onScheduleFiberRoot() {},
      onCommitFiberRoot() {},
      onCommitFiberUnmount() {},
      onPostCommitFiberRoot() {},
      checkDCE() {},
    }
  }
  if (hook.isDisabled || hook.__openstate) return
  hook.__openstate = true

  const byFiber = new WeakMap<Fiber, Watched>()
  // Unmounted providers by context: the next provider of it continues their store instead of making another.
  const free = new Map<object, Watched[]>()
  const fromApp = new WeakMap<object, boolean>()
  const names = new Map<string, number>()
  let off = false
  let slow = 0

  function visit(f: Fiber) {
    // React 19's provider is the context itself; React 18's points to it.
    const context = f.type?._context ?? f.type
    if (!context || typeof context !== "object") return
    const value = f.memoizedProps?.value
    let w = byFiber.get(f) ?? (f.alternate ? byFiber.get(f.alternate) : undefined)
    if (!w) {
      if (!isApps(f, context)) return
      w = free.get(context)?.pop()
      if (w) {
        w.mounted = true
        if (!same(w.last, value)) w.conn.send({ type: "mount", payload: changed(w.last, value) }, value)
      } else {
        const name = uniqueName(context.displayName || componentName(owner(f)) || "Context")
        w = { context, name, conn: connect({ name, lib: CONTEXT_LIB, trace: false, readOnly: true }), last: value, mounted: true }
        w.conn.init(value)
      }
    } else if (value !== w.last && !same(w.last, value)) w.conn.send({ type: "update", payload: changed(w.last, value) }, value)
    w.last = value
    byFiber.set(f, w)
    if (f.alternate) byFiber.set(f.alternate, w)
  }

  // A context is the app's when the component providing it is not in node_modules; one whose origin cannot be told
  // (a production build, no development transform) is left out rather than risk listing a library's.
  function isApps(f: Fiber, context: object): boolean {
    let known = fromApp.get(context)
    if (known === undefined) {
      const where = sourceOf(f)
      known = where !== null && !LIBRARY.test(where)
      fromApp.set(context, known)
    }
    return known
  }

  // Several providers of one context at once are numbered, as stores of one name would be taken for twins.
  function uniqueName(base: string): string {
    const n = (names.get(base) ?? 0) + 1
    names.set(base, n)
    return n === 1 ? base : `${base} #${n}`
  }

  function walk(root: Fiber) {
    const stack: Fiber[] = [root]
    while (stack.length) {
      const f = stack.pop()!
      if (f.tag === CONTEXT_PROVIDER) visit(f)
      if (f !== root && f.sibling) stack.push(f.sibling)
      // A subtree React reused as it was has the same providers with the same values: not walked again.
      if (f.child && f.alternate?.child !== f.child) stack.push(f.child)
    }
  }

  const onCommit = hook.onCommitFiberRoot
  hook.onCommitFiberRoot = function (this: unknown, _id: unknown, root: { current?: Fiber }) {
    if (!off && enabled() && root?.current)
      try {
        const start = performance.now()
        walk(root.current)
        slow = performance.now() - start > SLOW_MS ? slow + 1 : 0
        if (slow >= SLOW_COMMITS) stop("too slow for this app")
      } catch (e) {
        stop((e as Error).message)
      }
    return onCommit?.apply(this, arguments as never)
  }
  const onUnmount = hook.onCommitFiberUnmount
  hook.onCommitFiberUnmount = function (this: unknown, _id: unknown, f: Fiber) {
    const w = f?.tag === CONTEXT_PROVIDER ? byFiber.get(f) : undefined
    if (w?.mounted) {
      w.mounted = false
      free.set(w.context, [...(free.get(w.context) ?? []), w])
    }
    return onUnmount?.apply(this, arguments as never)
  }

  function stop(why: string) {
    off = true
    console.warn(`[openstate] React contexts are no longer reported: ${why}`)
  }
}

// The component that rendered a fiber: its owner in development builds, else the nearest component above it.
function owner(f: Fiber): Fiber | null {
  if (f._debugOwner) return f._debugOwner
  for (let p = f.return; p; p = p.return) if (COMPONENTS.has(p.tag)) return p
  return null
}

function componentName(f: Fiber | null): string {
  const name = (type: any): string =>
    !type ? "" : typeof type === "function" ? type.displayName || type.name || "" : type.displayName || name(type.type ?? type.render)
  return f ? name(f.type) : ""
}

// Where the provider's element was made: the file (React 18), or the stack frame of the component that made it
// (React 19). Without a component name, the first frame that is not React's own. Null when it cannot be told: no
// development build, or a frame dropped (JavaScriptCore, as in Safari, drops that of a component that ends in
// `return <Context value={…}>`, and the next frame could be anyone's).
function sourceOf(f: Fiber): string | null {
  const file = f._debugSource?.fileName
  if (file) return file
  const stack = f._debugStack?.stack
  if (!stack) return null
  const frames = stack.split("\n").slice(1)
  const name = componentName(owner(f))
  if (name) return frames.find((l) => l.includes(` ${name} (`) || l.trim().startsWith(`at ${name} `) || l.startsWith(`${name}@`)) ?? null
  return frames.find((l) => !REACT_FRAME.test(l) && /[\\/]/.test(l)) ?? null
}

// What a new value changed, as a setState call would have said it: the top-level keys whose values differ (functions
// never do), or the whole value when either is not a plain object.
function changed(prev: unknown, next: unknown): unknown {
  if (!plain(prev) || !plain(next)) return next
  return Object.fromEntries(Object.entries(next).filter(([k, v]) => !Object.prototype.hasOwnProperty.call(prev, k) || !same(prev[k], v)))
}

function plain(x: unknown): x is Record<string, unknown> {
  if (!x || typeof x !== "object" || Array.isArray(x)) return false
  const proto = Object.getPrototypeOf(x)
  return proto === Object.prototype || proto === null
}

// Whether two values hold the same: functions count as equal (callbacks are made anew on every render), and React
// elements by type and key. Gives up as "changed" past a size, which only costs an extra action.
function same(a: unknown, b: unknown): boolean {
  let budget = 2000
  const eq = (x: any, y: any, depth: number): boolean => {
    if (Object.is(x, y)) return true
    if (typeof x === "function" && typeof y === "function") return true
    if (!x || !y || typeof x !== "object" || typeof y !== "object") return false
    if (--budget < 0 || depth > 10) return false
    if (Object.getPrototypeOf(x) !== Object.getPrototypeOf(y)) return false
    if (typeof x.$$typeof === "symbol") return x.$$typeof === y.$$typeof && x.type === y.type && x.key === y.key
    if (x instanceof Date) return x.getTime() === y.getTime()
    if (x instanceof Map || x instanceof Set) return eq([...x], [...y], depth + 1)
    const keys = Object.keys(x)
    if (keys.length !== Object.keys(y).length) return false
    return keys.every((k) => Object.prototype.hasOwnProperty.call(y, k) && eq(x[k], y[k], depth + 1))
  }
  return eq(a, b, 0)
}
