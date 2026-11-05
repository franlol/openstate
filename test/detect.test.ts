import { expect, test } from "bun:test"
import { libFromStack } from "../client/detect"

// A stack as `new Error().stack` gives it, the first line being the message.
const stack = (...frames: string[]) => ["Error", ...frames.map((f) => `    at fn (${f}:1:1)`)].join("\n")
const own = "webpack-internal:///(app-pages-browser)/./node_modules/@openstate-devtools/client/dist/index.js"
const react = "webpack-internal:///(app-pages-browser)/./node_modules/react-dom/cjs/react-dom-client.development.js"
const app = "webpack-internal:///(app-pages-browser)/./src/stores/menu.ts"

test("the nearest library on the stack, in any setup", () => {
  const cases: [string, string][] = [
    ["webpack-internal:///(app-pages-browser)/./node_modules/zustand/esm/middleware.mjs", "zustand"],
    ["http://localhost:5173/node_modules/.vite/deps/zustand_middleware.js?v=1a2b", "zustand"],
    ["http://localhost:5173/node_modules/.vite/deps/@reduxjs_toolkit.js?v=1a2b", "redux toolkit"],
    ["/app/node_modules/.pnpm/jotai-devtools@0.10.0/node_modules/jotai-devtools/dist/utils.mjs", "jotai"],
    ["C:\\app\\node_modules\\valtio\\esm\\vanilla\\utils.mjs", "valtio"],
    ["/app/node_modules/@ngrx/store-devtools/fesm2022/ngrx-store-devtools.mjs", "ngrx"],
    ["/app/node_modules/mst-middlewares/dist/mst-middlewares.js", "mobx-state-tree"],
    ["/app/node_modules/some-new-state-lib/index.js", "some-new-state-lib"],
  ]
  for (const [path, lib] of cases) expect(libFromStack(stack(own, path, app, react))).toBe(lib)
})

test("frameworks, the app and this client are passed over", () => {
  expect(libFromStack(stack(own, app, react))).toBeNull()
  expect(libFromStack(stack("http://localhost:5173/node_modules/.vite/deps/chunk-ABC123.js", app))).toBeNull()
})

test("a redux store names what made it, not redux itself", () => {
  const redux = "/app/node_modules/redux/dist/redux.mjs"
  expect(libFromStack(stack(redux, "/app/node_modules/@reduxjs/toolkit/dist/redux-toolkit.modern.mjs", app), "redux")).toBe("redux toolkit")
  expect(libFromStack(stack(redux, "/app/node_modules/easy-peasy/dist/index.js", app), "redux")).toBe("easy-peasy")
  expect(libFromStack(stack(redux, app), "redux")).toBeNull()
})
