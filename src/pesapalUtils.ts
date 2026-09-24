/**
 * rachett — the Pesapal parts a browser is allowed to know.
 *
 * Deliberately pure: no Firebase import, no keys, nothing async, so `_pesapal_check.cjs` can
 * transpile this one file and pin the rules down. `functions/pesapal.js` keeps its own copy of the
 * reference and amount rules, and the harness checks the two agree — a page that promises
 * USh 45,000 while the server charges 45,000.0001 is a support ticket waiting to happen.
 *
 * Pesapal has no browser SDK: the consumer secret is needed for every call, so all of it lives in
 * Cloud Functions (`pesapalService.ts` is the thin door to those). What is left here is what a page
 * may safely do — format a total, name a payment method in plain words, check that a link really
 * is Pesapal before following it, and turn a failure into something a buyer understands.
 */

/** Same two bases the server uses, so a link can be checked against what we expect. */
export const PESAPAL_BASE_URLS = {
  live: 'https://pay.pesapal.com/v3',
  sandbox: 'https://cybqa.pesapal.com/pesapalv3',
} as const

export type PesapalEnvironment = keyof typeof PESAPAL_BASE_URLS

export function pesapalBaseUrl(env?: string): string {
  return env === 'sandbox' ? PESAPAL_BASE_URLS.sandbox : PESAPAL_BASE_URLS.live
}

/**
 * The countries this marketplace actually trades in, UGX first. Which of these your merchant
 * account may charge in is Pesapal's call, not ours — the list lives here so a page can label a
 * currency correctly, not to promise a payment method.
 */
export const PESAPAL_CURRENCIES: Record<string, { name: string; country: string; symbol: string }> = {
  UGX: { name: 'Ugandan Shilling', country: 'UG', symbol: 'USh' },
  KES: { name: 'Kenyan Shilling', country: 'KE', symbol: 'KSh' },
  TZS: { name: 'Tanzanian Shilling', country: 'TZ', symbol: 'TSh' },
  RWF: { name: 'Rwandan Franc', country: 'RW', symbol: 'RF' },
  BIF: { name: 'Burundian Franc', country: 'BI', symbol: 'FBu' },
  SSP: { name: 'South Sudanese Pound', country: 'SS', symbol: 'SSP' },
  USD: { name: 'US Dollar', country: 'US', symbol: '$' },
  EUR: { name: 'Euro', country: 'DE', symbol: '€' },
  GBP: { name: 'British Pound', country: 'GB', symbol: '£' },
}

export const DEFAULT_PESAPAL_CURRENCY = 'UGX'

export function currencyFromCountry(country: string): { code: string; symbol: string } | null {
  const match = Object.entries(PESAPAL_CURRENCIES)
    .find(([, value]) => value.country === country.toUpperCase())
  return match ? { code: match[0], symbol: match[1].symbol } : null
}

/** Pesapal's allowed-character list for a merchant reference, and its length ceiling. */
const MERCHANT_REFERENCE_PATTERN = /^[A-Za-z0-9._:-]+$/
export const MAX_REFERENCE_LENGTH = 50

export function isMerchantReference(value: unknown): boolean {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_REFERENCE_LENGTH
    && MERCHANT_REFERENCE_PATTERN.test(value)
}

export function toMerchantReference(raw: unknown): string {
  return String(raw === null || raw === undefined ? '' : raw)
    .trim()
    .replace(/[^A-Za-z0-9._:-]+/g, '-')
    .slice(0, MAX_REFERENCE_LENGTH)
}

/**
 * Currencies with no minor unit. UGX 45,000 sent as a Float must arrive as 45000, not
 * 45000.00000000001 — the server applies the identical rule before submitting the order.
 */
const ZERO_DECIMAL_CURRENCIES = [
  'UGX', 'TZS', 'RWF', 'BIF', 'XOF', 'XAF', 'JPY', 'KRW', 'VND',
  'CLP', 'ISK', 'PYG', 'GNF', 'KMF', 'DJF', 'VUV',
]

export function toPesapalAmount(amount: unknown, currency?: string): number | null {
  const value = Number(amount)
  if (!Number.isFinite(value) || value <= 0) return null
  const code = String(currency || DEFAULT_PESAPAL_CURRENCY).toUpperCase()
  if (ZERO_DECIMAL_CURRENCIES.includes(code)) return Math.round(value)
  return Math.round(value * 100) / 100
}

/** "45,000" — what will be charged, said the way a buyer reads it. */
export function formatPesapalAmount(amount: unknown, currency?: string): string {
  const value = toPesapalAmount(amount, currency)
  return value === null ? '' : value.toLocaleString('en-US')
}

/**
 * What Pesapal reports back as `payment_method` — CARD, MTN, MPESA, TIGO, Visa, Mastercard — in
 * words a buyer recognises. Unknown values are passed through rather than flattened into "Other",
 * because seeing "Airtel Money" spelled slightly differently beats seeing nothing at all.
 */
export function paymentMethodLabel(method?: string | null): string {
  if (!method) return 'Pesapal'
  const lower = String(method).toLowerCase()
  if (lower.includes('mtn')) return 'MTN MoMo'
  if (lower.includes('airtel')) return 'Airtel Money'
  if (lower.includes('mpesa') || lower.includes('m-pesa')) return 'M-Pesa'
  if (lower.includes('tigo')) return 'Tigo Pesa'
  if (lower.includes('visa') || lower.includes('mastercard') || lower.includes('amex') || lower.includes('card')) {
    return 'Card'
  }
  if (lower.includes('bank')) return 'Bank transfer'
  if (lower.includes('ussd')) return 'USSD'
  if (lower.includes('pesapal')) return 'Pesapal'
  return String(method)
}

export type PesapalPaymentStatus =
  | 'initiated'
  | 'completed'
  | 'failed'
  | 'invalid'
  | 'reversed'
  | 'review'
  | 'unknown'
  | 'none'

const STATUS_LABELS: Record<string, string> = {
  initiated: 'Waiting for you to pay',
  completed: 'Paid',
  failed: 'Payment failed',
  invalid: 'Payment was not completed',
  reversed: 'Payment was reversed',
  review: 'We are checking this payment',
  unknown: 'We could not confirm this payment',
  none: 'No payment yet',
}

/** No `status_code`, no `payment_status_description` — plain words only. */
export function pesapalStatusLabel(status?: string | null): string {
  return STATUS_LABELS[String(status || 'none').toLowerCase()] || 'No payment yet'
}

/**
 * Is this really a link to Pesapal? The redirect URL is followed with `window.location`, so it is
 * checked first: https only, and the host must be pesapal.com itself — never a lookalike, and never
 * a `javascript:` URL that some future mistake might pass in.
 */
export function isPesapalRedirectUrl(url: unknown): boolean {
  if (typeof url !== 'string' || !url.trim()) return false
  let parsed: URL
  try {
    parsed = new URL(url.trim())
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:') return false
  const host = parsed.hostname.toLowerCase()
  return host === 'pesapal.com' || host.endsWith('.pesapal.com')
}

export type PesapalReturn = {
  orderTrackingId: string
  reference: string
  cancelled: boolean
}

/**
 * What Pesapal appends to the callback URL. It carries **no** payment status — Pesapal is explicit
 * about that — so this only identifies *which* payment to ask the server about.
 */
export function paymentReturnFromQuery(
  query: Record<string, unknown> | null | undefined
): PesapalReturn {
  const raw = query || {}
  const pick = (key: string): string => {
    const value = raw[key]
    if (typeof value === 'string') return value.trim()
    if (Array.isArray(value) && typeof value[0] === 'string') return value[0].trim()
    return ''
  }
  return {
    orderTrackingId: pick('OrderTrackingId'),
    reference: pick('OrderMerchantReference'),
    cancelled: pick('cancelled') === '1',
  }
}

/** Shown verbatim until the keys are set — the same courtesy the old Flutterwave wrapper had. */
export const PAYMENT_NOT_CONFIGURED_MESSAGE = 'Payment is not configured yet. Contact support.'

function errorParts(err: unknown): { code: string; message: string } {
  const e = err as { code?: unknown; message?: unknown } | null
  const code = typeof e?.code === 'string' ? e.code.replace(/^functions\//, '') : ''
  const message = typeof e?.message === 'string' ? e.message.replace(/^Firebase:\s*/i, '').trim() : ''
  return { code, message }
}

export function isPaymentNotConfiguredError(err: unknown): boolean {
  const { code, message } = errorParts(err)
  if (code !== 'failed-precondition') return false
  return message.toLowerCase().includes('not configured')
}

/**
 * Every way a payment can refuse to start, said in plain words. The seller's own wording is kept
 * when the server had something specific to say (an already-paid order, a missing price).
 */
export function paymentErrorMessage(err: unknown): string {
  const { code, message } = errorParts(err)
  if (isPaymentNotConfiguredError(err)) return PAYMENT_NOT_CONFIGURED_MESSAGE
  switch (code) {
    case 'unauthenticated':
      return 'Sign in to pay for this order.'
    case 'permission-denied':
      return 'That order belongs to someone else.'
    case 'not-found':
      return 'We could not find that order.'
    case 'invalid-argument':
      return message || 'We could not start that payment.'
    case 'failed-precondition':
      return message || 'This order cannot be paid right now.'
    case 'unavailable':
      return 'We could not reach the payment service. Check your internet and try again.'
    default:
      return message || 'We could not start that payment. Please try again.'
  }
}
