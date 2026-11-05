import { expect, test } from "bun:test"
import { toJSON } from "../client/protocol"

test("React elements and contexts are named instead of walked, as they reach the whole app", () => {
  function Card() {}
  const element = (type: unknown) => ({ $$typeof: Symbol.for("react.transitional.element"), type, props: {}, _owner: { huge: true } })
  expect(JSON.parse(toJSON({ a: element("div"), b: element(Card), c: { $$typeof: Symbol.for("react.context") } }))).toEqual({
    a: "<div />",
    b: "<Card />",
    c: "[react.context]",
  })
})

test("functions, cycles and bigints still come out as text", () => {
  const v: any = { f: function add() {}, n: 1n }
  v.self = v
  expect(JSON.parse(toJSON(v))).toEqual({ f: "[Function add]", n: "1n", self: "[Circular]" })
})
