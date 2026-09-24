/**
 * rachett — the browser's door to Pesapal.
 *
 * There is nothing to configure here, and there never will be: Pesapal has no browser SDK, so the
 * consumer key and secret live only in Cloud Functions (`functions/pesapal.js`). This module is the
 * thin layer between a page and those three functions:
 *
 *   startPesapalPayment(sellerId, orderId)  → the link to send the buyer to
 *   goToPesapal(redirectUrl)                → follow it, after checking it really is Pesapal
 *   checkPesapalPayment({ reference })      → what the server knows about a payment *right now*
 *
 * The last one matters most: the URL a buyer comes back on carries **no** payment status, so the
 * only honest answer to "did it go through?" comes from the server asking Pesapal directly.
 */
import { httpsCallable } from 'firebase/functions'
import { functions } from './firebase'
import { DEFAULT_PESAPAL_CURRENCY, isPesapalRedirectUrl, pesapalStatusLabel } from './pesapalUtils'
import type { PesapalPaymentStatus } from './pesapalUtils'

export { PAYMENT_NOT_CONFIGURED_MESSAGE, paymentErrorMessage } from './pesapalUtils'

export type PesapalStart = {
  redirectUrl: string
  orderTrackingId: string
  reference: string
  amount: number
  currency: string
}

export type PesapalCheck = {
  status: PesapalPaymentStatus
  /** In plain words — "Paid", "Payment failed", "We are checking this payment". */
  label: string
  paid: boolean
  orderStatus: string | null
  amount: number | null
  currency: string
  method: string
  confirmationCode: string
  description: string
  /** Started, but Pesapal has not decided yet — the honest third answer. */
  pending: boolean
}

type StartRequest = { sellerId: string; orderId: string }
type StartResponse = {
  redirectUrl?: string
  orderTrackingId?: string
  reference?: string
  amount?: number
  currency?: string
}

type CheckRequest = { reference?: string; sellerId?: string; orderId?: string }
type CheckResponse = {
  status?: string
  paid?: boolean
  orderStatus?: string | null
  amount?: number | null
  currency?: string
  method?: string
  confirmationCode?: string
  description?: string
  pending?: boolean
}

const startCall = httpsCallable<StartRequest, StartResponse>(functions, 'pesapalStartPayment')
const checkCall = httpsCallable<CheckRequest, CheckResponse>(functions, 'pesapalPaymentStatus')

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Asks the server to create a payment for one of the buyer's own orders and hands back the link.
 * Every refusal is worded for a buyer (`paymentErrorMessage`), never a code.
 */
export async function startPesapalPayment(sellerId: string, orderId: string): Promise<PesapalStart> {
  const seller = text(sellerId)
  const order = text(orderId)
  if (!seller || !order) throw new Error('We could not find that order.')

  const response = await startCall({ sellerId: seller, orderId: order })
  const data = response?.data || {}
  const redirectUrl = text(data.redirectUrl)
  if (!isPesapalRedirectUrl(redirectUrl)) {
    throw new Error('Pesapal sent a payment link we do not trust. Please try again.')
  }

  return {
    redirectUrl,
    orderTrackingId: text(data.orderTrackingId),
    reference: text(data.reference),
    amount: Number(data.amount) || 0,
    currency: text(data.currency) || DEFAULT_PESAPAL_CURRENCY,
  }
}

/** Hands the buyer to Pesapal — https, pesapal.com, or we do not go. */
export function goToPesapal(redirectUrl: string): void {
  if (!isPesapalRedirectUrl(redirectUrl)) {
    throw new Error('Pesapal sent a payment link we do not trust.')
  }
  window.location.assign(redirectUrl)
}

function normaliseCheck(data: CheckResponse | undefined): PesapalCheck {
  const raw = data || {}
  const status = (text(raw.status) || 'none') as PesapalPaymentStatus
  const known: PesapalPaymentStatus[] = [
    'initiated', 'completed', 'failed', 'invalid', 'reversed', 'review', 'unknown', 'none',
  ]
  const safe = known.includes(status) ? status : 'unknown'
  return {
    status: safe,
    label: pesapalStatusLabel(safe),
    paid: raw.paid === true,
    orderStatus: raw.orderStatus === undefined ? null : raw.orderStatus,
    amount: typeof raw.amount === 'number' ? raw.amount : null,
    currency: text(raw.currency),
    method: text(raw.method),
    confirmationCode: text(raw.confirmationCode),
    description: text(raw.description),
    pending: raw.pending === true,
  }
}

/**
 * The truth about a payment, from the server — used by the page a buyer returns to, and by any
 * "check my payment" button. Accepts either the reference Pesapal handed back or the order it
 * belongs to.
 */
export async function checkPesapalPayment(input: {
  reference?: string
  sellerId?: string
  orderId?: string
}): Promise<PesapalCheck> {
  const params: CheckRequest = {}
  const reference = text(input?.reference)
  const sellerId = text(input?.sellerId)
  const orderId = text(input?.orderId)
  if (reference) params.reference = reference
  if (sellerId) params.sellerId = sellerId
  if (orderId) params.orderId = orderId
  if (!params.reference && !(params.sellerId && params.orderId)) {
    throw new Error('We do not know which payment to check.')
  }

  const response = await checkCall(params)
  return normaliseCheck(response?.data)
}
