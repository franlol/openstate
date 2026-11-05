import { expect, test } from "bun:test"
import { DEFAULTS, OPTIONS, parseSet, stepValue, type Settings } from "../src/settings"

const set = (line: string, s: Settings = DEFAULTS) => parseSet(line.split(" "), s)

test("vim forms", () => {
  expect(set("maxage=100").changed).toEqual({ maxage: 100 })
  expect(set("ma=100").changed).toEqual({ maxage: 100 })
  expect(set("noflash").changed).toEqual({ flash: false })
  expect(set("flash!").changed).toEqual({ flash: !DEFAULTS.flash })
  expect(set("invlan").changed).toEqual({ lan: true })
  expect(set("maxage&", { ...DEFAULTS, maxage: 10 }).changed).toEqual({ maxage: DEFAULTS.maxage })
  expect(set("maxage?").shown).toEqual([`maxage=${DEFAULTS.maxage}`])
  expect(set("theme").shown).toEqual([`theme=${DEFAULTS.theme}`])
})

test("bad values are refused with the reason", () => {
  expect(() => set("maxage=3")).toThrow(/from 10 to 5000/)
  expect(() => set("port=80")).toThrow(/from 1024 to 65535/)
  expect(() => set("time=sometimes")).toThrow(/clock \| delta/)
  expect(() => set("nomaxage")).toThrow(/not an on\/off option/)
  expect(() => set("zzz")).toThrow(/unknown option/)
})

test("every option has a default and steps within its range", () => {
  for (const o of OPTIONS) {
    expect(DEFAULTS[o.name]).toBeDefined()
    for (const x of o.steps ?? []) expect(x >= o.min! && x <= o.max!).toBe(true)
  }
  const maxage = OPTIONS.find((o) => o.name === "maxage")!
  expect(stepValue(maxage, DEFAULTS, 1)).toBe(1000)
  expect(stepValue(maxage, { ...DEFAULTS, maxage: 5000 }, 1)).toBe(5000)
})
