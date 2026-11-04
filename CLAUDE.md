# openstate

Terminal UI for inspecting and time-travelling app state (Redux DevTools compatible), built with OpenTUI + React on Bun.
Apps connect through `client/` (a stand-in for the Redux DevTools extension) to the WebSocket server in `src/bridge.ts`;
`--demo` runs the fake apps in `src/mock.ts` instead.

## Commands

- `bun run dev` / `bun run start` — run the TUI; `bun run demo` with fake apps
- `bun run typecheck` — must pass before finishing a change
- `OPENSTATE_DEBUG=debug.log bun run start` — logs keymap warnings/errors and how each key was dispatched

Use Bun for everything (`bun`, `bunx`, `bun test`, `Bun.serve` for servers with built-in `WebSocket`).

## Layout

- `src/main.tsx` — renderer, keymap setup (ex commands, leader `g`), React root
- `src/state.ts` — `AppState`: single mutable store; UI subscribes via `useApp()`, mutations call `emit()`
- `src/model.ts` — data types, structural diff, tree flattening, and `StoreConn`: the commands openstate sends to an
  app (dispatch, skip, commit, revert, sweep, lock). The app owns history and recomputes states, as in Redux DevTools
- `src/history.ts` — `:export` / `:import` in Redux DevTools' file format (lifted state inside `payload`)
- `src/bridge.ts` — WebSocket server (`:set port`). Redux stores mirror the app's lifted state and send lifted actions back;
  `connect()` stores (zustand…) keep their history here and throw for what needs a reducer (skip, reorder, lock)
- `client/` — `openstate/client`: installs `__REDUX_DEVTOOLS_EXTENSION__`/`_COMPOSE__`, built on `@redux-devtools/instrument`;
  `client/protocol.ts` holds the messages both sides speak
- `src/mock.ts` — fake apps with deterministic reducers implementing `StoreConn`; the real bridge must match it
- `src/settings.ts` — `:set` options (definitions, vim-style parser, config file at `~/.config/openstate/config`).
  A new option needs its entry in `OPTIONS`, `Settings` and `DEFAULTS`; the card, completion and file follow
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
  openstate with `OPENSTATE_URL`. Quit openstate with `q` before killing tmux, or the process outlives the session.
- Verify UI changes by running the app in tmux (`tmux new-session -d -s os -x 120 -y 30 "bun src/main.tsx"`, then
  `send-keys` and `capture-pane -p`). Mouse can be simulated with SGR sequences, e.g. `send-keys -l $'\e[<0;10;5M'`.
