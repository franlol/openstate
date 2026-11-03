# openstate

A terminal UI to inspect and time-travel application state — Redux DevTools in your terminal, for every app you have
open at once. Built with [OpenTUI](https://opentui.com).

> Prototype: it runs on mock data (three fake apps). The bridge to real apps is not built yet.

## Run

```bash
bun install
bun run dev      # restarts on save
bun run start
```

Press `?` for keybindings. Debug the keymap with `OPENSTATE_DEBUG=debug.log bun run start`.

## Develop

```bash
bun run typecheck
```

The OpenTUI agent skill is not committed; reinstall it with `bunx skills add https://opentui.com --skill opentui`.
