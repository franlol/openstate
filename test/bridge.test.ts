// The bridge against real clients: @openstate-devtools/client with redux and a connect() store, a Redux DevTools remote
// app, pages from other origins.
import { afterAll, describe, expect, test } from "bun:test"
import { networkInterfaces } from "node:os"
import jsan from "jsan"
import { createStore } from "redux"
import { startBridge, type Bridge } from "../src/bridge"
import { clientStatus, type Store } from "../src/model"

const PORT = 18_130
const URL = `ws://localhost:${PORT}`
process.env.OPENSTATE_URL = URL
const { install } = await import("../client/index")
const { connectLikeZustand } = await import("./fixtures/node_modules/zustand/middleware")

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function until(ok: () => boolean, ms = 4000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(20)) if (ok()) return
  throw new Error("timed out")
}

let bridge: Bridge
const open = () => {
  bridge = startBridge({ onChange() {}, isPaused: () => false, maxAge: () => 50, warn() {} })
  expect(bridge.listen(PORT, false)).toBeNull()
}
open()
install({ url: URL, name: "test-app" })
afterAll(() => bridge.close())

const storeNamed = (name: string) => bridge.sources.flatMap((s) => s.stores).find((s) => s.name === name)
const states = (st: Store | undefined) => st?.actions.map((a) => (a.state as { n: number }).n) ?? []

// What goes out of the app, counted by message. Stores of other test files share the client (react.test.ts runs first
// on some machines): their React contexts are left out.
const sent: Record<string, number> = {}
const realSend = WebSocket.prototype.send
WebSocket.prototype.send = function (data) {
  for (const m of [JSON.parse(String(data))].flat())
    if (m.lib !== "react context") sent[m.t ?? m.event] = (sent[m.t ?? m.event] ?? 0) + 1
  return realSend.call(this, data)
}
const resetSent = () => Object.keys(sent).forEach((k) => delete sent[k])

describe("redux", () => {
  const reducer = (s = { n: 0 }, a: { type: string }) => (a.type === "inc" ? { n: s.n + 1 } : s)
  // The instrument adds liftedStore, which redux's types do not know.
  const store: any = createStore(reducer, (globalThis as any).__REDUX_DEVTOOLS_EXTENSION__({ name: "redux" }))
  const appStates = () => store.liftedStore.getState().computedStates.map((c: { state: { n: number } }) => c.state.n)

  test("shows up at once, with its @@INIT", async () => {
    await until(() => !!storeNamed("redux"))
    expect(states(storeNamed("redux"))).toEqual([0])
  })

  test("past maxAge only new actions travel, and the mirror matches the app", async () => {
    resetSent()
    for (let i = 0; i < 300; i++) {
      store.dispatch({ type: "inc" })
      if (i % 10 === 0) await sleep(2)
    }
    await until(() => states(storeNamed("redux")).at(-1) === 300)
    expect(states(storeNamed("redux"))).toEqual(appStates())
    expect(sent.lifted).toBeUndefined()
    expect(sent.action).toBe(300)
  })

  test("a burst beyond the queue catches up with one init", async () => {
    resetSent()
    for (let i = 0; i < 5000; i++) store.dispatch({ type: "inc" })
    await until(() => states(storeNamed("redux")).at(-1) === 5300)
    expect(states(storeNamed("redux"))).toEqual(appStates())
    expect(sent).toEqual({ init: 1 })
  })
})

describe("connect() stores", () => {
  const conn = (globalThis as any).__REDUX_DEVTOOLS_EXTENSION__.connect({ name: "zustand store" })
  let n = 0
  const step = (k: number) => {
    for (let i = 0; i < k; i++) conn.send({ type: "set" }, { n: ++n })
  }

  test("a reconnect to the same openstate fills in what it missed", async () => {
    conn.init({ n })
    step(10)
    await until(() => states(storeNamed("zustand store")).length === 11)
    bridge.close()
    await sleep(100)
    step(20)
    expect(bridge.listen(PORT, false)).toBeNull()
    await until(() => states(storeNamed("zustand store")).length === 31)
    expect(states(storeNamed("zustand store"))).toEqual(Array.from({ length: 31 }, (_, i) => i))
  })

  test("a new openstate gets what the app kept", async () => {
    step(40)
    await sleep(100)
    bridge.close()
    open()
    await until(() => states(storeNamed("zustand store")).length > 0, 8000)
    // The last 50 (maxAge), as openstate would have kept them.
    expect(states(storeNamed("zustand store"))).toEqual(Array.from({ length: 50 }, (_, i) => 21 + i))
  }, 10_000)
})

describe("stores React makes twice", () => {
  const reducer = (s = { n: 0 }, a: { type: string }) => (a.type === "inc" ? { n: s.n + 1 } : s)
  const ext = (globalThis as any).__REDUX_DEVTOOLS_EXTENSION__
  const named = (name: string) => bridge.sources.flatMap((s) => s.stores).filter((s) => s.name === name)

  // React 19 keeps the first of the two stores Strict Mode makes.
  test("one shows up at once, and the one thrown away never does", async () => {
    const kept: any = createStore(reducer, ext({ name: "strict 19" }))
    createStore(reducer, ext({ name: "strict 19" }))
    await until(() => named("strict 19").length > 0)
    await sleep(100)
    expect(named("strict 19").map(states)).toEqual([[0]])
    kept.dispatch({ type: "inc" })
    await until(() => states(named("strict 19")[0]).length === 2)
    expect(named("strict 19").map(states)).toEqual([[0, 1]])
  })

  // React 18 renders twice, and keeps a store from the second render.
  test("a later twin that acts takes the place of the one shown", async () => {
    createStore(reducer, ext({ name: "strict 18" }))
    createStore(reducer, ext({ name: "strict 18" }))
    const kept: any = createStore(reducer, ext({ name: "strict 18" }))
    createStore(reducer, ext({ name: "strict 18" }))
    await until(() => named("strict 18").length > 0)
    kept.dispatch({ type: "inc" })
    kept.dispatch({ type: "inc" })
    await until(() => states(named("strict 18")[0]).length === 3)
    await sleep(100)
    expect(named("strict 18").map(states)).toEqual([[0, 1, 2]])
  })

  test("connect() stores too", async () => {
    const shown = ext.connect({ name: "strict zustand" })
    const dropped = ext.connect({ name: "strict zustand" })
    shown.init({ n: 0 })
    dropped.init({ n: 0 })
    await until(() => named("strict zustand").length > 0)
    shown.send({ type: "set" }, { n: 1 })
    await until(() => states(named("strict zustand")[0]).length === 2)
    await sleep(100)
    expect(named("strict zustand").map(states)).toEqual([[0, 1]])
  })

  test("different stores made together all show up", async () => {
    const a = ext.connect()
    const b = ext.connect()
    a.init({ n: 10 })
    b.init({ n: 20 })
    const unnamed = () => bridge.sources.flatMap((s) => s.stores).filter((s) => /^store \d+$/.test(s.name))
    await until(() => unnamed().length === 2)
    expect(unnamed().map(states).sort()).toEqual([[10], [20]])
  })
})

test("connect() stores are labelled with the library that calls connect()", async () => {
  const conn = connectLikeZustand("menuUi")
  conn.init({ open: false })
  await until(() => !!storeNamed("menuUi"))
  expect(storeNamed("menuUi")!.lib).toBe("zustand")
  const own = (globalThis as any).__REDUX_DEVTOOLS_EXTENSION__.connect({ name: "custom", lib: "mine" })
  own.init({})
  await until(() => !!storeNamed("custom"))
  expect(storeNamed("custom")!.lib).toBe("mine")
})

describe("Redux DevTools remote", () => {
  test("a state with cycles arrives as a tree", async () => {
    const ws = new WebSocket(URL)
    await new Promise((r) => (ws.onopen = r))
    const send = (event: string, data?: unknown, cid?: number) => ws.send(JSON.stringify({ event, data, cid }))
    send("#handshake", {}, 1)
    send("login", "master", 2)
    send("log", { type: "START", name: "remote-app" })
    const a: any = { n: 1, shared: { x: 1 } }
    a.self = a
    a.again = a.shared
    const lifted = {
      actionsById: { 0: { type: "PERFORM_ACTION", action: { type: "@@INIT" }, timestamp: 1 } },
      computedStates: [{ state: a }],
      stagedActionIds: [0],
      skippedActionIds: [],
      committedState: a,
      currentStateIndex: 0,
      nextActionId: 1,
      isLocked: false,
      isPaused: false,
    }
    send("log", { type: "STATE", payload: jsan.stringify(lifted, undefined, undefined, true) })
    const st = () => bridge.sources.find((s) => s.name === "remote-app")?.stores[0]
    await until(() => !!st()?.actions.length)
    const state = st()!.actions[0]!.state as any
    expect(state.self).toBe("[Circular]")
    // Shared, not circular: kept as the object it is.
    expect(state.again).toEqual({ x: 1 })
    ws.close()
  })
})

describe("who gets in", () => {
  const page = (origin: string) => new WebSocket(URL, { headers: { Origin: origin } } as any)

  test("a page from elsewhere waits, and one that sends too much reconnects when let in", async () => {
    const ws = page("https://shop.example")
    let closed = 0
    ws.onclose = (e) => (closed = e.code)
    await new Promise((r) => (ws.onopen = r))
    ws.send(JSON.stringify({ t: "hello", v: 1, app: "shop", runtime: "browser", run: "r" }))
    await until(() => bridge.access.origins.some((o) => o.origin === "https://shop.example" && o.access === "pending"))
    expect(bridge.sources.some((s) => s.name === "shop")).toBe(false)
    for (let i = 0; i < 1100; i++) ws.send(JSON.stringify({ t: "action", id: "1", action: { type: "x" }, state: {}, time: 0 }))
    await sleep(200)
    bridge.access.allow("https://shop.example")
    await until(() => closed === 1012)
  })

  test("an app's client version is kept, and an older one is flagged", async () => {
    expect(clientStatus(bridge.sources.find((s) => s.name === "test-app")!)).toBe("ok")
    const ws = new WebSocket(URL)
    await new Promise((r) => (ws.onopen = r))
    ws.send(JSON.stringify({ t: "hello", v: 1, app: "old-app", runtime: "node", run: "r", client: "0.1.2" }))
    await until(() => bridge.sources.some((s) => s.name === "old-app"))
    const old = bridge.sources.find((s) => s.name === "old-app")!
    expect(old.client).toEqual({ version: "0.1.2", protocol: 1 })
    expect(clientStatus(old)).toBe("outdated")
    ws.close()
  })

  test("a sandboxed page is let in for this run only", async () => {
    const ws = page("null")
    await new Promise((r) => (ws.onopen = r))
    await until(() => bridge.access.origins.some((o) => o.origin === "null"))
    bridge.access.allow("null")
    await sleep(50)
    const saved = await Bun.file(`${process.env.XDG_CONFIG_HOME}/openstate/origins`).text()
    expect(saved).toContain("allow https://shop.example")
    expect(saved).not.toContain("allow null")
    ws.close()
  })

  const lanIp = Object.values(networkInterfaces())
    .flat()
    .find((i) => i && i.family === "IPv4" && !i.internal)?.address

  test.if(!!lanIp)("other devices only reach it with lan, and are asked about", async () => {
    const tryLan = () =>
      new Promise<boolean>((r) => {
        const ws = new WebSocket(`ws://${lanIp}:${PORT}`)
        ws.onopen = () => (ws.close(), r(true))
        ws.onerror = () => r(false)
      })
    expect(await tryLan()).toBe(false)
    expect(bridge.listen(PORT, true)).toBeNull()
    expect(await tryLan()).toBe(true)
    await until(() => bridge.access.origins.some((o) => o.origin === `tcp://${lanIp}`))
    expect(bridge.listen(PORT, false)).toBeNull()
  })
})
