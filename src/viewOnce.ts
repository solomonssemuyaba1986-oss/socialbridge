/**
 * Counting a product open exactly once per session.
 *
 * A seller reads these numbers as interest, so the number has to mean something a person could
 * recognise: "eight people looked at this today", not "eight hundred renders". The marker is per
 * session, per product, in `sessionStorage` — closed tab, fresh session, honest recount.
 *
 * Kept in its own file, with no imports, because `_marketing_check.cjs` compiles it and checks the
 * rule against a fake store rather than trusting it.
 */
import type { StorageLike } from './analytics/identity'

export const VIEW_MARKER_PREFIX = 'rachett_viewed_'

export function viewMarkerKey(productId: string): string {
  return VIEW_MARKER_PREFIX + String(productId || '')
}

/**
 * True the first time this session sees this product, false every time after — and false when there
 * is nowhere to write the marker at all.
 *
 * That last part is deliberate: in a browser that refuses storage we would have no way to tell the
 * second open from the first, and a counter that counts renders is worse than a counter that misses
 * a few. Under-counting is a small lie; over-counting is a big one.
 */
export function shouldCountView(store: StorageLike | null | undefined, productId: string): boolean {
  const id = String(productId || '')
  if (!id || !store) return false
  const key = viewMarkerKey(id)
  try {
    if (store.getItem(key) === '1') return false
    store.setItem(key, '1')
    return true
  } catch {
    return false
  }
}

/** The browser's session storage, or an in-memory stand-in when the browser refuses to hand it over. */
export function sessionStore(): StorageLike {
  try {
    const store = window.sessionStorage
    const probe = '__rachett_probe__'
    store.setItem(probe, '1')
    store.removeItem(probe)
    return store
  } catch {
    const memory = new Map<string, string>()
    return {
      getItem: key => (memory.has(key) ? (memory.get(key) as string) : null),
      setItem: (key, value) => { memory.set(key, value) },
      removeItem: key => { memory.delete(key) },
    }
  }
}
