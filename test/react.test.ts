// React contexts as stores, against the real React through react-test-renderer: React reports its commits to the
// devtools hook as it does in a browser.
import { afterAll, expect, test } from "bun:test"
import { startBridge } from "../src/bridge"
import type { Store } from "../src/model"

// Tells React that act() is in use, so it does not warn on every update.
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const PORT = 18_140
const URL = `ws://localhost:${PORT}`
const bridge = startBridge({ onChange() {}, isPaused: () => false, maxAge: () => 50, warn() {} })
expect(bridge.listen(PORT, false)).toBeNull()
afterAll(() => bridge.close())

// Outside a browser the client only joins a hook that is already there, as Fast Refresh's is in a dev server.
const g = globalThis as any
g.__REACT_DEVTOOLS_GLOBAL_HOOK__ ??= {
  renderers: new Map(),
  supportsFiber: true,
  inject: () => 1,
  onCommitFiberRoot() {},
  onCommitFiberUnmount() {},
}
const { install } = await import("../client/index")
install({ url: URL, name: "react-app" })
const React = await import("react")
const { act, create } = await import("react-test-renderer")
const { LibProvider } = await import("./fixtures/node_modules/ui-lib")
const h = React.createElement

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function until(ok: () => boolean, ms = 4000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(20)) if (ok()) return
  throw new Error("timed out")
}
const stores = () => bridge.sources.filter((s) => s.name === "react-app").flatMap((s) => s.stores)
const named = (name: string) => stores().find((s) => s.name === name)
const states = (st?: Store) => st?.actions.map((a) => a.state) ?? []
const types = (st?: Store) => st?.actions.map((a) => a.type) ?? []

// Components here end in a finally so their element is not made in a tail call: JavaScriptCore (Bun, Safari) drops
// the frame of a component that returns `createElement(…)` straight away, and openstate then cannot tell whose
// context it is. Chrome and Firefox keep it either way.
let renders = 0
const Cart = React.createContext({ items: 0, add: () => {} })
let setItems: (n: number) => void = () => {}
function CartProvider({ children }: { children?: unknown }) {
  const [items, set] = React.useState(1)
  setItems = set
  try {
    return h(Cart, { value: { items, add: () => set(items + 1) } }, children as never)
  } finally {
    renders++
  }
}
const Theme = React.createContext("light")
Theme.displayName = "ThemeContext"
function App({ themes = 1, cart = true }: { themes?: number; cart?: boolean }) {
  try {
    const inner = h(LibProvider, null, ...Array.from({ length: themes }, (_, i) => h(Theme, { key: i, value: "dark" })))
    return cart ? h(CartProvider, null, inner) : inner
  } finally {
    renders++
  }
}

let root: ReturnType<typeof create>
test("the app's contexts show up with their value, a library's do not", async () => {
  await act(() => {
    root = create(h(App))
  })
  await until(() => !!named("CartProvider") && !!named("ThemeContext"))
  const cart = named("CartProvider")!
  expect(cart.lib).toBe("react context")
  expect(states(cart)).toEqual([{ items: 1, add: "[Function add]" }])
  expect(stores().some((s) => JSON.stringify(states(s)).includes("theme"))).toBe(false)
})

test("a change is an update; a render with the same values is nothing", async () => {
  await act(() => setItems(2))
  await act(() => root.update(h(App)))
  await until(() => states(named("CartProvider")).length === 2)
  await sleep(100)
  expect(types(named("CartProvider"))).toEqual(["@@INIT", "update"])
  expect(states(named("CartProvider")).at(-1)).toEqual({ items: 2, add: "[Function add]" })
})

test("a provider that comes back continues its store", async () => {
  await act(() => root.update(h(App, { cart: false })))
  await act(() => root.update(h(App)))
  await until(() => types(named("CartProvider")).includes("mount"))
  expect(stores().filter((s) => s.name.startsWith("CartProvider"))).toHaveLength(1)
  expect(states(named("CartProvider")).at(-1)).toEqual({ items: 1, add: "[Function add]" })
})

test("several providers of one context are numbered", async () => {
  await act(() => root.update(h(App, { themes: 2 })))
  await until(() => !!named("ThemeContext #2"))
})

test("a context can only be watched", async () => {
  const cart = named("CartProvider")!
  expect(() => cart.conn.dispatch({ type: "x" })).toThrow(/can only be watched/)
  expect(() => cart.conn.revert()).toThrow(/can only be watched/)
})
