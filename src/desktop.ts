// `openstate --desktop`: an entry in the system's app launcher (Spotlight, GNOME, KDE, rofi…) that opens openstate in
// a terminal; `--no-desktop` takes it out. install.sh adds it; with npm it is one command away.
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import icon from "../assets/icon-512.png" with { type: "file" }
import { COMPILED } from "./update"

const home = homedir()
const dataHome = process.env.XDG_DATA_HOME || join(home, ".local", "share")
const LINUX = {
  entry: join(dataHome, "applications", "openstate.desktop"),
  icon: join(dataHome, "icons", "hicolor", "512x512", "apps", "openstate.png"),
}
const MAC_APP = join(home, "Applications", "openstate.app")

// The binary itself, so the entry works whatever PATH the launcher starts with; from source, the command. Homebrew's
// Cellar path changes with every version, so its bin link instead.
const command = () => {
  if (!COMPILED) return "openstate"
  const [prefix, cellar] = process.execPath.split("/Cellar/")
  return cellar ? `${prefix}/bin/openstate` : process.execPath
}

export async function addDesktopEntry(): Promise<string> {
  const png = await Bun.file(icon).bytes()
  if (process.platform === "darwin") return addMacApp(png)
  if (process.platform !== "linux") throw new Error(`no launcher entry for ${process.platform}`)
  mkdirSync(join(LINUX.icon, ".."), { recursive: true })
  mkdirSync(join(LINUX.entry, ".."), { recursive: true })
  writeFileSync(LINUX.icon, png)
  writeFileSync(
    LINUX.entry,
    [
      "[Desktop Entry]",
      "Type=Application",
      "Name=openstate",
      "Comment=Redux DevTools, in your terminal",
      `Exec=${command()}`,
      // The launcher opens it in the default terminal.
      "Terminal=true",
      "Icon=openstate",
      "Categories=Development;Debugger;",
      "Keywords=redux;state;devtools;",
      "",
    ].join("\n"),
  )
  return LINUX.entry
}

// Spotlight lists apps, so a small one whose only job is to open Terminal running openstate.
async function addMacApp(png: Uint8Array): Promise<string> {
  const contents = join(MAC_APP, "Contents")
  rmSync(MAC_APP, { recursive: true, force: true })
  mkdirSync(join(contents, "MacOS"), { recursive: true })
  mkdirSync(join(contents, "Resources"), { recursive: true })
  writeFileSync(
    join(contents, "Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>openstate</string>
  <key>CFBundleIdentifier</key><string>dev.openstate.launcher</string>
  <key>CFBundleExecutable</key><string>openstate</string>
  <key>CFBundleIconFile</key><string>openstate</string>
  <key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>
`,
  )
  const launcher = join(contents, "MacOS", "openstate")
  writeFileSync(
    launcher,
    `#!/bin/sh\nosascript -e 'tell application "Terminal" to do script "${command()}"' -e 'tell application "Terminal" to activate'\n`,
  )
  Bun.spawnSync(["chmod", "+x", launcher])
  // The icon, through the tools every Mac has; without them the app keeps the generic one.
  const set = join(contents, "Resources", "openstate.iconset")
  mkdirSync(set)
  const base = join(set, "icon_512x512.png")
  writeFileSync(base, png)
  for (const size of [16, 32, 128, 256]) {
    Bun.spawnSync(["sips", "-z", String(size), String(size), base, "--out", join(set, `icon_${size}x${size}.png`)])
    Bun.spawnSync(["sips", "-z", String(size * 2), String(size * 2), base, "--out", join(set, `icon_${size}x${size}@2x.png`)])
  }
  Bun.spawnSync(["iconutil", "-c", "icns", set, "-o", join(contents, "Resources", "openstate.icns")])
  rmSync(set, { recursive: true, force: true })
  return MAC_APP
}

export function removeDesktopEntry(): void {
  if (process.platform === "darwin") return rmSync(MAC_APP, { recursive: true, force: true })
  rmSync(LINUX.entry, { force: true })
  rmSync(LINUX.icon, { force: true })
}
