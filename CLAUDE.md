# openstate

Terminal UI for inspecting and time-travelling app state (Redux DevTools compatible), built with OpenTUI + React on Bun.
It currently runs on mock data (`src/mock.ts`); the bridge to real apps is planned.

## Commands

- `bun run dev` / `bun run start` — run the TUI
- `bun run typecheck` — must pass before finishing a change
- `OPENSTATE_DEBUG=debug.log bun run start` — logs keymap warnings/errors and how each key was dispatched

Use Bun for everything (`bun`, `bunx`, `bun test`, `Bun.serve` for servers with built-in `WebSocket`).

## Layout

- `src/main.tsx` — renderer, keymap setup (ex commands, leader `g`), React root
- `src/state.ts` — `AppState`: single mutable store; UI subscribes via `useApp()`, mutations call `emit()`
- `src/model.ts` — data types, structural diff, tree flattening
- `src/mock.ts` — fake apps and action generators
- `src/theme.ts` — theme tokens; never hardcode colours in components
- `src/ui/keys.ts` — every keybinding, also feeds the help overlay and status hints
- `src/ui/kit.tsx` — `Line`/`Part` rendering helpers (`fit`, `spread`), syntax styles
- `src/ui/*.tsx` — Header/Track (top), panels, inspector, status bar, overlays

## Conventions

- Use OpenTUI components (`scrollbox`, `tab-select`, `select`, `input`, `code`, `diff`, `ascii-font`) before hand-rolling.
  Docs live in the opentui skill (`.claude/skills/opentui`, reinstall with `bunx skills add https://opentui.com --skill opentui`).
- Keys go through `@opentui/keymap` layers, gated by mode with `reactiveMatcherFromStore`. Vim-style sequences use the
  `<g>` leader (plain `gt` parses as the `>` key, `G` as `g`; write `shift+g`).
- Terminal-dense layout: no gaps between panels, no decorative padding.
- Verify UI changes by running the app in tmux (`tmux new-session -d -s os -x 120 -y 30 "bun src/main.tsx"`, then
  `send-keys` and `capture-pane -p`). Mouse can be simulated with SGR sequences, e.g. `send-keys -l $'\e[<0;10;5M'`.
