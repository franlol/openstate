// Builds everything a release publishes into release/:
//   npm/cli-<os>-<cpu>/      one package per platform, holding the compiled binary
//   npm/cli/                 @openstate-devtools/cli, the launcher that picks the binary for the machine
//   npm/client/              @openstate-devtools/client, compiled for bundlers and Node
//   openstate-<os>-<cpu>.tar.gz   the same binaries for GitHub Releases and install.sh
//   SHA256SUMS               their checksums, which install.sh checks
//   openstate.rb             the Homebrew formula for those archives, for Formula/ in openstate-devtools/homebrew-tap
// Run with `bun run release`; it publishes nothing. The native OpenTUI packages for every target must be installed:
// `bun install --os="*" --cpu="*"`.
import { $ } from "bun"
import { createHash } from "node:crypto"
import { chmodSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import root from "../package.json" with { type: "json" }

const OUT = "release"
const version = root.version
const repository = root.repository
const common = { version, license: root.license, repository, homepage: root.homepage }

// npm names platforms as Node does (process.platform, process.arch); Bun's targets say windows.
const TARGETS = [
  { os: "linux", cpu: "x64", bun: "bun-linux-x64" },
  { os: "linux", cpu: "arm64", bun: "bun-linux-arm64" },
  { os: "darwin", cpu: "x64", bun: "bun-darwin-x64" },
  { os: "darwin", cpu: "arm64", bun: "bun-darwin-arm64" },
  { os: "win32", cpu: "x64", bun: "bun-windows-x64" },
] as const

if (process.env.NODE_ENV !== "production") throw new Error("run with NODE_ENV=production (bun run release): it decides how JSX compiles")

const json = (path: string, data: unknown) => writeFileSync(path, JSON.stringify(data, null, 2) + "\n")

rmSync(OUT, { recursive: true, force: true })
mkdirSync(join(OUT, "npm"), { recursive: true })

for (const t of TARGETS) {
  const name = `cli-${t.os}-${t.cpu}`
  const dir = join(OUT, "npm", name)
  const exe = t.os === "win32" ? "openstate.exe" : "openstate"
  mkdirSync(join(dir, "bin"), { recursive: true })
  const built = await Bun.build({
    entrypoints: ["src/main.tsx"],
    compile: { target: t.bun, outfile: join(dir, "bin", exe) },
    minify: true,
    define: {
      "process.env.NODE_ENV": JSON.stringify("production"),
      // Only the glibc native library goes in; without this both libc branches stay and need their packages.
      ...(t.os === "linux" ? { "process.env.OPENTUI_LIBC": JSON.stringify("glibc") } : {}),
    },
  })
  if (!built.success) throw new AggregateError(built.logs, `build for ${name} failed`)
  chmodSync(join(dir, "bin", exe), 0o755)
  json(join(dir, "package.json"), {
    name: `@openstate-devtools/${name}`,
    ...common,
    description: `openstate for ${t.os} ${t.cpu}`,
    os: [t.os],
    cpu: [t.cpu],
    files: ["bin"],
  })
  await $`tar -czf ${join(OUT, `openstate-${t.os}-${t.cpu}.tar.gz`)} -C ${join(dir, "bin")} ${exe}`
  console.log(`built ${name}`)
}

// In sha256sum's format, so `sha256sum -c` reads it too.
const archives = TARGETS.map((t) => `openstate-${t.os}-${t.cpu}.tar.gz`)
const sums = archives.map((f) => `${createHash("sha256").update(readFileSync(join(OUT, f))).digest("hex")}  ${f}`)
writeFileSync(join(OUT, "SHA256SUMS"), sums.join("\n") + "\n")

// Homebrew installs the binary as it is; Formula/openstate.rb in the tap.
const sumOf = (os: string, cpu: string) => sums[archives.indexOf(`openstate-${os}-${cpu}.tar.gz`)]!.split(" ")[0]
const bottle = (os: string, cpu: string) => `      url "${repository.url.replace(/^git\+/, "").replace(/\.git$/, "")}/releases/download/v${version}/openstate-${os}-${cpu}.tar.gz"
      sha256 "${sumOf(os, cpu)}"`
writeFileSync(
  join(OUT, "openstate.rb"),
  `class Openstate < Formula
  desc "${root.description.replace(/^An? (.)/, (_, c) => c.toUpperCase())}"
  homepage "${root.homepage}"
  version "${version}"
  license "${root.license}"

  on_macos do
    on_arm do
${bottle("darwin", "arm64")}
    end
    on_intel do
${bottle("darwin", "x64")}
    end
  end

  on_linux do
    on_arm do
${bottle("linux", "arm64")}
    end
    on_intel do
${bottle("linux", "x64")}
    end
  end

  def install
    bin.install "openstate"
  end

  def caveats
    "To open openstate from Spotlight or the app launcher: openstate --desktop"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/openstate --version")
  end
end
`,
)

// The launcher: every platform package is optional, so npm installs only the one that fits.
const cli = join(OUT, "npm", "cli")
mkdirSync(cli, { recursive: true })
cpSync("npm/cli/openstate.js", join(cli, "openstate.js"))
cpSync("README.md", join(cli, "README.md"))
cpSync("LICENSE", join(cli, "LICENSE"))
json(join(cli, "package.json"), {
  name: "@openstate-devtools/cli",
  ...common,
  description: root.description,
  type: "module",
  bin: { openstate: "openstate.js" },
  files: ["openstate.js"],
  optionalDependencies: Object.fromEntries(TARGETS.map((t) => [`@openstate-devtools/cli-${t.os}-${t.cpu}`, version])),
})

// The client: plain JS and types, for bundlers, Node's --import and Bun's --preload alike.
const client = join(OUT, "npm", "client")
await $`bun build client/index.ts --outdir ${join(client, "dist")} --packages external --env disable`
await $`bunx tsc -p tsconfig.client.json --outDir ${join(client, "dist")}`
cpSync("LICENSE", join(client, "LICENSE"))
json(join(client, "package.json"), {
  name: "@openstate-devtools/client",
  ...common,
  description: "Connects an app's Redux, zustand or jotai stores to openstate",
  type: "module",
  exports: { ".": { types: "./dist/index.d.ts", default: "./dist/index.js" } },
  files: ["dist"],
  dependencies: { "@redux-devtools/instrument": root.dependencies["@redux-devtools/instrument"] },
  peerDependencies: root.peerDependencies,
  peerDependenciesMeta: root.peerDependenciesMeta,
})

console.log(`\nrelease/ is ready for ${version}. To publish:
  for d in release/npm/cli-*; do npm publish --access public "$d"; done
  npm publish --access public release/npm/cli
  npm publish --access public release/npm/client
  gh release create v${version} release/*.tar.gz release/SHA256SUMS`)
