/**
 * pawaPay's rules, in the smallest possible form — no network, no keys, no Firebase.
 *
 * Everything here is decidable from a string, which is why it is a separate file: the harness
 * (`_payments_check.cjs`) can then test the whole vocabulary without a sandbox account, and the
 * buyer-facing words for every failure live in exactly one place.
 *
 * Verified against pawaPay's Merchant API v2 reference (deposits, callbacks, failure codes).
 */

/** Our payment vocabulary — the same one `pesapal.js` and the client already speak. */
const OUR_STATUSES = ['initiated', 'completed', 'failed', 'invalid', 'reversed', 'review', 'unknown', 'none']

const DEPOSIT_LABELS = {
  initiated: 'Waiting for you to pay',
  completed: 'Paid',
  failed: 'Payment failed',
  invalid: 'Payment was not completed',
  reversed: 'Payment was reversed',
  review: 'We are checking this payment',
  unknown: 'We are checking this payment',
  none: 'No payment yet',
}

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * What pawaPay's deposit status means to us.
 *
 * Returns `null` for `DUPLICATE_IGNORED`: that is not a status, it is pawaPay saying "I have seen
 * this `depositId` before" — a retry that must leave whatever we already knew untouched.
 *
 * `final: false` matters as much as the status: SUBMITTED is still moving, and UNKNOWN_ERROR
 * explicitly means *"check the status of this payment over API before considering failed"* — so a
 * buyer is never told their payment failed while it may still be completing.
 */
function mapDepositStatus(raw) {
  const status = text(raw).toUpperCase()
  if (status === 'DUPLICATE_IGNORED') return null
  if (status === 'COMPLETED') return { status: 'completed', final: true, label: DEPOSIT_LABELS.completed }
  if (status === 'FAILED' || status === 'REJECTED') {
    return { status: 'failed', final: true, label: DEPOSIT_LABELS.failed }
  }
  if (status === 'ACCEPTED' || status === 'SUBMITTED') {
    return { status: 'initiated', final: false, label: DEPOSIT_LABELS.initiated }
  }
  // UNKNOWN_ERROR lands here on purpose: not final, and we keep checking.
  return { status: 'unknown', final: false, label: DEPOSIT_LABELS.unknown }
}

/**
 * Why a deposit failed, in words a buyer can act on.
 *
 * Codes and meanings come from pawaPay's failure-code table. Anything unrecognised gets an honest
 * sentence rather than a shrug — and never a raw code.
 */
const FAILURE_WORDS = {
  PAYER_NOT_FOUND: 'That phone number is not registered with this network.',
  RECIPIENT_NOT_FOUND: 'That phone number does not belong to this network.',
  PAYER_LIMIT_REACHED: 'That wallet has reached its limit with the network.',
  WALLET_LIMIT_REACHED: 'That wallet has reached its limit.',
  PAYMENT_NOT_APPROVED: 'The payment was not approved on the phone.',
  INSUFFICIENT_BALANCE: 'There is not enough money in that wallet.',
  UNSPECIFIED_FAILURE: 'The network did not say why it failed.',
  UNKNOWN_ERROR: 'We are still checking what happened with that payment.',
  AMOUNT_OUT_OF_BOUNDS: 'That amount is outside what this network allows.',
  AMOUNT_TOO_LARGE: 'That amount is more than this network allows at once.',
  PROVIDER_UNAVAILABLE: 'That network is having trouble right now. Try again shortly.',
  PROVIDER_TEMPORARILY_UNAVAILABLE: 'That network is having trouble right now. Try again shortly.',
  DEPOSITS_NOT_ALLOWED: 'This network is not set up to take payments yet.',
  AUTHORISATION_ERROR: 'This network is not set up to take payments yet.',
  INVALID_MSISDN: 'Check that phone number and try again.',
  INVALID_PARAMETER: 'Check that phone number and try again.',
}

function failureCodeFrom(source) {
  const s = source || {}
  const reason = s.failureReason || s
  return text(reason && reason.failureCode)
}

function depositFailureWords(source) {
  const code = failureCodeFrom(source)
  return FAILURE_WORDS[code] || 'The payment did not go through. Try another way.'
}

/**
 * Digits only, no "+", no trunk zero — pawaPay's rule, verbatim: *"Only digits without whitespaces
 * or any other separators or prefixes like '+'. Should not start with zero. Country code is
 * mandatory."* So `+256 771 234 567` and `0771 234 567` both become `256771234567`.
 */
function sanitiseMsisdn(raw) {
  const digits = String(raw === null || raw === undefined ? '' : raw).replace(/\D/g, '')
  return digits.startsWith('0') ? digits.slice(1) : digits
}

/** Country code first, 8–15 digits, and never a leading zero — a trunk zero means a half-typed number. */
function isMsisdn(value) {
  const digits = text(value)
  return /^\d{8,15}$/.test(digits) && !digits.startsWith('0')
}

/**
 * Provider codes look like `MTN_MOMO_UGA`, `AIRTEL_OAPI_UGA`, `VODACOM_TZA`. They are never
 * invented here — they are read from the account's own `activeConfiguration`, because pawaPay's
 * naming is not even consistent between markets (`AIRTEL_OAPI_UGA` but `AIRTEL_TZA`).
 */
function isProviderCode(value) {
  return /^[A-Z0-9_]{3,32}$/.test(text(value))
}

/** Our idempotency key — a fresh one per attempt, so a retry can never charge twice. */
function buildDepositId(crypto) {
  const c = crypto || require('crypto')
  return c.randomUUID()
}

/** The rules for a `depositId` — ours to make, so ours to check. */
function isDepositId(value) {
  const id = text(value)
  if (id.length < 8 || id.length > 64) return false
  if (!/^[A-Za-z0-9._:-]+$/.test(id)) return false
  // A collision would be silent, so the shape has to be deliberate rather than accidental.
  return id.includes('-') || id.includes(':') || id.includes('.')
}

/**
 * The callback, read once, into something flat enough to reason about.
 *
 * Deliberately loose: pawaPay promises backwards compatibility and may add fields, so nothing here
 * fails on an unexpected key. It reads both places the payer details have appeared in their docs
 * (`payer.accountDetails` in a callback, `payer.address` in a request).
 */
function depositCallbackFrom(body) {
  const b = body || {}
  const payer = b.payer || {}
  const details = payer.accountDetails || {}
  const address = details.provider ? details : (payer.address || {})
  return {
    depositId: text(b.depositId),
    rawStatus: text(b.status).toUpperCase(),
    amount: text(b.amount) || text(b.requestedAmount),
    currency: text(b.currency).toUpperCase(),
    country: text(b.country).toUpperCase(),
    provider: text(address.provider),
    phoneNumber: text(address.phoneNumber),
    providerTransactionId: text(b.providerTransactionId),
    created: text(b.created),
  }
}

module.exports = {
  OUR_STATUSES,
  DEPOSIT_LABELS,
  FAILURE_WORDS,
  text,
  mapDepositStatus,
  failureCodeFrom,
  depositFailureWords,
  sanitiseMsisdn,
  isMsisdn,
  isProviderCode,
  buildDepositId,
  isDepositId,
  depositCallbackFrom,
}
