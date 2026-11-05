#!/usr/bin/env -S NODE_ENV=production bun
import { createClipboard, createCliRenderer, createHostClipboard, createRendererClipboardAdapter } from "@opentui/core"
import { registerEscapeClearsPendingSequence, registerExCommands, registerLeader } from "@opentui/keymap/addons"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { KeymapProvider } from "@opentui/keymap/react"
import { createRoot } from "@opentui/react"
import { loadSettings } from "./settings"
import { AppState, commands } from "./state"
import { sameCommand, VERSION } from "./update"
import { App, AppContext } from "./ui/App"

// Before the terminal is taken over, so scripts (install.sh) can ask without opening the UI.
if (process.argv.includes("--version") || process.argv.includes("-v")) {
  console.log(`openstate ${VERSION}`)
  process.exit(0)
}
if (process.argv.includes("--desktop")) {
  const { addDesktopEntry } = await import("./desktop")
  await addDesktopEntry().then(
    (at) => console.log(`openstate is in your app launcher (${at})`),
    (e) => (console.error(`openstate: ${(e as Error).message}`), process.exit(1)),
  )
  process.exit(0)
}
if (process.argv.includes("--no-desktop")) {
  const { removeDesktopEntry } = await import("./desktop")
  removeDesktopEntry()
  console.log("openstate is out of your app launcher")
  process.exit(0)
}

const renderer = await createCliRenderer({ exitOnCtrlC: true, targetFps: 60 })
const keymap = createDefaultOpenTuiKeymap(renderer)
registerExCommands(keymap)
registerEscapeClearsPendingSequence(keymap)
// `g` prefixes vim-style sequences (gt, gT, gg); plain "gt" would parse as the ">" key.
registerLeader(keymap, { trigger: "g", name: "g" })

// OPENSTATE_DEBUG=<file> logs keymap diagnostics and key dispatch results.
const debugFile = process.env.OPENSTATE_DEBUG
if (debugFile) {
  const { appendFileSync } = await import("node:fs")
  const log = (x: unknown) => appendFileSync(debugFile, JSON.stringify(x) + "\n")
  keymap.on("warning", (w) => log({ warning: w }))
  keymap.on("error", (e) => log({ error: String((e as { message?: string }).message ?? e) }))
  keymap.intercept("key:after", (ctx) => log({ key: ctx.event.name, reason: ctx.reason, handled: ctx.handled }))
}

const { settings, errors } = await loadSettings()
// --demo runs fake apps instead of listening for real ones.
const state = new AppState(settings, process.argv.includes("--demo"))
state.configErrors = errors
// Host clipboard when local, OSC 52 through the terminal otherwise (e.g. over SSH).
const clipboard = createClipboard({ host: createHostClipboard(), terminal: createRendererClipboardAdapter(renderer) })
state.copyText = async (text) => {
  const r = await clipboard.writeText(text, { destination: "best-available" })
  return [r.host, r.terminal].some((x) => x?.status === "written")
}
// q, Ctrl+C, a closed terminal and SIGTERM all destroy the renderer; the WebSocket server would keep the
// process alive without a screen, so exit once the terminal is restored.
state.onQuit = () => renderer.destroy()
// After an update: the same command again, now running the installed version, in this terminal.
let restart = false
state.onRestart = () => ((restart = true), renderer.destroy())
renderer.once("destroy", () => {
  renderer.closed.finally(async () => {
    if (!restart) process.exit(0)
    const next = Bun.spawn(sameCommand(), { stdio: ["inherit", "inherit", "inherit"] })
    process.exit(await next.exited)
  })
})
if (state.settings.updatecheck && !state.demo) void state.checkUpdate()

// Every palette command is also an ex command, so `:theme nord` resolves through the keymap.
keymap.registerLayer({
  commands: commands.map((c) => ({
    name: c.name,
    namespace: "excommands",
    nargs: "*",
    desc: c.desc,
    run({ payload }: { payload: { args: readonly string[] } }) {
      c.run(state, payload.args.join(" "))
      state.emit()
    },
  })),
})

createRoot(renderer).render(
  <KeymapProvider keymap={keymap}>
    <AppContext.Provider value={state}>
      <App />
    </AppContext.Provider>
  </KeymapProvider>,
)
