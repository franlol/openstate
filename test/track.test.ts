import { expect, test } from "bun:test"
import { columns } from "../src/ui/Top"

const kinds = (cols: ReturnType<typeof columns>) => cols.map((c) => (c.gap ? "╌" : String(c.from))).join(" ")

test("short pauses keep a cell per second, long ones take three cells whatever they last", () => {
  expect(kinds(columns([10, 10, 13]))).toBe("10 11 12 13")
  expect(kinds(columns([10, 20, 21]))).toBe("10 ╌ ╌ ╌ 20 21")
  // The track ends at the last action, however long ago.
  expect(kinds(columns([10]))).toBe("10")
  expect(columns([10, 20])[1]).toEqual({ from: 11, to: 19, gap: true })
})
