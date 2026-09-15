import type { NavigateFunction } from 'react-router-dom'

/**
 * "Sign in first, then finish what you were doing."
 *
 * A guest who taps Buy or Message used to be thrown at the sign-in screen and
 * never returned — they had to find the product again. We now remember the action
 * and the page, and the app brings them straight back to it.
 *
 * The action itself is kept in sessionStorage (survives the sign-in round trip,
 * including a full-page redirect sign-in) and is consumed exactly once.
 */
export type PendingAction = 'order' | 'message'

export interface PendingIntent {
  action: PendingAction
  /** The page to come back to, e.g. '/browse' or '/store/aisha-fabrics'. */
  returnTo: string
  productId?: string
  sellerSlug?: string
  /** When it was set — a stale intent is not worth reopening hours later. */
  at?: number
}

const KEY = 'rachett_pending_action'
/** After this long, the moment has passed — forget it. */
const STALE_MS = 15 * 60 * 1000

export function setPendingIntent(intent: PendingIntent): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ ...intent, at: Date.now() }))
  } catch {
    // ignore storage errors
  }
}

/** Read without consuming — pages use this while their data is still loading. */
export function peekPendingIntent(): PendingIntent | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PendingIntent
    if (!parsed || !parsed.action) return null
    if (parsed.at && Date.now() - parsed.at > STALE_MS) {
      clearPendingIntent()
      return null
    }
    return parsed
  } catch {
    return null
  }
}

/** Consume it — call this once the action has actually been re-opened. */
export function clearPendingIntent(): void {
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    // ignore storage errors
  }
}

/**
 * Send someone to sign in, remembering what they were doing so the app can put
 * them back afterwards (and reopen the sheet they were using).
 */
export function requireSignIn(navigate: NavigateFunction, intent: PendingIntent): void {
  setPendingIntent(intent)
  navigate('/', { state: { returnTo: intent.returnTo, pendingAction: intent.action } })
}

/**
 * Called by a page once its products/bag are on screen: if the person was blocked
 * mid-action before signing in, reopen exactly that sheet and forget about it.
 */
export function consumePendingAction<T extends { id: string }>(
  products: T[],
  open: { order: (product: T) => void; message: (product: T) => void },
): void {
  const pending = peekPendingIntent()
  if (!pending?.productId) return
  const product = products.find(item => item.id === pending.productId)
  if (!product) return
  if (pending.action === 'order') open.order(product)
  else open.message(product)
  clearPendingIntent()
}
