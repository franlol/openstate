# openstate

A terminal UI to inspect and time-travel application state — Redux DevTools in your terminal, for every app you have
open at once. Built with [OpenTUI](https://opentui.com).

## Run

```bash
npm i -g @openstate-devtools/cli         # or: brew tap openstate-devtools/tap && brew install openstate
                                         # or: curl -fsSL https://raw.githubusercontent.com/franlol/openstate/main/install.sh | sh
openstate                                # waits for apps on ws://localhost:8000
openstate --demo                         # three sample apps instead, no app needed
```

Each installs a single binary with its runtime inside, so neither Bun nor Node is needed to run it. The script puts it in
`~/.local/bin` (`OPENSTATE_INSTALL` picks another folder, `OPENSTATE_VERSION` a version) and adds openstate to the app
launcher, opening in a terminal: a `.desktop` entry on Linux, `~/Applications/openstate.app` for Spotlight on macOS.
`openstate --desktop` adds that entry (after an npm install, say), `openstate --no-desktop` takes it out.

Press `?` for keybindings and `:` for commands (the list shows what each one does).

## Connect an app

### Pages from elsewhere

Any page open in the browser can reach `ws://localhost:8000`, so openstate checks where each connection comes from.
Apps outside a browser and pages on this machine (`localhost`, `127.0.0.1`) come straight in. A page from anywhere
else waits as `? host` in the sources list until you answer with the ✓ or ✗ on its row (shown under the mouse
or the cursor; `enter` and `dd` from the keyboard). Blocked pages stay listed as `✗ host  blocked`: ✓ lets them in after all, ↺ forgets them so they are asked about again. `dd` on a connected app cuts it off; a
page from elsewhere is asked about again if it comes back. The answers are kept in `~/.config/openstate/origins`.
A sandboxed page or a local file (origin `null`, shown as `sandboxed page`) is let in for the current run only.

### Other devices

openstate listens on this machine only. For an app on a phone, a VM or a container, `:set lan` listens on the
network too; each device is asked about by its address (`? 192.168.1.20`), like a page from elsewhere.

### Apps already set up for Redux DevTools remote

openstate speaks the Redux DevTools remote protocol (SocketCluster, the one `remotedev-server` and
`@redux-devtools/cli` use). An app using `@redux-devtools/remote` — the usual setup for Node and React Native — connects
with no changes: start openstate on the port the app sends to (8000 by default, `:set port` otherwise).

```ts
// what such an app already has; nothing to add
import { composeWithDevTools } from "@redux-devtools/remote"
const store = createStore(reducer, composeWithDevTools({ name: "mobile app", realtime: true, port: 8000 })())
```

Everything in the Redux column below works. Two things stay in the app's hands: how many actions it keeps (`maxAge` in
those options, 30 by default; `:set maxage` does not reach it, and the action list shows `30/30` once the app starts
dropping its oldest), and how soon it reconnects after openstate restarts
(the remote client waits up to 30 s).

### Any other app

Add the client to the app:

```bash
npm i -D @openstate-devtools/client
```

Make it the **first import** of the app, before any store library:

```ts
import "@openstate-devtools/client"
```

An app that runs in Node or Bun can load it without a change to its code:

```bash
node --import @openstate-devtools/client server.js
bun --preload @openstate-devtools/client server.ts
```

It stands in for the Redux DevTools browser extension (`window.__REDUX_DEVTOOLS_EXTENSION__`), so these report to
openstate without other changes:

- Redux Toolkit's `configureStore` (`devTools: { name: "cart" }` names the store)
- redux with `window.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__` or `window.__REDUX_DEVTOOLS_EXTENSION__()`
- zustand's `devtools` middleware, jotai-devtools, and anything else using the extension's `connect()`

It must come first because Redux Toolkit looks for the extension when it loads. Outside a browser (Bun, Node) the client
defines `window` as `globalThis` so the libraries find it. The app shows up in the sources panel under its host (browser)
or script name; it reconnects by itself if openstate starts later or restarts.

```ts
import { install } from "@openstate-devtools/client"
install({ name: "checkout", url: "ws://localhost:8123" }) // or OPENSTATE_URL=ws://localhost:8123 in the environment
```

The import only reports in development: in a production build (`NODE_ENV=production`) it does nothing, so visitors'
browsers never try to reach localhost. Calling `install()` yourself reports anyway.

### Next.js

Nothing beyond the above. Put the import at the top of the file that creates the store (the `"use client"` store
provider, or the zustand store module):

```ts
import "@openstate-devtools/client"
import { configureStore } from "@reduxjs/toolkit"
```

While Next renders on the server the import does nothing; the page reports from the browser once it loads, under its
host (`localhost:3000`). If openstate listens on another port, set `NEXT_PUBLIC_OPENSTATE_URL=ws://localhost:8123`:
Next only passes variables named `NEXT_PUBLIC_…` to the browser.

### What works with each kind of store

Redux stores keep their own history, like with the extension, so openstate can ask the app to replay it differently.
zustand and other `connect()` stores only report each new state, so openstate keeps their history and can only send a
state back.

| | Redux | zustand, jotai, `connect()` |
|---|---|---|
| inspect, diff, trace, time-travel the list | ✓ | ✓ |
| dispatch (`D`) | ✓ | ✓ if the store handles devtools actions (zustand: `dispatchFromDevtools`) |
| commit (`c`), revert (`R`), reset, sweep | ✓ | ✓ (revert sends the committed state to the app) |
| import (`:import`) | ✓ | ✓ when the file has states |
| skip (`s`), reorder (`J`/`K`), lock (`!`) | ✓ | — the reducer is not available; openstate says so |

Pausing (`p`) stops openstate recording; the app keeps running, and nothing it already recorded is lost.

## Settings

Options work like vim's. `:set` opens the settings card: `j`/`k` pick an option, `h`/`l` or `space` change it, and the
change is saved at once. From the command line:

| Command             | Does                                               |
| ------------------- | -------------------------------------------------- |
| `:set maxage=200`   | set a value (`:set ma=200` works too: any unambiguous prefix) |
| `:set noflash`      | turn an on/off option off; `:set flash` turns it on |
| `:set flash!`       | toggle an on/off option                            |
| `:set maxage?`      | show the current value                             |
| `:set maxage&`      | back to the default                                |
| `:set noflash time=delta` | several at once                              |

| Option   | Values                                | Default     | What it does                                        |
| -------- | ------------------------------------- | ----------- | --------------------------------------------------- |
| `maxage` | 10–5000                               | 500         | actions kept per store; older ones drop as new ones arrive. The action list shows how full it is (`120/500`) |
| `time`   | `clock` \| `delta`                    | `clock`     | time column of the action list: `14:39:15`, or time since the previous action (`+1.20s`) |
| `flash`  | on / off                              | on          | rows and values light up as actions arrive          |
| `port`   | 1024–65535                            | 8000        | where openstate listens; tell the client with `OPENSTATE_URL` or `install({ url })` |
| `lan`    | on / off                              | off         | also listen on the network, for phones, VMs and containers; each device is asked about |
| `theme`  | `openstate` `catppuccin` `tokyonight` `gruvbox` `nord` | `openstate` | colour theme; `:theme` previews them as you move |
| `updatecheck` | on / off                         | on          | ask npm for a new version on start (see below)      |

Settings live in `~/.config/openstate/config` (or `$XDG_CONFIG_HOME/openstate/config`), one option per line in the same
syntax as `:set`, each with a comment saying what it does. You can edit it by hand; a line openstate cannot read is
reported on startup and the rest still apply.

## Update

On start openstate asks npm for its latest version; a newer one shows as `↑ 0.2.0 · :update` in the statusline.
`:update` (or a click there) shows it, `enter` installs it the way openstate was installed (the package manager that
installed it, or the install script again), and `enter` again restarts into it; connected apps reconnect by themselves. `:set noupdatecheck` stops the
check on start; `:update` still looks when asked. Running from a clone of the repo, update with `git pull`.

## Develop

```bash
bun install
bun run start        # from source; bun run demo with the sample apps, bun run dev restarts on save
bun run typecheck
bun test             # the bridge against real clients, diffs, settings, history files
OPENSTATE_DEBUG=debug.log bun run start      # logs how each key was dispatched
```

`bun run release` builds what a release publishes into `release/`: a binary per platform, as npm packages
(`@openstate-devtools/cli-<os>-<cpu>`, picked by the `@openstate-devtools/cli` launcher) and as archives for GitHub Releases and
`install.sh` (with their `SHA256SUMS`, which `install.sh` checks), plus `@openstate-devtools/client`. It needs OpenTUI's native packages for every platform:
`bun install --os="*" --cpu="*"`.

The OpenTUI agent skill is not committed; reinstall it with `bunx skills add https://opentui.com --skill opentui`.
