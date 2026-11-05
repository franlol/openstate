// Fake apps that emit actions, standing in for real connections until the bridge exists.
// Each store has a deterministic reducer, so dispatch, skip and revert behave like a real app.
import { PROTOCOL } from "../client/protocol"
import { CLIENT_VERSION } from "../client/version"
import { newActionId, type Access, type Action, type ActionInput, type History, type Lib, type Origin, type Source, type Store } from "./model"

type Step = ActionInput & { at: string }
type Gen = (s: any) => Step | null
type Reducer = (s: any, a: ActionInput) => any

const products = [
  { id: 42, name: "Mechanical keyboard", price: 89.9 },
  { id: 7, name: "USB-C cable", price: 9.95 },
  { id: 13, name: "Monitor arm", price: 49.0 },
  { id: 21, name: "Desk mat", price: 19.95 },
]
const pick = <T>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)]!
const round = (n: number) => Math.round(n * 100) / 100
const total = (items: { price: number; qty: number }[]) => round(items.reduce((a, i) => a + i.price * i.qty, 0))

const shopReduce: Reducer = (s, { type, payload: p }: { type: string; payload?: any }) => {
  switch (type) {
    case "user/login":
      return { ...s, user: { id: p?.id ?? null, name: p?.name ?? null, loggedIn: true } }
    case "cart/add": {
      const found = s.cart.items.find((i: any) => i.id === p?.id)
      const qty = Number(p?.qty ?? 1)
      const price = products.find((x) => x.id === p?.id)?.price ?? 0
      const items = found
        ? s.cart.items.map((i: any) => (i.id === p.id ? { ...i, qty: i.qty + qty } : i))
        : [...s.cart.items, { id: p?.id, qty, price }]
      return { ...s, cart: { items, total: total(items) } }
    }
    case "cart/remove": {
      const items = s.cart.items.filter((i: any) => i.id !== p?.id)
      return { ...s, cart: { items, total: total(items) } }
    }
    case "products/fetch/pending":
      return { ...s, ui: { ...s.ui, loading: true } }
    case "products/fetch/fulfilled":
      return { ...s, ui: { ...s.ui, loading: false } }
    case "ui/openModal":
      return { ...s, ui: { ...s.ui, modal: p?.name ?? "cart" } }
    case "ui/closeModal":
      return { ...s, ui: { ...s.ui, modal: null } }
    case "checkout/start":
      return { ...s, checkout: { step: "payment", total: s.cart.total } }
  }
  return s
}

const shopGen: Gen = (s) => {
  const r = Math.random()
  if (!s.user.loggedIn) return { type: "user/login", payload: { id: "u_81", name: "ada" }, at: "LoginForm.tsx:31:7" }
  if (r < 0.4) return { type: "cart/add", payload: { id: pick(products).id, qty: 1 }, at: "AddToCart.tsx:42:9" }
  if (r < 0.55 && s.cart.items.length)
    return { type: "cart/remove", payload: { id: pick<any>(s.cart.items).id }, at: "CartRow.tsx:18:5" }
  if (r < 0.7) return { type: "products/fetch/pending", payload: { page: 1 }, at: "useProducts.ts:12:3" }
  if (r < 0.8) return { type: "products/fetch/fulfilled", payload: { count: products.length }, at: "useProducts.ts:15:5" }
  if (r < 0.9)
    return s.ui.modal
      ? { type: "ui/closeModal", payload: null, at: "Header.tsx:64:11" }
      : { type: "ui/openModal", payload: { name: "cart" }, at: "Header.tsx:64:11" }
  if (!s.cart.items.length) return null
  return { type: "checkout/start", payload: { total: s.cart.total }, at: "Checkout.tsx:22:7" }
}

const prefsReduce: Reducer = (s, { type, payload: p }: { type: string; payload?: any }) => {
  if (type === "setCurrency") return { ...s, currency: p?.currency ?? s.currency }
  if (type === "toggleNotifications") return { ...s, notifications: !s.notifications }
  return s
}

const prefsGen: Gen = (s) =>
  Math.random() < 0.5
    ? { type: "setCurrency", payload: { currency: s.currency === "EUR" ? "USD" : "EUR" }, at: "CurrencyPicker.tsx:9:3" }
    : { type: "toggleNotifications", payload: undefined, at: "Settings.tsx:40:5" }

const ordersReduce: Reducer = (s, { type, payload: p }: { type: string; payload?: any }) => {
  switch (type) {
    case "order/create":
      return {
        ...s,
        orders: { byId: { ...s.orders.byId, [p?.id]: { status: "pending" } }, count: s.orders.count + 1 },
        queue: { pending: s.queue.pending + 1 },
      }
    case "order/paid":
      return {
        ...s,
        orders: { ...s.orders, byId: { ...s.orders.byId, [p?.id]: { status: "paid" } } },
        queue: { pending: Math.max(0, s.queue.pending - 1) },
      }
    case "cache/evict":
      return { ...s, cache: { size: Math.max(0, (s.cache?.size ?? 64) - Number(p?.keys ?? 1)) } }
  }
  return s
}

let orderNo = 1000
const ordersGen: Gen = (s) => {
  const r = Math.random()
  const ids = Object.keys(s.orders.byId)
  if (r < 0.45 || !ids.length)
    return { type: "order/create", payload: { id: `ord_${++orderNo}`, total: round(Math.random() * 200) }, at: "routes/orders.ts:57:12" }
  if (r < 0.8) return { type: "order/paid", payload: { id: pick(ids) }, at: "workers/payments.ts:88:7" }
  return { type: "cache/evict", payload: { keys: 3 }, at: "lib/cache.ts:120:3" }
}

// Jotai-style: the action type is the atom and the payload its new value.
const atomsReduce: Reducer = (s, { type, payload }) => (type in s ? { ...s, [type]: payload } : s)

const atomsGen: Gen = (s) => {
  const r = Math.random()
  if (r < 0.4) return { type: "pageAtom", payload: s.pageAtom + 1, at: "Pager.tsx:14:5" }
  if (r < 0.7) return { type: "filterAtom", payload: pick(["", "ad", "ada", "lin", "linus"]), at: "SearchBox.tsx:22:9" }
  return { type: "selectedUserAtom", payload: pick(["u_81", "u_12", null]), at: "UserTable.tsx:71:13" }
}

type Spec = { sourceId: string; lib: Lib; name: string; init: unknown; gen: Gen; reduce: Reducer; every: [number, number] }

const specs: Spec[] = [
  {
    sourceId: "shop-web",
    lib: "redux",
    name: "redux",
    init: { cart: { items: [], total: 0 }, user: { id: null, name: null, loggedIn: false }, ui: { modal: null, loading: false } },
    gen: shopGen,
    reduce: shopReduce,
    every: [400, 2200],
  },
  {
    sourceId: "shop-web",
    lib: "zustand",
    name: "prefs",
    init: { currency: "EUR", locale: "es-ES", notifications: true },
    gen: prefsGen,
    reduce: prefsReduce,
    every: [3000, 9000],
  },
  {
    sourceId: "api-node",
    lib: "redux",
    name: "orders",
    init: { orders: { byId: {}, count: 0 }, queue: { pending: 0 } },
    gen: ordersGen,
    reduce: ordersReduce,
    every: [600, 3000],
  },
  {
    sourceId: "admin-panel",
    lib: "jotai",
    name: "atoms",
    init: { pageAtom: 1, filterAtom: "", selectedUserAtom: null },
    gen: atomsGen,
    reduce: atomsReduce,
    every: [1500, 5000],
  },
]


const TRACE = ["at dispatch (redux/src/createStore.ts:271:7)", "at HTMLUnknownElement.callCallback (react-dom.js:3945)"]

export function startMock(onChange: () => void, isPaused: () => boolean, maxAge: () => number): Source[] {
  // shop-web runs in the browser on this machine, admin-panel on a page from elsewhere let in before, api-node
  // outside a browser.
  const origins: Record<string, string | undefined> = { "shop-web": "http://localhost:3000", "admin-panel": "https://admin.miapp.com" }
  const sources: Source[] = ["shop-web", "api-node", "admin-panel"].map((id, i) => ({
    id,
    name: id,
    color: i,
    connected: true,
    origin: origins[id],
    links: [{ time: Date.now(), connected: true }],
    stores: [],
    // api-node runs an older client, to show how openstate flags it.
    client: { version: id === "api-node" ? "0.1.2" : CLIENT_VERSION, protocol: PROTOCOL },
  }))
  for (const spec of specs) {
    const src = sources.find((s) => s.id === spec.sourceId)!
    src.stores.push(mockStore(spec, src, onChange, isPaused, maxAge))
  }

  // admin-panel drops and comes back, to exercise the disconnected state.
  const admin = sources.find((s) => s.id === "admin-panel")!
  const flap = () => {
    admin.connected = !admin.connected
    admin.links.push({ time: Date.now(), connected: admin.connected })
    onChange()
    setTimeout(flap, admin.connected ? 40000 : 12000)
  }
  setTimeout(flap, 40000)
  return sources
}

// One fake app store: it owns its live state and history, like redux-devtools-instrument.
function mockStore(spec: Spec, src: Source, onChange: () => void, isPaused: () => boolean, maxAge: () => number): Store {
  const key = `${spec.sourceId}/${spec.name}`
  let state = spec.init
  let seq = 0

  const record = (input: ActionInput, at: string, fromDevtools = false, silent = false) => {
    const prev = state
    state = spec.reduce(state, input)
    // Paused recording: the app keeps running, openstate just does not log it.
    if (isPaused() && !fromDevtools) return
    const a: Action = {
      id: newActionId(),
      seq: seq++,
      storeKey: key,
      type: input.type,
      payload: input.payload,
      time: Date.now(),
      prev,
      state,
      trace: [`at ${at}`, ...TRACE],
      skipped: false,
      fromDevtools,
    }
    store.actions.push(a)
    // Like Redux DevTools' maxAge: the oldest kept action becomes the new starting point.
    while (store.actions.length > maxAge()) store.actions.shift()
    if (!silent) onChange()
  }

  // Replay everything after the commit (or the oldest kept action), leaving skipped ones out.
  const recompute = () => {
    const acts = store.actions
    const from = Math.max(1, acts.findIndex((a) => a.id === store.commitId) + 1)
    let cur = acts[from - 1]?.state
    for (let i = from; i < acts.length; i++) {
      const a = acts[i]!
      a.prev = cur
      if (!a.skipped) cur = spec.reduce(cur, a)
      a.state = cur
    }
    state = cur
    onChange()
  }
  const base = () => Math.max(0, store.actions.findIndex((a) => a.id === store.commitId))

  const store: Store = {
    key,
    sourceId: spec.sourceId,
    lib: spec.lib,
    name: spec.name,
    actions: [],
    commitId: null,
    locked: false,
    conn: {
      dispatch: (a) => record(a, "openstate dispatch", true),
      toggle: (id) => {
        const a = store.actions.find((x) => x.id === id)
        if (!a) return
        a.skipped = !a.skipped
        recompute()
      },
      commit: (id) => {
        store.commitId = id
        onChange()
      },
      revert: () => {
        store.actions.splice(base() + 1)
        state = store.actions[store.actions.length - 1]?.state ?? spec.init
        onChange()
      },
      reorder: (id, beforeId) => {
        const acts = store.actions
        const from = acts.findIndex((x) => x.id === id)
        if (from < 1) return
        const [a] = acts.splice(from, 1)
        const to = beforeId === null ? acts.length : acts.findIndex((x) => x.id === beforeId)
        acts.splice(to < 0 ? acts.length : to, 0, a!)
        recompute()
      },
      sweep: () => {
        store.actions = store.actions.filter((a) => !a.skipped)
        onChange()
      },
      lock: (on) => {
        store.locked = on
        onChange()
      },
      import: (h: History) => {
        seq = 0
        store.commitId = null
        store.actions = h.actions.map((x) => ({
          id: newActionId(),
          seq: seq++,
          storeKey: key,
          type: x.type,
          payload: x.payload,
          time: x.time,
          prev: undefined,
          state: x.state,
          trace: x.trace,
          skipped: x.skipped,
        }))
        store.actions.forEach((a, i) => (a.prev = i ? store.actions[i - 1]!.state : a.state))
        state = store.actions[store.actions.length - 1]!.state
        // Without saved states the reducer rebuilds them from the first one.
        if (!h.hasStates) {
          const first = store.actions[0]!
          first.state ??= spec.init
          first.prev = first.state
          recompute()
        } else onChange()
      },
    },
  }

  // Silent: openstate is still being constructed and reads the history when it is done.
  record({ type: "@@INIT" }, "store.ts:8:14", false, true)
  const tick = () => {
    if (src.connected && !store.locked) {
      const step = spec.gen(state)
      if (step) record(step, step.at)
    }
    const [lo, hi] = spec.every
    // Occasional bursts make the activity track readable.
    const burst = Math.random() < 0.15
    setTimeout(tick, burst ? 120 : lo + Math.random() * (hi - lo))
  }
  setTimeout(tick, 300 + Math.random() * 1000)
  return store
}

// Pages from elsewhere, to show what asking looks like: a staging site that keeps trying until it is answered,
// and a tracker said no to before. Nothing real connects, so a yes only takes the page off the list.
export function mockAccess(onChange: () => void): Access {
  const origins: Origin[] = [{ origin: "https://ads.tracker.io", access: "blocked", tries: 3, time: Date.now() - 60000, live: 1 }]
  const allowed = new Set<string>()
  const retry = (origin: string, every: number) => {
    const tick = () => {
      if (allowed.has(origin)) return
      const o = origins.find((x) => x.origin === origin)
      if (!o) origins.unshift({ origin, access: "pending", tries: 1, time: Date.now(), live: 1 })
      else (o.tries++, (o.time = Date.now()))
      onChange()
      setTimeout(tick, every)
    }
    return tick
  }
  setTimeout(retry("https://staging.miapp.com", 9000), 5000)
  setTimeout(retry("https://ads.tracker.io", 20000), 20000)
  const drop = (origin: string) => origins.splice(0, origins.length, ...origins.filter((o) => o.origin !== origin))
  return {
    origins,
    allow: (origin) => (allowed.add(origin), drop(origin), onChange()),
    block(origin) {
      allowed.delete(origin)
      const o = origins.find((x) => x.origin === origin)
      if (o) o.access = "blocked"
      else origins.push({ origin, access: "blocked", tries: 0, time: Date.now(), live: 0 })
      onChange()
    },
    forget: (origin) => (drop(origin), onChange()),
    disconnect(src) {
      src.connected = false
      src.links.push({ time: Date.now(), connected: false })
      onChange()
    },
  }
}
