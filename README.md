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

Press `?` for keybindings and `:` for commands (the list shows what each one does). Debug the keymap with
`OPENSTATE_DEBUG=debug.log bun run start`.

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
| `theme`  | `openstate` `catppuccin` `tokyonight` `gruvbox` `nord` | `openstate` | colour theme; `:theme` previews them as you move |

Settings live in `~/.config/openstate/config` (or `$XDG_CONFIG_HOME/openstate/config`), one option per line in the same
syntax as `:set`, each with a comment saying what it does. You can edit it by hand; a line openstate cannot read is
reported on startup and the rest still apply.

## Develop

```bash
bun run typecheck
```

The OpenTUI agent skill is not committed; reinstall it with `bunx skills add https://opentui.com --skill opentui`.
