/**
 * What an order actually costs, read the same way the app reads it.
 *
 * `parsePrice` and `clampQty` in `src/productSheetUtils.ts` are the buyer-facing versions of these
 * rules: a seller types "45000", "45,000", sometimes "UGX 45,000", and the details sheet shows
 * "2 × 45,000 = 90,000". Cloud Functions cannot import from `src/`, so the rules are repeated here
 * in their smallest form — and `_pesapal_check.cjs` pins them down, because this is the number that
 * gets submitted to Pesapal, computed from the *order document* on the server and never from
 * anything a browser sent.
 */

/** A price as a number, or null when it isn't one. Mirrors `parsePrice`. */
function parseOrderPrice(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? raw : null
  if (typeof raw !== 'string') return null
  const cleaned = raw.replace(/[^\d.]/g, '')
  if (!cleaned || !/\d/.test(cleaned)) return null
  const value = Number(cleaned)
  return Number.isFinite(value) && value > 0 ? value : null
}

/**
 * unit × quantity, with the same 1–99 ceiling as the details sheet. `null` when the price cannot be
 * trusted — an order whose price we cannot read must be refused, never charged as a guess.
 */
function orderTotal(order) {
  const unit = parseOrderPrice(order && order.productPrice)
  if (unit === null) return null
  const digits = String((order && order.quantity) || '').replace(/[^\d]/g, '')
  const wanted = Math.floor(Number(digits) || 1)
  const quantity = Math.min(Math.max(1, wanted), 99)
  return { unit, quantity, total: unit * quantity }
}

module.exports = { parseOrderPrice, orderTotal }
