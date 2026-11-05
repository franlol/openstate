import { describe, expect, test } from "bun:test"
import { exportHistory, importHistory, splitAction } from "../src/history"
import { PROTOCOL } from "../client/protocol"
import { CLIENT_VERSION } from "../client/version"
import { changeCount, clientStatus, diff, getPath, hostOf, isLocal, jsonLines, since, type Action, type Source, type Store } from "../src/model"

const action = (prev: unknown, state: unknown) => ({ id: 1, prev, state }) as Action

describe("diff", () => {
  test("lists leaf changes by dotted path", () => {
    const before = { cart: { items: [{ qty: 1 }, { qty: 2 }] }, user: "ana" }
    const after = { cart: { items: [{ qty: 1 }, { qty: 3 }] }, user: "ana", open: true }
    expect(diff(before, after)).toEqual([
      { path: "cart.items.1.qty", before: 2, after: 3 },
      { path: "open", before: undefined, after: true },
    ])
    expect(changeCount(action(before, after))).toBe(2)
  })

  test("a shared subtree costs nothing", () => {
    const shared = { big: Array.from({ length: 1000 }, (_, i) => i) }
    expect(diff({ shared, n: 1 }, { shared, n: 2 })).toHaveLength(1)
  })

  test("a whole array swapped for an object is one change", () => {
    expect(diff({ a: [1] }, { a: { 0: 1 } })).toEqual([{ path: "a", before: [1], after: { 0: 1 } }])
  })

  test("wide states do not overflow the stack", () => {
    const wide = (v: number) => Object.fromEntries(Array.from({ length: 200_000 }, (_, i) => [`k${i}`, v]))
    expect(diff(wide(1), wide(2))).toHaveLength(200_000)
  })
})

test("getPath walks dotted paths", () => {
  expect(getPath({ a: { b: [10, 20] } }, "a.b.1")).toBe(20)
  expect(getPath({ a: 1 }, "a.b.c")).toBeUndefined()
})

test("jsonLines matches JSON.stringify", () => {
  const value = { a: [1, { b: "x" }], c: {}, d: [], e: null, f: undefined }
  expect(jsonLines(value).map((l) => l.text).join("\n")).toBe(JSON.stringify(value, null, 2))
})

test("since keeps eight columns", () => {
  for (const ms of [120, 12_300, 125_000, 4_000_000]) expect(since(ms)).toHaveLength(8)
})

describe("origins", () => {
  test("local pages are told apart from the rest", () => {
    expect(isLocal("http://localhost:3000")).toBe(true)
    expect(isLocal("http://127.0.0.1")).toBe(true)
    expect(isLocal("http://[::1]:5173")).toBe(true)
    expect(isLocal("http://localhost.evil.com")).toBe(false)
    expect(isLocal("null")).toBe(false)
  })
  test("hosts are shown without the scheme", () => {
    expect(hostOf("https://shop.dev")).toBe("shop.dev")
    expect(hostOf("tcp://192.168.1.20")).toBe("192.168.1.20")
    expect(hostOf("null")).toBe("sandboxed page")
  })
})

describe("history files", () => {
  test("splitAction keeps toolkit payloads and plain fields", () => {
    expect(splitAction({ type: "a", payload: 1 })).toEqual({ type: "a", payload: 1 })
    expect(splitAction({ type: "b", id: 2 })).toEqual({ type: "b", payload: { id: 2 } })
    expect(splitAction({ type: "c" })).toEqual({ type: "c", payload: undefined })
  })

  test("export and import round-trip", () => {
    const states = [{ n: 0 }, { n: 1 }, { n: 2 }]
    const store = {
      locked: false,
      actions: states.map((state, i) => ({
        type: i ? "inc" : "@@INIT",
        payload: i === 2 ? { by: 1 } : undefined,
        time: 1000 + i,
        trace: ["at app.ts:1"],
        skipped: i === 1,
        state,
      })),
    } as unknown as Store
    const back = importHistory(exportHistory(store))
    expect(back.hasStates).toBe(true)
    expect(back.actions.map((a) => [a.type, a.payload, a.state, a.skipped])).toEqual([
      ["@@INIT", undefined, { n: 0 }, false],
      ["inc", undefined, { n: 1 }, true],
      ["inc", { by: 1 }, { n: 2 }, false],
    ])
  })

  test("import says what is wrong", () => {
    expect(() => importHistory("{")).toThrow(/not JSON/)
    expect(() => importHistory("{}")).toThrow(/no actionsById/)
    expect(() => importHistory(JSON.stringify({ actionsById: { 0: { action: {} } } }))).toThrow(/has no type/)
  })
})

describe("client versions", () => {
  const src = (client?: Source["client"]) => ({ client }) as Source
  test("older clients and those that do not say are outdated; another protocol is incompatible", () => {
    expect(clientStatus(src({ version: CLIENT_VERSION, protocol: PROTOCOL }))).toBe("ok")
    expect(clientStatus(src({ version: "0.0.1", protocol: PROTOCOL }))).toBe("outdated")
    expect(clientStatus(src({ version: null, protocol: PROTOCOL }))).toBe("outdated")
    expect(clientStatus(src({ version: CLIENT_VERSION, protocol: PROTOCOL + 1 }))).toBe("incompatible")
    // Redux DevTools remote apps have no client of ours.
    expect(clientStatus(src())).toBe("ok")
  })
})
