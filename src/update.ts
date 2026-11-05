// New versions: npm says which is the latest, the package manager that installed openstate updates it.
import { realpathSync } from "node:fs"
import pkg from "../package.json" with { type: "json" }

export const VERSION: string = pkg.version
// The package openstate is installed from; the repository's own package.json is only for working on it.
export const PACKAGE = "@openstate-devtools/cli"
export const INSTALL_SCRIPT = "https://raw.githubusercontent.com/franlol/openstate/main/install.sh"
// A `bun build --compile` binary, as published; its own code lives in Bun's embedded file system.
export const COMPILED = import.meta.dir.includes("$bunfs") || import.meta.dir.includes("~BUN")

// npm's own variable, so a mirror or a local registry works as it does for npm.
const REGISTRY = (process.env.npm_config_registry || "https://registry.npmjs.org").replace(/\/$/, "")

// The repository a package comes from, so a package of the same name from someone else is never offered.
const repoOf = (p: { repository?: unknown }) => {
  const r = p.repository
  const url = typeof r === "string" ? r : (r as { url?: unknown } | undefined)?.url
  return typeof url === "string" ? url.replace(/^git\+/, "").replace(/\.git$/, "") : null
}

// The latest published version, or null offline, unpublished or slow: the check must never be in the way.
export async function latestVersion(): Promise<string | null> {
  try {
    const res = await fetch(`${REGISTRY}/${PACKAGE}/latest`, { signal: AbortSignal.timeout(3000) })
    if (!res.ok) return null
    const latest = (await res.json()) as { version?: unknown; repository?: unknown }
    if (repoOf(latest) !== repoOf(pkg)) return null
    return typeof latest.version === "string" ? latest.version : null
  } catch {
    return null
  }
}

// What a release brings: the bullet points of its GitHub release, markdown stripped. Empty when there are none.
export async function releaseNotes(version: string): Promise<string[]> {
  const repo = repoOf(pkg)?.replace(/^https:\/\/github\.com\//, "")
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases/tags/v${version}`, { signal: AbortSignal.timeout(3000) })
    if (!res.ok) return []
    const body = ((await res.json()) as { body?: unknown }).body
    if (typeof body !== "string") return []
    return body
      .split("\n")
      .filter((l) => /^\s*[-*] /.test(l))
      .map((l) => l.replace(/^\s*[-*] /, "").replace(/\*\*|__|`/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").trim())
  } catch {
    return []
  }
}

// Whether version a comes after b; pre-release tags are ignored.
export function newer(a: string, b: string): boolean {
  const pa = a.split(/[.-]/).map(Number)
  const pb = b.split(/[.-]/).map(Number)
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0)
  return false
}

// The command that updates this copy, from where its binary is installed: by a package manager (inside
// node_modules), by Homebrew (its Cellar) or by the install script. Null when it runs from a checkout of the repo.
export function updateCommand(): string[] | null {
  if (!COMPILED) return null
  let path = process.execPath
  try {
    path = realpathSync(path)
  } catch {}
  const spec = `${PACKAGE}@latest`
  // Homebrew reads taps only once a day by itself, so it would not see the new version yet.
  if (path.includes("/Cellar/")) return ["sh", "-c", "brew update --quiet && brew upgrade openstate"]
  if (!path.includes("node_modules")) return ["sh", "-c", `curl -fsSL ${INSTALL_SCRIPT} | sh`]
  if (path.includes(".bun")) return ["bun", "add", "-g", spec]
  if (path.includes("pnpm")) return ["pnpm", "add", "-g", spec]
  return ["npm", "install", "-g", spec]
}

// The version the installed binary reports, which a restart would run; null from source or when it cannot say.
// A package manager may finish without error and without installing anything.
export function installedVersion(): string | null {
  if (!COMPILED) return null
  try {
    const out = Bun.spawnSync([binaryPath(), "--version"], { timeout: 5000 }).stdout.toString()
    return out.match(/\d+\.\d+\.\d+/)?.[0] ?? null
  } catch {
    return null
  }
}

// The same command again, for the restart after an update: a binary is its own runtime, so its first argument is
// the embedded script and is left out.
export function sameCommand(): string[] {
  return [COMPILED ? binaryPath() : process.execPath, ...process.argv.slice(COMPILED ? 2 : 1)]
}

// This binary, by a path that outlives an update: Homebrew installs each version in its own Cellar folder and keeps
// the old one, so its bin link instead, which points at the newest.
export function binaryPath(exec = process.execPath): string {
  const [prefix, cellar] = exec.split("/Cellar/")
  return cellar ? `${prefix}/bin/openstate` : exec
}

// Package managers say what they are doing but not how far along they are, so the bar moves by stage and creeps
// within each one; it only fills when the install has finished.
const STAGES: [RegExp, number, string][] = [
  [/resolv|fetch|http/i, 0.25, "resolving"],
  [/download|extract|tarball/i, 0.55, "downloading"],
  [/link|install|added|saved|bin/i, 0.8, "installing"],
]

export type Progress = { value: number; stage: string }

export async function runUpdate(cmd: string[], onProgress: (p: Progress) => void): Promise<{ ok: boolean; output: string }> {
  const p: Progress = { value: 0.05, stage: "starting" }
  onProgress(p)
  let floor = 0.05
  let ceil = 0.25
  const creep = setInterval(() => {
    p.value += (ceil - p.value) * 0.08
    onProgress(p)
  }, 120)
  let output = ""
  const read = async (stream: ReadableStream<Uint8Array>) => {
    const decoder = new TextDecoder()
    for await (const bytes of stream) {
      const chunk = decoder.decode(bytes, { stream: true })
      output += chunk
      for (const [re, at, stage] of STAGES)
        if (re.test(chunk) && at > floor) {
          floor = at
          ceil = Math.min(0.95, at + 0.2)
          p.value = Math.max(p.value, at)
          p.stage = stage
        }
    }
  }
  try {
    const proc = Bun.spawn(cmd, { stdin: "ignore", stdout: "pipe", stderr: "pipe" })
    await Promise.all([read(proc.stdout), read(proc.stderr)])
    const ok = (await proc.exited) === 0
    if (ok) Object.assign(p, { value: 1, stage: "installed" })
    onProgress(p)
    return { ok, output: output.trim() }
  } catch (e) {
    return { ok: false, output: (e as Error).message }
  } finally {
    clearInterval(creep)
  }
}
