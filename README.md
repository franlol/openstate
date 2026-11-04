# openstate

A terminal UI to inspect and time-travel application state — Redux DevTools in your terminal, for every app you have
open at once. Built with [OpenTUI](https://opentui.com).

## Run

```bash
bun install
bun run start    # waits for apps on ws://localhost:8000
bun run demo     # three sample apps instead, no app needed
bun run dev      # restarts on save
```

Press `?` for keybindings and `:` for commands (the list shows what each one does). Debug the keymap with
`OPENSTATE_DEBUG=debug.log bun run start`.

## Connect an app

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
those options, 30 by default; `:set maxage` does not reach it), and how soon it reconnects after openstate restarts
(the remote client waits up to 30 s).

### Any other app

Make `openstate/client` the **first import** of the app, before any store library:

```ts
import "openstate/client"
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
import { install } from "openstate/client"
install({ name: "checkout", url: "ws://localhost:8123" }) // or OPENSTATE_URL=ws://localhost:8123 in the environment
```

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
| `maxage` | 10–5000                               | 500         | actions kept per store; older ones drop as new ones arrive |
| `time`   | `clock` \| `delta`                    | `clock`     | time column of the action list: `14:39:15`, or time since the previous action (`+1.20s`) |
| `flash`  | on / off                              | on          | rows and values light up as actions arrive          |
| `port`   | 1024–65535                            | 8000        | where openstate listens; tell the client with `OPENSTATE_URL` or `install({ url })` |
| `theme`  | `openstate` `catppuccin` `tokyonight` `gruvbox` `nord` | `openstate` | colour theme; `:theme` previews them as you move |

Settings live in `~/.config/openstate/config` (or `$XDG_CONFIG_HOME/openstate/config`), one option per line in the same
syntax as `:set`, each with a comment saying what it does. You can edit it by hand; a line openstate cannot read is
reported on startup and the rest still apply.

## Develop

```bash
bun run typecheck
```

The OpenTUI agent skill is not committed; reinstall it with `bunx skills add https://opentui.com --skill opentui`.
