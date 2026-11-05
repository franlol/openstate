# openstate

Terminal UI for inspecting and time-travelling app state (Redux DevTools compatible), built with OpenTUI + React on Bun.
Apps connect through `client/` (a stand-in for the Redux DevTools extension) to the WebSocket server in `src/bridge.ts`;
`--demo` runs the fake apps in `src/mock.ts` instead.

## Commands

- `bun run dev` / `bun run start` — run the TUI; `bun run demo` with fake apps. `start`, `demo` and the `openstate`
  command run React's production build (`NODE_ENV=production`, set before Bun starts: it decides how JSX compiles);
  `dev` keeps the development build, several times slower
- `bun run typecheck` and `bun test` — must pass before finishing a change. `test/setup.ts` points the config at a
  temporary folder; `test/bridge.test.ts` runs the real client against the bridge
- `bun run build` — compiles `@openstate-devtools/client` to `dist/client` (JS + types) for bundlers such as Next, which do not
  compile TypeScript from `node_modules`; Bun imports `client/index.ts` directly. `--env disable` keeps
  `process.env.NODE_ENV` for the app's bundler to replace instead of Bun's own value
- `OPENSTATE_DEBUG=debug.log bun run start` — logs keymap warnings/errors and how each key was dispatched
- `bun run release` — `scripts/release.ts` builds `release/`: a `bun build --compile` binary per platform as npm
  packages (`@openstate-devtools/cli-<os>-<cpu>`, run by the `npm/cli/openstate.js` launcher of `@openstate-devtools/cli`), the same
  binaries as archives for GitHub Releases and `install.sh`, and `@openstate-devtools/client`. Publishes nothing
- Releasing: bump `version` in package.json, and `CLIENT_VERSION` in `client/version.ts` too when `client/` changed
  (the release fails otherwise; an unchanged client is not republished, so apps need not update), commit, push a tag `vX.Y.Z`. `.github/workflows/release.yml` publishes to
  GitHub Releases, npm (trusted publishing) and the Homebrew tap (`openstate-devtools/homebrew-tap`, deploy key in the
  `TAP_DEPLOY_KEY` secret). `ci.yml` runs typecheck and tests on every push

Use Bun for everything (`bun`, `bunx`, `bun test`, `Bun.serve` for servers with built-in `WebSocket`).

## Layout

- `src/main.tsx` — renderer, keymap setup (ex commands, leader `g`), React root
- `src/state.ts` — `AppState`: single mutable store; UI subscribes via `useApp()`, mutations call `emit()`
- `src/model.ts` — data types, structural diff, tree flattening, and `StoreConn`: the commands openstate sends to an
  app (dispatch, skip, commit, revert, sweep, lock). The app owns history and recomputes states, as in Redux DevTools
- `src/history.ts` — `:export` / `:import` in Redux DevTools' file format (lifted state inside `payload`)
- `src/bridge.ts` — WebSocket server (`:set port`). Speaks @openstate-devtools/client's protocol and Redux DevTools remote
  (SocketCluster frames, jsan payloads), told apart by the first frame. Redux stores mirror the app's lifted state and send lifted actions back;
  `connect()` stores (zustand…) keep their history here and throw for what needs a reducer (skip, reorder, lock).
  Pages from another origin are held until allowed (`Access` in `src/model.ts`, saved to the `origins` file)
- `client/` — `@openstate-devtools/client`: installs `__REDUX_DEVTOOLS_EXTENSION__`/`_COMPOSE__`, built on `@redux-devtools/instrument`;
  `client/protocol.ts` holds the messages both sides speak (`PROTOCOL` is their version). The client batches
  messages every 50 ms, and a client too far behind sends each store's init again instead
- `src/mock.ts` — fake apps with deterministic reducers implementing `StoreConn`; the real bridge must match it
- `src/settings.ts` — `:set` options (definitions, vim-style parser, config file at `~/.config/openstate/config`).
  A new option needs its entry in `OPTIONS`, `Settings` and `DEFAULTS`; the card, completion and file follow
- `src/update.ts` — `:update`: latest version from npm (`npm_config_registry` points it at a local fake), the install
  command from where the binary is installed (a package manager, or install.sh again; none when run from source), and
  the install's progress; `src/main.tsx` restarts into the new version
- `src/desktop.ts` — `--desktop` / `--no-desktop`: the app launcher entry (Linux `.desktop`, macOS `.app`), with
  `assets/icon-512.png` embedded in the binary (`assets/icon.svg` is the source)
- `src/theme.ts` — theme tokens; never hardcode colours in components
- `src/ui/keys.ts` — every keybinding, also feeds the help overlay and status hints
- `src/ui/kit.tsx` — `Line`/`Part` rendering helpers (`fit`, `spread`), syntax styles
- `src/ui/*.tsx` — Header/Track (top), panels, inspector, statusline + command line (`Bottom`), dispatch card, overlays

## Conventions

- Use OpenTUI components (`scrollbox`, `tab-select`, `select`, `input`, `code`, `diff`, `ascii-font`) before hand-rolling.
  Docs live in the opentui skill (`.claude/skills/opentui`, reinstall with `bunx skills add https://opentui.com --skill opentui`).
- Keys go through `@opentui/keymap` layers, gated by mode with `reactiveMatcherFromStore`. Vim-style sequences use the
  `<g>` leader (plain `gt` parses as the `>` key, `G` as `g`; write `shift+g`).
- Terminal-dense layout: no gaps between panels, no decorative padding.
- Bridge changes need a real app: a script that imports `client/index.ts` first and uses redux / zustand, pointed at
  openstate with `OPENSTATE_URL`. Closing tmux ends openstate too
  (any way the renderer is destroyed exits the process, `src/main.tsx`).
- Verify UI changes by running the app in tmux (`tmux new-session -d -s os -x 120 -y 30 "bun src/main.tsx"`, then
  `send-keys` and `capture-pane -p`). Mouse can be simulated with SGR sequences, e.g. `send-keys -l $'\e[<0;10;5M'`.
