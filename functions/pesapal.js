/**
 * rachett — Pesapal API 3.0, server-side only.
 *
 * Pesapal has no browser SDK: every call needs the merchant consumer secret, so the whole
 * integration lives here and the app only ever talks to the Cloud Functions that wrap it
 * (`pesapalStartPayment`, `pesapalIpn`, `pesapalPaymentStatus`). No key ever reaches the browser.
 *
 *   token ─▶ register the IPN ─▶ submit the order ─▶ buyer pays on Pesapal
 *                                                          │
 *                          IPN  +  GetTransactionStatus ───┘   ← the only truth about a payment
 *
 * Neither the callback URL nor the IPN carries a payment status — Pesapal says so explicitly —
 * so every decision is made from `getTransactionStatus`, never from what arrived in a URL.
 *
 * Docs: https://developer.pesapal.com/how-to-integrate/e-commerce/api-30-json/api-reference
 * Live: https://pay.pesapal.com/v3 · Sandbox: https://cybqa.pesapal.com/pesapalv3
 *
 * The pure helpers near the bottom are the ones `_pesapal_check.cjs` pins down, because each is a
 * way to lose money quietly if it is ever wrong.
 */
const crypto = require('crypto')

const BASE_URLS = {
  live: 'https://pay.pesapal.com/v3',
  sandbox: 'https://cybqa.pesapal.com/pesapalv3',
}

/** Pesapal tokens expire after 5 minutes; we stop using ours after 4. */
const TOKEN_TTL_MS = 4 * 60 * 1000
const REQUEST_TIMEOUT_MS = 20 * 1000

/** `status_code` is the safe thing to switch on; `payment_status_description` is prose. */
const STATUS_BY_CODE = {
  0: { status: 'invalid', orderStatus: null, paid: false },
  1: { status: 'completed', orderStatus: 'paid', paid: true },
  2: { status: 'failed', orderStatus: null, paid: false },
  3: { status: 'reversed', orderStatus: null, paid: false },
}

/**
 * Pesapal's `amount` is a Float, but these currencies have no minor unit — sending UGX 45000 as
 * "45000.000000000001" is the kind of thing that gets a payment rejected. (The client's
 * `toPesapalAmount` in `src/pesapalUtils.ts` is the same rule, and the harness checks they agree.)
 */
const ZERO_DECIMAL_CURRENCIES = [
  'UGX', 'TZS', 'RWF', 'BIF', 'XOF', 'XAF', 'JPY', 'KRW', 'VND',
  'CLP', 'ISK', 'PYG', 'GNF', 'KMF', 'DJF', 'VUV',
]

/** Pesapal's own allowed-character list for a merchant reference, at most 50 characters. */
const MERCHANT_REFERENCE_PATTERN = /^[A-Za-z0-9._:-]+$/
const MAX_REFERENCE_LENGTH = 50

class PesapalError extends Error {
  constructor(message, details) {
    super(message)
    this.name = 'PesapalError'
    this.details = details || null
  }
}

function baseUrl(env) {
  return BASE_URLS[env] || BASE_URLS.live
}

/** Are the keys we need actually present? (Never logs or returns them.) */
function isConfigured(credentials) {
  const c = credentials || {}
  return Boolean(c.consumerKey && c.consumerSecret)
}

/**
 * One HTTP call, with the two things Pesapal does that surprise people: an error can arrive inside
 * a 200 body as `{ error: { message } }`, and a non-JSON answer must never look like success.
 */
async function call(env, path, options) {
  const opts = options || {}
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  let response
  let text
  try {
    response = await fetch(`${baseUrl(env)}${path}`, {
      method: opts.method || 'GET',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      },
      ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
      signal: controller.signal,
    })
    text = await response.text()
  } catch (err) {
    throw new PesapalError(
      err && err.name === 'AbortError'
        ? 'Pesapal took too long to answer. Please try again.'
        : 'We could not reach Pesapal. Please try again.',
      err
    )
  } finally {
    clearTimeout(timer)
  }

  let payload = null
  try {
    payload = text ? JSON.parse(text) : null
  } catch (err) {
    payload = null
  }
  if (!payload) {
    throw new PesapalError('Pesapal sent an answer we could not read.')
  }
  if (payload.error && (payload.error.message || payload.error.description)) {
    throw new PesapalError(describePesapalError(payload), payload.error)
  }
  if (!response.ok) {
    throw new PesapalError(describePesapalError(payload), payload)
  }
  return payload
}

const tokenCache = new Map()

/** A fresh bearer token, reused for four minutes so a burst of calls makes one request. */
async function getToken(credentials) {
  const c = credentials || {}
  if (!isConfigured(c)) throw new PesapalError('Pesapal keys are not configured yet.')

  const cacheKey = `${c.env || 'live'}:${c.consumerKey}`
  const cached = tokenCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.token

  const payload = await call(c.env, '/api/Auth/RequestToken', {
    method: 'POST',
    body: { consumer_key: c.consumerKey, consumer_secret: c.consumerSecret },
  })
  if (!payload.token) throw new PesapalError('Pesapal did not return an access token.')

  tokenCache.set(cacheKey, { token: payload.token, expiresAt: Date.now() + TOKEN_TTL_MS })
  return payload.token
}

/**
 * Register (or re-register) the URL Pesapal alerts server-to-server. Run once per environment:
 * the returned `ipn_id` is what `SubmitOrderRequest` needs as `notification_id`. Pesapal's IPs
 * cannot be whitelisted, so the URL just has to be publicly reachable.
 */
async function registerIpn(options) {
  const o = options || {}
  if (!o.url || !/^https:\/\//i.test(o.url)) throw new PesapalError('The IPN URL must be https.')
  const token = await getToken(o)
  return call(o.env, '/api/URLSetup/RegisterIPN', {
    method: 'POST',
    token,
    body: { url: o.url, ipn_notification_type: o.method === 'GET' ? 'GET' : 'POST' },
  })
}

/** What is already registered, so nobody has to wonder whether the IPN is set up. */
async function listIpns(credentials) {
  const token = await getToken(credentials)
  return call((credentials || {}).env, '/api/URLSetup/GetIpnList', { token })
}

/**
 * Create the payment and get the link to send the buyer to. `id` is our own reference and must be
 * unique for every order request — we make a fresh one per attempt (`buildPaymentReference`). The
 * amount is computed on the server from the order document, never from anything the browser said.
 */
async function submitOrder(options) {
  const o = options || {}
  if (!isMerchantReference(o.id)) {
    throw new PesapalError('That order reference cannot be sent to Pesapal.')
  }
  if (!Number.isFinite(o.amount) || o.amount <= 0) {
    throw new PesapalError('That order has no amount we can charge.')
  }
  if (!o.currency) throw new PesapalError('That order has no currency.')
  if (!o.callbackUrl) throw new PesapalError('That order has no return link.')
  if (!o.notificationId) {
    throw new PesapalError('Payments are not finished being set up yet. Contact support.')
  }

  const token = await getToken(o)
  const payload = await call(o.env, '/api/Transactions/SubmitOrderRequest', {
    method: 'POST',
    token,
    body: {
      id: o.id,
      currency: String(o.currency).toUpperCase(),
      amount: o.amount,
      description: String(o.description || 'rachett order').slice(0, 100),
      callback_url: o.callbackUrl,
      ...(o.cancellationUrl ? { cancellation_url: o.cancellationUrl } : {}),
      notification_id: o.notificationId,
      redirect_mode: 'TOP_WINDOW',
      billing_address: o.billing || {},
    },
  })
  if (!payload.redirect_url || !payload.order_tracking_id) {
    throw new PesapalError('Pesapal did not return a payment link.')
  }
  return payload
}

/** The status of a transaction. This — and only this — says whether money arrived. */
async function getTransactionStatus(options) {
  const o = options || {}
  const id = String(o.orderTrackingId || '').trim()
  if (!id) throw new PesapalError('A payment tracking id is required.')
  const token = await getToken(o)
  return call(o.env, `/api/Transactions/GetTransactionStatus?orderTrackingId=${encodeURIComponent(id)}`, { token })
}

// ─── pure helpers — no network, no keys ───────────────────────────────────────────────────────

/** Is this reference something Pesapal will accept as `id`? */
function isMerchantReference(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_REFERENCE_LENGTH
    && MERCHANT_REFERENCE_PATTERN.test(value)
}

/** A reference Pesapal will accept — spaces, `@`, `#`, `/` and friends all become `-`. */
function toMerchantReference(raw) {
  return String(raw === null || raw === undefined ? '' : raw)
    .trim()
    .replace(/[^A-Za-z0-9._:-]+/g, '-')
    .slice(0, MAX_REFERENCE_LENGTH)
}

/** One fresh reference per payment attempt: `RT-M7XK4Q-9F3A`. */
function buildPaymentReference() {
  const stamp = Date.now().toString(36).toUpperCase()
  const random = crypto.randomBytes(2).toString('hex').toUpperCase()
  return `RT-${stamp}-${random}`
}

/** UGX and friends go out as whole shillings; anything with a minor unit keeps two decimals. */
function toPesapalAmount(amount, currency) {
  const value = Number(amount)
  if (!Number.isFinite(value) || value <= 0) return null
  const code = String(currency || 'UGX').toUpperCase()
  if (ZERO_DECIMAL_CURRENCIES.includes(code)) return Math.round(value)
  return Math.round(value * 100) / 100
}

/**
 * The IPN arrives as a GET query or a POST body, depending on how the URL was registered — both
 * are accepted here, and a call without a tracking id is refused rather than guessed at.
 */
function parseIpnParams(source) {
  const raw = source && typeof source === 'object' ? source : {}
  const orderTrackingId = String(raw.OrderTrackingId || raw.orderTrackingId || '').trim()
  const merchantReference = String(raw.OrderMerchantReference || raw.orderMerchantReference || '').trim()
  const notificationType = String(raw.OrderNotificationType || raw.orderNotificationType || '').trim()
  if (!orderTrackingId) throw new PesapalError('The IPN is missing OrderTrackingId.')
  if (!merchantReference) throw new PesapalError('The IPN is missing OrderMerchantReference.')
  return {
    orderTrackingId,
    merchantReference,
    notificationType: notificationType || 'IPNCHANGE',
  }
}

/** What a Pesapal status means for our own order. A code we don't know is never "paid". */
function mapPesapalStatus(payload) {
  const raw = payload && typeof payload === 'object' ? payload : {}
  const code = Number(raw.status_code)
  const known = STATUS_BY_CODE[code]
  const description = String(raw.payment_status_description || '')
  if (known) return { ...known, code: Number.isFinite(code) ? code : null, description }
  return {
    status: 'unknown',
    orderStatus: null,
    paid: false,
    code: Number.isFinite(code) ? code : null,
    description,
  }
}

/**
 * Did they pay what this order actually costs? A completed payment for the wrong amount or the
 * wrong currency is not our order being paid — it is something a person must look at.
 */
function amountMatches(expected, payload) {
  const want = Number(expected && expected.amount)
  const got = Number(payload && payload.amount)
  if (!Number.isFinite(want) || !Number.isFinite(got)) return false
  if (Math.abs(want - got) > 0.009) return false

  const wantCurrency = String((expected && expected.currency) || '').toUpperCase()
  const gotCurrency = String((payload && payload.currency) || '').toUpperCase()
  if (!wantCurrency || !gotCurrency) return false
  return wantCurrency === gotCurrency
}

/** The exact JSON string Pesapal expects back from an IPN — all four keys, status 200 or 500. */
function ipnResponse(result) {
  const r = result || {}
  return JSON.stringify({
    orderNotificationType: 'IPNCHANGE',
    orderTrackingId: r.orderTrackingId || '',
    orderMerchantReference: r.merchantReference || '',
    status: r.ok ? 200 : 500,
  })
}

/** The message inside Pesapal's `error` object, or an honest fallback. */
function describePesapalError(payload) {
  const err = payload && payload.error
  if (err && typeof err.message === 'string' && err.message.trim()) return err.message.trim()
  if (err && typeof err.description === 'string' && err.description.trim()) return err.description.trim()
  if (payload && typeof payload.message === 'string' && payload.message.trim()) return payload.message.trim()
  return 'Pesapal did not accept that request. Please try again.'
}

module.exports = {
  BASE_URLS,
  MAX_REFERENCE_LENGTH,
  PesapalError,
  baseUrl,
  isConfigured,
  getToken,
  registerIpn,
  listIpns,
  submitOrder,
  getTransactionStatus,
  isMerchantReference,
  toMerchantReference,
  buildPaymentReference,
  toPesapalAmount,
  parseIpnParams,
  mapPesapalStatus,
  amountMatches,
  ipnResponse,
  describePesapalError,
}
