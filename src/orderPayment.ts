/**
 * What the money on an order actually says — pure on purpose, so the labels can be checked in Node
 * (`_order_payment_check.cjs`) instead of guessed at in the browser. No Firebase here.
 *
 * Both payment flows write the same story onto the order document (`functions/index.js`, the pawaPay
 * deposit at ~L656 and its settlement at ~L749, the Pesapal ones at ~L270 and ~L351): a
 * `paymentStatus`, the rail, the amount, a note when the seller must be told something, and `paidAt`
 * — with the order's own `status` becoming `paid` when the money landed. The seller's screen read
 * none of it, so a buyer who had really paid still saw the word "Pending": the money had arrived and
 * nothing said so.
 */

export type OrderPaymentState = 'none' | 'waiting' | 'paid' | 'failed'

/** The payment half of an order document, as a seller's own read of it arrives. */
export interface OrderPaymentFields {
  /** The order's own status: `pending` · `paid` · `awaiting_payment` · `fulfilled` … */
  status?: string
  /** `initiated` while the prompt is on the phone, then `completed` · `failed` · `unknown`. */
  paymentStatus?: string
  /** The rail the money came in on, as pawaPay names it — e.g. `MTN_MOMO_UGA`. */
  paymentMethod?: string
  paymentAmount?: number
  paymentCurrency?: string
  /** Written only when the seller must know: a mismatched amount, or a rail they had not listed. */
  paymentNote?: string
  paidAt?: { toDate?: () => Date } | null
}

function word(value: unknown): string {
  return String(value === null || value === undefined ? '' : value).trim()
}

/**
 * Which of the four things is true. The server's own word wins, because it is the only one that
 * knows: `unknown` means pawaPay has not decided yet — "check the status before considering it
 * failed" in their words — so nothing is claimed either way.
 */
export function orderPaymentState(order: OrderPaymentFields | null | undefined): OrderPaymentState {
  const server = word(order?.paymentStatus).toLowerCase()
  if (server === 'completed') return 'paid'
  if (server === 'failed' || server === 'rejected') return 'failed'
  if (server === 'initiated' || server === 'pending' || server === 'unknown') return 'waiting'
  // Nothing from the server: the order's own status is then the only evidence there is.
  if (order?.status === 'paid') return 'paid'
  if (order?.status === 'awaiting_payment') return 'waiting'
  return 'none'
}

/**
 * `MTN_MOMO_UGA` → **MTN MoMo**. The stored value is a pawaPay rail id, and an id is not something
 * to show a person; when we do not recognise one we say nothing rather than print it at them.
 */
export function methodWords(method?: string): string {
  const upper = word(method).toUpperCase()
  if (!upper) return ''
  if (upper.includes('MTN')) return 'MTN MoMo'
  if (upper.includes('AIRTEL')) return 'Airtel Money'
  if (upper.includes('MPESA') || upper.includes('M-PESA')) return 'M-Pesa'
  if (upper.includes('VISA') || upper.includes('MASTER') || upper.includes('CARD')) return 'Card'
  if (upper.includes('PESAPAL')) return 'Pesapal'
  return ''
}

/** "UGX 45,000" — the currency the flow recorded, and an amount in a form a person reads. */
export function paymentMoney(order: OrderPaymentFields | null | undefined): string {
  const amount = Number(order?.paymentAmount)
  if (!Number.isFinite(amount) || amount <= 0) return ''
  const currency = word(order?.paymentCurrency).toUpperCase() || 'UGX'
  // A whole number of shillings stays whole; a currency with minor units keeps its cents.
  const shown = Number.isInteger(amount) ? amount : Number(amount.toFixed(2))
  return `${currency} ${shown.toLocaleString('en-US')}`
}

/** When the money landed — or silence, never "Invalid Date". */
export function paymentWhen(order: OrderPaymentFields | null | undefined): string {
  const stamp = order?.paidAt
  if (!stamp || typeof stamp.toDate !== 'function') return ''
  const at = stamp.toDate()
  if (!(at instanceof Date) || Number.isNaN(at.getTime())) return ''
  return at.toLocaleString()
}

/**
 * The one line a seller reads: "Paid UGX 45,000 · MTN MoMo · 14/02/2026, 14:14".
 * Empty unless the money is actually in — a payment still on its way is the badge's business.
 */
export function paymentSummary(order: OrderPaymentFields | null | undefined): string {
  if (orderPaymentState(order) !== 'paid') return ''
  const money = paymentMoney(order)
  return [money ? `Paid ${money}` : 'Paid', methodWords(order?.paymentMethod), paymentWhen(order)]
    .filter(Boolean)
    .join(' · ')
}

export interface PaymentBadge {
  text: string
  tone: 'paid' | 'waiting' | 'failed'
}

/** The badge an order wears because of its money, or null when it has nothing to say about money. */
export function paymentBadge(order: OrderPaymentFields | null | undefined): PaymentBadge | null {
  const state = orderPaymentState(order)
  if (state === 'paid') return { text: '💰 Paid', tone: 'paid' }
  if (state === 'waiting') return { text: '⏳ Waiting for money', tone: 'waiting' }
  if (state === 'failed') return { text: '✕ Payment failed', tone: 'failed' }
  return null
}

/** How many of these orders already have the money — the number a seller actually wants. */
export function paidCount(orders: (OrderPaymentFields | null | undefined)[] | null | undefined): number {
  if (!Array.isArray(orders)) return 0
  return orders.filter(order => orderPaymentState(order) === 'paid').length
}
