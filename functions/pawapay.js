/**
 * pawaPay — mobile money, server-side only.
 *
 * Why this sits next to `pesapal.js` instead of replacing it: Pesapal hands the buyer a page and
 * chooses the payment methods *itself*, which is fine for a card and useless for a wallet. pawaPay
 * is the opposite — one call pushes a PIN prompt to the buyer's own phone, nothing is redirected,
 * and the network that pays is ours to choose. So: **cards to Pesapal, mobile money to pawaPay.**
 *
 * The rules this file lives by:
 *   1. The token never leaves here; it comes from a secret, never from a request.
 *   2. sandbox vs live is ONE switch (`PAWAPAY_ENV`), never a code change. It defaults to sandbox,
 *      because a missing variable must never be able to move real money — and going live is the
 *      same code with a different token and one word.
 *   3. `depositId` is ours and fresh per attempt, which is what makes the call idempotent: a retry
 *      comes back `DUPLICATE_IGNORED` instead of charging the buyer twice.
 *   4. The amount comes from the order document. Provider codes are read from the account's own
 *      `activeConfiguration` — never guessed, never hardcoded per country.
 *   5. A final status only ever comes from pawaPay: a signed callback, or our own status check.
 */
const rules = require('./pawapayRules')
const { toAmountString } = require('./money')

/** pawaPay's own two servers, from their OpenAPI. The ONLY difference between sandbox and live. */
const SANDBOX_BASE = 'https://api.sandbox.pawapay.io'
const LIVE_BASE = 'https://api.pawapay.io'

/** Verified against the v2 reference — note `active-conf` and `public-key/http` are not what you'd guess. */
const ENDPOINTS = {
  activeConfiguration: '/v2/active-conf',
  predictProvider: '/v2/predict-provider',
  publicKeys: '/v2/public-key/http',
  deposits: '/v2/deposits',
  walletBalances: '/v2/wallet-balances',
}

const depositStatusPath = (depositId) => `/v2/deposits/${encodeURIComponent(rules.text(depositId))}`
const resendDepositCallbackPath = (depositId) => `${depositStatusPath(depositId)}/callback`

class PawapayError extends Error {
  constructor(message, details) {
    super(message)
    this.name = 'PawapayError'
    this.details = details || null
  }
}

/** Only the exact word `live` means live: a typo must fail towards sandbox, never towards money. */
function isLive(env) {
  return String(env === null || env === undefined ? '' : env).trim().toLowerCase() === 'live'
}

function baseUrl(env) {
  return isLive(env) ? LIVE_BASE : SANDBOX_BASE
}

function isConfigured(credentials) {
  return Boolean(rules.text(credentials && credentials.apiToken))
}

/** pawaPay's error shape: `{ status, failureReason: { failureCode, failureMessage } }`. */
function failureOf(payload) {
  const reason = (payload && payload.failureReason) || {}
  return {
    code: rules.text(reason.failureCode),
    message: rules.text(reason.failureMessage) || rules.text(payload && payload.message),
  }
}

async function call(env, path, options) {
  const o = options || {}
  if (!isConfigured(o)) throw new PawapayError('pawaPay is not configured yet.')

  const url = `${baseUrl(env)}${path}`
  const headers = Object.assign(
    { Authorization: `Bearer ${rules.text(o.apiToken)}`, Accept: 'application/json' },
    o.body ? { 'Content-Type': 'application/json; charset=UTF-8' } : {},
    o.headers || {}
  )

  let response
  try {
    response = await fetch(url, {
      method: o.method || 'GET',
      headers,
      body: o.body ? JSON.stringify(o.body) : undefined,
    })
  } catch (err) {
    throw new PawapayError('We could not reach pawaPay. Try again.', { cause: String(err && err.message) })
  }

  const raw = await response.text()
  let payload = null
  try { payload = raw ? JSON.parse(raw) : null } catch { payload = null }

  if (!response.ok) {
    const failure = failureOf(payload)
    throw new PawapayError(failure.message || `pawaPay refused that request (${response.status}).`, {
      httpStatus: response.status,
      code: failure.code,
    })
  }
  return payload
}

/**
 * Everything our account can actually do: the providers and currencies enabled for us, the deposit
 * limits, whether a provider takes decimals, each provider's live status, and the callback URL
 * registered for every operation type. This is the source of truth behind "can this seller be paid
 * on MTN?" — never a table somebody typed by hand, and never a promise we cannot keep.
 */
async function activeConfiguration(options) {
  const o = options || {}
  const country = rules.text(o.country).toUpperCase()
  const query = country ? `?country=${encodeURIComponent(country)}` : ''
  return call(o.env, `${ENDPOINTS.activeConfiguration}${query}`, { apiToken: o.apiToken })
}

/**
 * Which network owns a phone number — and, just as usefully, pawaPay's own properly formatted
 * MSISDN back (`predictedMsisdnValue`): the number is normalised by the network that has to accept
 * it rather than by our own guess. (Their average misprediction rate is 0.12%.)
 */
async function predictProvider(options) {
  const o = options || {}
  const msisdn = rules.sanitiseMsisdn(o.phoneNumber)
  if (!rules.isMsisdn(msisdn)) throw new PawapayError('That is not a full international phone number.')
  const payload = await call(o.env, ENDPOINTS.predictProvider, {
    method: 'POST',
    apiToken: o.apiToken,
    body: { phoneNumber: msisdn },
  })
  const predicted = rules.text(payload && (payload.predictedMsisdnValue || payload.msisdn || payload.predictedMsisdn))
  return {
    provider: rules.text(payload && payload.provider),
    msisdn: predicted || msisdn,
    country: rules.text(payload && payload.country).toUpperCase(),
    raw: payload,
  }
}

/** The key that proves a callback is really pawaPay's (see `pawapaySignatures.js`). */
async function getPublicKeys(options) {
  const o = options || {}
  return call(o.env, ENDPOINTS.publicKeys, { apiToken: o.apiToken })
}

/**
 * Ask a buyer's wallet for the money. The prompt lands on their phone; nothing is redirected.
 *
 * `depositId` is ours and fresh per attempt, which is what makes this safe to retry: a second call
 * with the same id comes back `DUPLICATE_IGNORED` instead of charging the buyer twice. The amount
 * comes from the order document, never from the browser that asked.
 */
async function initiateDeposit(options) {
  const o = options || {}
  if (!rules.isDepositId(o.depositId)) throw new PawapayError('That deposit id cannot be sent to pawaPay.')
  if (!rules.text(o.currency)) throw new PawapayError('That order has no currency.')
  const amount = toAmountString(o.amount, o.currency)
  if (!amount) throw new PawapayError('That order has no amount we can charge.')
  if (!rules.isProviderCode(o.provider)) throw new PawapayError('That payment network is not one we can route to.')
  const phoneNumber = rules.sanitiseMsisdn(o.phoneNumber)
  if (!rules.isMsisdn(phoneNumber)) throw new PawapayError('That order has no usable phone number to prompt.')
  const statement = rules.text(o.customerMessage).slice(0, 100)

  const payload = await call(o.env, ENDPOINTS.deposits, {
    method: 'POST',
    apiToken: o.apiToken,
    body: Object.assign(
      {
        depositId: o.depositId,
        amount,
        currency: String(o.currency).toUpperCase(),
        payer: { type: 'MMO', address: { provider: o.provider, phoneNumber } },
      },
      statement ? { customerMessage: statement } : {},
      Array.isArray(o.metadata) && o.metadata.length ? { metadata: o.metadata.slice(0, 10) } : {}
    ),
  })

  return {
    raw: payload,
    depositId: o.depositId,
    reading: rules.mapDepositStatus(payload && payload.status),
    failureWords: rules.depositFailureWords(payload),
  }
}

/** What actually happened — the check that keeps us honest when a callback never arrives. */
async function checkDepositStatus(options) {
  const o = options || {}
  if (!rules.isDepositId(o.depositId)) throw new PawapayError('That deposit id is not one of ours.')
  const payload = await call(o.env, depositStatusPath(o.depositId), { apiToken: o.apiToken })
  return {
    raw: payload,
    reading: rules.mapDepositStatus(payload && payload.status),
    failureWords: rules.depositFailureWords(payload),
  }
}

/** Ask pawaPay to send a callback again (allowed for 90 days) — for a delivery we missed. */
async function resendDepositCallback(options) {
  const o = options || {}
  if (!rules.isDepositId(o.depositId)) throw new PawapayError('That deposit id is not one of ours.')
  return call(o.env, resendDepositCallbackPath(o.depositId), { method: 'POST', apiToken: o.apiToken })
}

/** Our float, per currency — the balance that has to be topped up before payouts can go out. */
async function walletBalances(options) {
  const o = options || {}
  return call(o.env, ENDPOINTS.walletBalances, { apiToken: o.apiToken })
}

module.exports = {
  PawapayError,
  ENDPOINTS,
  SANDBOX_BASE,
  LIVE_BASE,
  isLive,
  baseUrl,
  isConfigured,
  failureOf,
  call,
  depositStatusPath,
  resendDepositCallbackPath,
  toAmountString,
  activeConfiguration,
  predictProvider,
  getPublicKeys,
  initiateDeposit,
  checkDepositStatus,
  resendDepositCallback,
  walletBalances,
}
