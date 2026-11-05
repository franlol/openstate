// Which library made a store, from the call stack at the moment it does: the extension's API is told only the app's
// options, but the library's own files are on the stack, under node_modules in every setup (webpack-internal:///…,
// Vite's .vite/deps, pnpm, Bun, Node, Windows paths).

// Packages on the stack that never make stores: frameworks, React, bundler runtimes and helpers, and this client.
const IGNORED = new Set([
  "react",
  "react-dom",
  "react-reconciler",
  "react-server-dom-webpack",
  "scheduler",
  "use-sync-external-store",
  "next",
  "webpack",
  "vite",
  "@vitejs/plugin-react",
  "@swc/helpers",
  "@babel/runtime",
  "tslib",
  "core-js",
  "regenerator-runtime",
  "@openstate-devtools/client",
  "@redux-devtools/instrument",
])

// How a package is shown, when its name says less than the library's.
const LABELS: Record<string, string> = {
  "@reduxjs/toolkit": "redux toolkit",
  "jotai-devtools": "jotai",
  "@ngrx/store-devtools": "ngrx",
  "@ngrx/store": "ngrx",
  "@ngxs/devtools-plugin": "ngxs",
  "@ngxs/store": "ngxs",
  "@datorama/akita": "akita",
  "mst-middlewares": "mobx-state-tree",
  "@effector/redux-devtools-adapter": "effector",
  "@legendapp/state": "legend-state",
  "@xstate/inspect": "xstate",
}

// The package a stack line runs in, or null for the app's own code.
function packageOf(line: string): string | null {
  const path = line.replace(/\\/g, "/")
  // Vite serves dependencies prebundled, one file per entry: .vite/deps/zustand_middleware.js, @reduxjs_toolkit.js.
  const vite = path.match(/\/node_modules\/\.vite\/deps\/([^/?:]+)\.m?js/)
  if (vite) {
    const file = vite[1]!
    if (file.startsWith("chunk-")) return null
    const parts = file.split("_")
    return file.startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0]!
  }
  // The last node_modules on the line: pnpm nests packages in .pnpm/<name>@<version>/node_modules/<name>.
  const all = [...path.matchAll(/\/node_modules\/((?:@[^/]+\/)?[^/]+)/g)]
  const name = all.at(-1)?.[1]
  return name && !name.startsWith(".") ? name : null
}

// The nearest library on the stack, skipping `skip` (the one a store is made with anyway, like redux for an
// enhancer, so that Redux Toolkit or easy-peasy show instead). Null when none is there.
export function libFromStack(stack: string, skip?: string): string | null {
  for (const line of stack.split("\n").slice(1)) {
    const name = packageOf(line)
    if (!name || IGNORED.has(name) || name === skip) continue
    return LABELS[name] ?? name
  }
  return null
}

export function currentStack(): string {
  const limit = Error.stackTraceLimit
  Error.stackTraceLimit = 50
  const stack = new Error().stack ?? ""
  Error.stackTraceLimit = limit
  return stack
}
