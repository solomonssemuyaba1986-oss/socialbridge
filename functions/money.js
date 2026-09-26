/**
 * What an amount is worth, for every processor we speak to.
 *
 * `orderAmount.js` decides what an *order* costs, read from the order document. This decides how
 * that number is allowed to travel. Pesapal and pawaPay need the same answer, and the one thing
 * that must never happen is the two rounding differently — a shilling lost to a rounding rule is a
 * payment flagged for a human to sort out.
 *
 * Zero-decimal currencies (UGX, TZS, RWF, BIF, XAF, XOF, DJF, KMF…) have no minor unit at all.
 * Sending "45000.00" where "45000" is meant is the classic floating-point bug: 45000.00000000001.
 *
 * It lives in its own file because `pawapay.js` and `pesapal.js` both need it and neither owns it —
 * and because `_payments_check.cjs` can then pin the two implementations together.
 */

const ZERO_DECIMAL_CURRENCIES = [
  'UGX', 'TZS', 'RWF', 'BIF', 'XOF', 'XAF', 'JPY', 'KRW', 'VND',
  'CLP', 'ISK', 'PYG', 'GNF', 'KMF', 'DJF', 'VUV',
]

function isZeroDecimalCurrency(currency) {
  return ZERO_DECIMAL_CURRENCIES.includes(String(currency || '').toUpperCase())
}

/** The amount as a number worth sending: whole units where the currency has no minor unit. */
function toAmount(amount, currency) {
  const value = Number(amount)
  if (!Number.isFinite(value) || value <= 0) return null
  if (isZeroDecimalCurrency(currency)) return Math.round(value)
  return Math.round(value * 100) / 100
}

/**
 * The same amount as a string — pawaPay takes `amount` as a string ("15000"), and takes no
 * decimals at all on providers that do not support them (which is most mobile money).
 */
function toAmountString(amount, currency) {
  const value = toAmount(amount, currency)
  return value === null ? null : String(value)
}

module.exports = { ZERO_DECIMAL_CURRENCIES, isZeroDecimalCurrency, toAmount, toAmountString }
