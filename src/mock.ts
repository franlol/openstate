// Fake apps that emit actions, standing in for real connections until the bridge exists.
import type { Action, Lib, Source, Store } from "./model"

type Step = { type: string; payload: unknown; next: (s: any) => any; at: string }
type Gen = (s: any) => Step | null

const products = [
  { id: 42, name: "Mechanical keyboard", price: 89.9 },
  { id: 7, name: "USB-C cable", price: 9.95 },
  { id: 13, name: "Monitor arm", price: 49.0 },
  { id: 21, name: "Desk mat", price: 19.95 },
]
const pick = <T>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)]!
const round = (n: number) => Math.round(n * 100) / 100
const total = (items: { price: number; qty: number }[]) => round(items.reduce((a, i) => a + i.price * i.qty, 0))

const shopGen: Gen = (s) => {
  const r = Math.random()
  if (!s.user.loggedIn)
    return {
      type: "user/login",
      payload: { id: "u_81", name: "ada" },
      at: "LoginForm.tsx:31:7",
      next: (s) => ({ ...s, user: { id: "u_81", name: "ada", loggedIn: true } }),
    }
  if (r < 0.4) {
    const p = pick(products)
    return {
      type: "cart/add",
      payload: { id: p.id, qty: 1 },
      at: "AddToCart.tsx:42:9",
      next: (s) => {
        const found = s.cart.items.find((i: any) => i.id === p.id)
        const items = found
          ? s.cart.items.map((i: any) => (i.id === p.id ? { ...i, qty: i.qty + 1 } : i))
          : [...s.cart.items, { id: p.id, qty: 1, price: p.price }]
        return { ...s, cart: { items, total: total(items) } }
      },
    }
  }
  if (r < 0.55 && s.cart.items.length) {
    const it = pick<any>(s.cart.items)
    return {
      type: "cart/remove",
      payload: { id: it.id },
      at: "CartRow.tsx:18:5",
      next: (s) => {
        const items = s.cart.items.filter((i: any) => i.id !== it.id)
        return { ...s, cart: { items, total: total(items) } }
      },
    }
  }
  if (r < 0.7)
    return {
      type: "products/fetch/pending",
      payload: { page: 1 },
      at: "useProducts.ts:12:3",
      next: (s) => ({ ...s, ui: { ...s.ui, loading: true } }),
    }
  if (r < 0.8)
    return {
      type: "products/fetch/fulfilled",
      payload: { count: products.length },
      at: "useProducts.ts:15:5",
      next: (s) => ({ ...s, ui: { ...s.ui, loading: false } }),
    }
  if (r < 0.9)
    return {
      type: s.ui.modal ? "ui/closeModal" : "ui/openModal",
      payload: s.ui.modal ? null : { name: "cart" },
      at: "Header.tsx:64:11",
      next: (s) => ({ ...s, ui: { ...s.ui, modal: s.ui.modal ? null : "cart" } }),
    }
  if (!s.cart.items.length) return null
  return {
    type: "checkout/start",
    payload: { total: s.cart.total },
    at: "Checkout.tsx:22:7",
    next: (s) => ({ ...s, checkout: { step: "payment", total: s.cart.total } }),
  }
}

const prefsGen: Gen = (s) =>
  Math.random() < 0.5
    ? {
        type: "setCurrency",
        payload: { currency: s.currency === "EUR" ? "USD" : "EUR" },
        at: "CurrencyPicker.tsx:9:3",
        next: (s) => ({ ...s, currency: s.currency === "EUR" ? "USD" : "EUR" }),
      }
    : {
        type: "toggleNotifications",
        payload: undefined,
        at: "Settings.tsx:40:5",
        next: (s) => ({ ...s, notifications: !s.notifications }),
      }

let orderNo = 1000
const ordersGen: Gen = (s) => {
  const r = Math.random()
  const ids = Object.keys(s.orders.byId)
  if (r < 0.45 || !ids.length) {
    const id = `ord_${++orderNo}`
    return {
      type: "order/create",
      payload: { id, total: round(Math.random() * 200) },
      at: "routes/orders.ts:57:12",
      next: (s) => ({
        ...s,
        orders: { byId: { ...s.orders.byId, [id]: { status: "pending" } }, count: s.orders.count + 1 },
        queue: { pending: s.queue.pending + 1 },
      }),
    }
  }
  if (r < 0.8) {
    const id = pick(ids)
    return {
      type: "order/paid",
      payload: { id },
      at: "workers/payments.ts:88:7",
      next: (s) => ({
        ...s,
        orders: { ...s.orders, byId: { ...s.orders.byId, [id]: { status: "paid" } } },
        queue: { pending: Math.max(0, s.queue.pending - 1) },
      }),
    }
  }
  return {
    type: "cache/evict",
    payload: { keys: 3 },
    at: "lib/cache.ts:120:3",
    next: (s) => ({ ...s, cache: { size: Math.max(0, (s.cache?.size ?? 64) - 3) } }),
  }
}

const atomsGen: Gen = (s) => {
  const r = Math.random()
  if (r < 0.4) return { type: "pageAtom", payload: s.pageAtom + 1, at: "Pager.tsx:14:5", next: (s) => ({ ...s, pageAtom: s.pageAtom + 1 }) }
  if (r < 0.7) {
    const q = pick(["", "ad", "ada", "lin", "linus"])
    return { type: "filterAtom", payload: q, at: "SearchBox.tsx:22:9", next: (s) => ({ ...s, filterAtom: q }) }
  }
  const u = pick(["u_81", "u_12", null])
  return { type: "selectedUserAtom", payload: u, at: "UserTable.tsx:71:13", next: (s) => ({ ...s, selectedUserAtom: u }) }
}

type Spec = { sourceId: string; lib: Lib; name: string; init: unknown; gen: Gen; every: [number, number] }

const specs: Spec[] = [
  {
    sourceId: "shop-web",
    lib: "redux",
    name: "redux",
    init: { cart: { items: [], total: 0 }, user: { id: null, name: null, loggedIn: false }, ui: { modal: null, loading: false } },
    gen: shopGen,
    every: [400, 2200],
  },
  {
    sourceId: "shop-web",
    lib: "zustand",
    name: "prefs",
    init: { currency: "EUR", locale: "es-ES", notifications: true },
    gen: prefsGen,
    every: [3000, 9000],
  },
  {
    sourceId: "api-node",
    lib: "redux",
    name: "orders",
    init: { orders: { byId: {}, count: 0 }, queue: { pending: 0 } },
    gen: ordersGen,
    every: [600, 3000],
  },
  {
    sourceId: "admin-panel",
    lib: "jotai",
    name: "atoms",
    init: { pageAtom: 1, filterAtom: "", selectedUserAtom: null },
    gen: atomsGen,
    every: [1500, 5000],
  },
]

export const MAX_AGE = 500
let actionId = 0

export function startMock(onChange: () => void, isPaused: () => boolean): Source[] {
  const sources: Source[] = ["shop-web", "api-node", "admin-panel"].map((id, i) => ({
    id,
    name: id,
    color: i,
    connected: true,
    links: [{ time: Date.now(), connected: true }],
    stores: [],
  }))
  for (const spec of specs) {
    const src = sources.find((s) => s.id === spec.sourceId)!
    const store: Store = { key: `${spec.sourceId}/${spec.name}`, sourceId: spec.sourceId, lib: spec.lib, name: spec.name, actions: [] }
    src.stores.push(store)
    let state = spec.init
    let seq = 0
    const push = (type: string, payload: unknown, next: unknown, at: string) => {
      const a: Action = {
        id: ++actionId,
        seq: seq++,
        storeKey: store.key,
        type,
        payload,
        time: Date.now(),
        prev: state,
        state: next,
        trace: [`at ${at}`, "at dispatch (redux/src/createStore.ts:271:7)", "at HTMLUnknownElement.callCallback (react-dom.js:3945)"],
        skipped: false,
      }
      state = next
      store.actions.push(a)
      if (store.actions.length > MAX_AGE) store.actions.shift()
    }
    push("@@INIT", undefined, state, "store.ts:8:14")
    const tick = () => {
      if (src.connected && !isPaused()) {
        const step = spec.gen(state)
        if (step) {
          push(step.type, step.payload, step.next(state), step.at)
          onChange()
        }
      }
      const [lo, hi] = spec.every
      // Occasional bursts make the sparkline readable.
      const burst = Math.random() < 0.15
      setTimeout(tick, burst ? 120 : lo + Math.random() * (hi - lo))
    }
    setTimeout(tick, 300 + Math.random() * 1000)
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
