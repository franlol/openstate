// Vim-style options: `:set` opens the settings card, `:set name=value` changes one from the command line.
// They are saved to a config file that uses the same syntax, one option per line.
import { homedir } from "node:os"
import { join } from "node:path"
import { themes } from "./theme"

export type Settings = {
  maxage: number
  time: "clock" | "delta"
  flash: boolean
  theme: string
}
export type OptionName = keyof Settings

type Option = {
  name: OptionName
  desc: string
  // What the values mean, shown in the settings card and in `:set name?`.
  help: string
  kind: "number" | "bool" | "enum"
  values?: () => string[]
  // Stops h/l walk through for numbers; typed values only need to be within min..max.
  steps?: number[]
  min?: number
  max?: number
}

export const OPTIONS: Option[] = [
  {
    name: "maxage",
    desc: "actions kept per store",
    help: "older ones drop as new actions arrive",
    kind: "number",
    steps: [50, 100, 200, 500, 1000, 2000, 5000],
    min: 10,
    max: 5000,
  },
  {
    name: "time",
    desc: "time column of the action list",
    help: "clock: 14:39:15 · delta: time since the previous action",
    kind: "enum",
    values: () => ["clock", "delta"],
  },
  { name: "flash", desc: "flash what changes", help: "rows and values light up as actions arrive", kind: "bool" },
  { name: "theme", desc: "colour theme", help: "also :theme, which previews them", kind: "enum", values: () => themes.map((t) => t.id) },
]

export const DEFAULTS: Settings = { maxage: 500, time: "clock", flash: true, theme: themes[0]!.id }

export const CONFIG_PATH = join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "openstate", "config")

export const optionOf = (name: string) => OPTIONS.find((o) => o.name === name)

// Full name or an unambiguous prefix, as vim accepts `:set ma=100`.
function resolve(name: string): Option {
  const exact = optionOf(name)
  if (exact) return exact
  const found = OPTIONS.filter((o) => o.name.startsWith(name))
  if (found.length === 1) return found[0]!
  throw new Error(found.length ? `ambiguous option: ${name} (${found.map((o) => o.name).join(", ")})` : `unknown option: ${name}`)
}

// `maxage=500`, `flash` / `noflash` for on/off options.
export function format(name: OptionName, s: Settings): string {
  const v = s[name]
  if (typeof v === "boolean") return v ? name : `no${name}`
  return `${name}=${v}`
}

// Human value for the settings card.
export function show(name: OptionName, s: Settings): string {
  const v = s[name]
  return typeof v === "boolean" ? (v ? "on" : "off") : String(v)
}

export function parseValue(o: Option, raw: string): Settings[OptionName] {
  if (o.kind === "number") {
    const n = Number(raw)
    if (!Number.isInteger(n) || n < o.min! || n > o.max!) throw new Error(`${o.name} takes a whole number from ${o.min} to ${o.max}`)
    return n
  }
  if (o.kind === "bool") {
    if (["on", "true", "1"].includes(raw)) return true
    if (["off", "false", "0"].includes(raw)) return false
    throw new Error(`${o.name} is on or off: :set ${o.name} / :set no${o.name}`)
  }
  const values = o.values!()
  if (!values.includes(raw)) throw new Error(`${o.name} takes ${values.join(" | ")}`)
  return raw
}

// The next value for h/l and space in the settings card, wrapping round for lists.
export function stepValue(o: Option, s: Settings, dir: 1 | -1): Settings[OptionName] {
  const v = s[o.name]
  if (o.kind === "bool") return !v
  if (o.kind === "number") {
    const steps = o.steps!
    const n = v as number
    const next = dir > 0 ? steps.find((x) => x > n) : [...steps].reverse().find((x) => x < n)
    return next ?? n
  }
  const values = o.values!()
  return values[(values.indexOf(v as string) + dir + values.length) % values.length]!
}

export type SetResult = { changed: Partial<Settings>; shown: string[] }

// One `:set` argument list. Vim forms: name=value, name (on, or show the value), noname, name!, name?, name&.
export function parseSet(args: string[], s: Settings): SetResult {
  const changed: Partial<Settings> = {}
  const shown: string[] = []
  const cur = { ...s }
  const put = <K extends OptionName>(name: K, value: Settings[K]) => ((changed[name] = value), (cur[name] = value))
  for (const arg of args) {
    const eq = /^([a-z]+)\s*[=:]\s*(.*)$/.exec(arg)
    if (eq) {
      const o = resolve(eq[1]!)
      put(o.name, parseValue(o, eq[2]!))
      continue
    }
    const m = /^(no|inv)?([a-z]+)([!?&])?$/.exec(arg)
    if (!m) throw new Error(`invalid argument: ${arg}`)
    const [, prefix, name, suffix] = m
    const o = resolve(name!)
    const neg = prefix === "no"
    const inv = prefix === "inv" || suffix === "!"
    if (suffix === "?") {
      shown.push(format(o.name, cur))
      continue
    }
    if (suffix === "&") {
      put(o.name, DEFAULTS[o.name])
      continue
    }
    if (o.kind !== "bool") {
      if (neg || inv) throw new Error(`${o.name} is not an on/off option: :set ${o.name}=…`)
      shown.push(format(o.name, cur))
      continue
    }
    put(o.name, inv ? !cur[o.name] : !neg)
  }
  return { changed, shown }
}

export async function loadSettings(): Promise<{ settings: Settings; errors: string[] }> {
  const settings = { ...DEFAULTS }
  const errors: string[] = []
  const file = Bun.file(CONFIG_PATH)
  if (!(await file.exists())) return { settings, errors }
  const lines = (await file.text()).split("\n")
  lines.forEach((line, i) => {
    const text = line.replace(/#.*/, "").trim().replace(/^set\s+/, "")
    if (!text) return
    try {
      Object.assign(settings, parseSet(text.split(/\s+/), settings).changed)
    } catch (e) {
      errors.push(`config line ${i + 1}: ${(e as Error).message}`)
    }
  })
  return { settings, errors }
}

// Every option is written, each with what it does, so the file documents itself.
export async function saveSettings(s: Settings): Promise<void> {
  const out = ["# openstate settings · same syntax as :set, one option per line", ""]
  for (const o of OPTIONS) {
    const values = o.kind === "number" ? `${o.min}–${o.max}` : o.kind === "bool" ? "on/off" : o.values!().join(" | ")
    out.push(`# ${o.desc} (${values}, default ${format(o.name, DEFAULTS)})`, format(o.name, s), "")
  }
  await Bun.write(CONFIG_PATH, out.join("\n"))
}
