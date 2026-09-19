/**
 * Buyer-order helpers — pure on purpose, so the labels and the active/delivered split can be
 * checked in Node (`_orders_check.cjs`) instead of guessed at in the browser. No Firebase here.
 */

export type OrderTone = 'amber' | 'green' | 'red' | 'grey'

export interface StatusLabel {
  text: string
  tone: OrderTone
  icon: string
}

/**
 * What a seller's status word actually means to the person who paid.
 * The stored values (`pending`, `paid`, `awaiting_payment`, `fulfilled`…) are seller
 * bookkeeping; a buyer should read a sentence.
 */
export function buyerStatusLabel(status?: string): StatusLabel {
  switch (status) {
    case 'fulfilled':
      return { text: 'Delivered', tone: 'green', icon: '✓' }
    case 'out_of_stock':
      return { text: 'Not available', tone: 'red', icon: '✕' }
    case 'needs_details':
      return { text: 'The seller needs details', tone: 'amber', icon: '❗' }
    case 'cancelled':
      return { text: 'Cancelled', tone: 'grey', icon: '—' }
    default:
      return { text: 'Waiting for the seller', tone: 'amber', icon: '⏳' }
  }
}

/** Still being worked on (or still waiting) vs finished business. */
export function isActiveBuyerOrder(status?: string): boolean {
  return status !== 'fulfilled' && status !== 'cancelled'
}

export function splitBuyerOrders<T extends { status?: string }>(orders: T[]): { active: T[]; past: T[] } {
  const active: T[] = []
  const past: T[] = []
  orders.forEach(order => (isActiveBuyerOrder(order.status) ? active : past).push(order))
  return { active, past }
}

/** "45000" + 2 → 90000. Prices and quantities are strings in the database; be forgiving. */
export function orderTotal(price?: string | number, quantity?: string | number): number {
  const unit = Number(String(price ?? '').replace(/,/g, '')) || 0
  const qty = Number(quantity) || 1
  return unit * qty
}

/** "just now" · "3h ago" · "2 days ago" — how long ago an order was placed, in words. */
export function orderAge(createdAtMs?: number | null, now = Date.now()): string {
  if (!createdAtMs) return ''
  const minutes = Math.max(0, Math.round((now - createdAtMs) / 60000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days} days ago`
  const months = Math.round(days / 30)
  return months <= 1 ? 'last month' : `${months} months ago`
}

export type BuyerOrderFilter = 'all' | 'active' | 'delivered'

export function matchesBuyerFilter(status: string | undefined, filter: BuyerOrderFilter): boolean {
  if (filter === 'delivered') return status === 'fulfilled'
  if (filter === 'active') return isActiveBuyerOrder(status)
  return true
}
