#!/usr/bin/env node
// `openstate` as installed by npm: runs the binary for this machine, which npm installed as the matching
// @openstate/cli-<os>-<cpu> optional dependency. The binary carries its own runtime, so this is all Node does.
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const name = `@openstate/cli-${process.platform}-${process.arch}`
const exe = process.platform === "win32" ? "openstate.exe" : "openstate"

let bin
try {
  bin = require.resolve(`${name}/bin/${exe}`)
} catch {
  console.error(`openstate: no build for ${process.platform}-${process.arch} (${name} is not installed).`)
  console.error("Reinstall without --no-optional, or get a binary from https://github.com/franlol/openstate/releases")
  process.exit(1)
}

// The terminal goes straight to the binary; ctrl+c is its to handle, not ours.
process.on("SIGINT", () => {})
const run = spawnSync(bin, process.argv.slice(2), { stdio: "inherit" })
if (run.error) {
  console.error(`openstate: ${run.error.message}`)
  process.exit(1)
}
process.exit(run.status ?? 1)
