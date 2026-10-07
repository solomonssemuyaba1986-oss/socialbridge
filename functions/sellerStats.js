/**
 * rachett's own measurement of a seller — the math behind the 💎 Reliable Seller badge.
 *
 * Neither number can be produced by the browser: one needs every order the shop received, the
 * other needs the private buyer↔seller threads. So both are computed here, in Cloud Functions,
 * and land in `sellers/{uid}/stats/main`, which `firestore.rules` locks to the server. The app
 * only ever *reads* them.
 *
 *   completion rate — completed orders ÷ every order the shop received
 *   first response  — the gap between a buyer's first message and the seller's first reply,
 *                     folded into a running average (`responseTotalMinutes` / `responsesMeasured`)
 *
 * The *thresholds* the app judges these numbers by live in `src/reliableBadge.ts`; this file owns
 * only the numbers themselves. `_reliable_check.cjs` requires both and proves they agree — a
 * rounding rule that diverges here would silently move the badge line for every shop at once.
 */

/** Kept in step with `src/reliableBadge.ts`. The check harness asserts the two never drift. */
const COMPLETION_PCT = 80
const MAX_RESPONSE_MINUTES = 120

/**
 * Completed orders ÷ all orders, as a whole percent — or `null` when the shop has received no
 * orders, because an empty shop has no completion rate to speak of.
 */
function orderCompletionRate(completed, total) {
  if (!total || total <= 0) return null
  return Math.round((completed / total) * 100)
}

/** How many of these orders reached `fulfilled`. */
function countCompleted(orders) {
  return orders.filter((o) => o && o.status === 'fulfilled').length
}

/**
 * The seller's first reply in one thread, in whole minutes — or `null` when the seller has not
 * replied yet, or spoke first (a message that precedes the buyer's is not a reply).
 *
 * `messages` must be oldest-first, each `{ senderId, atMillis }`.
 */
function firstResponseMinutes(messages, sellerId, buyerId) {
  const buyerFirst = messages.find((m) => m.senderId === buyerId)
  if (!buyerFirst) return null
  const sellerFirst = messages.find((m) => m.senderId === sellerId)
  if (!sellerFirst) return null
  if (sellerFirst.atMillis < buyerFirst.atMillis) return null
  return Math.round((sellerFirst.atMillis - buyerFirst.atMillis) / 60000)
}

/**
 * Fold one freshly measured reply into the running average kept on `stats/main`.
 * `prev` is whatever the document already holds (possibly empty).
 */
function accumulateResponse(prev, minutes) {
  const count = ((prev && prev.responsesMeasured) || 0) + 1
  const total = ((prev && prev.responseTotalMinutes) || 0) + minutes
  return {
    responsesMeasured: count,
    responseTotalMinutes: total,
    avgResponseMinutes: Math.round(total / count),
  }
}

/** Mirrors `meetsReliableCriteria` in `src/reliableBadge.ts`, so the harness can compare behaviour. */
function meetsReliableCriteria(signals) {
  const { realSeller, orderCompletionRate: rate, totalOrders, avgResponseMinutes } = signals
  if (!realSeller) return false
  if (!totalOrders || totalOrders <= 0 || rate === null) return false
  if (rate < COMPLETION_PCT) return false
  if (avgResponseMinutes === null || avgResponseMinutes >= MAX_RESPONSE_MINUTES) return false
  return true
}

module.exports = {
  COMPLETION_PCT,
  MAX_RESPONSE_MINUTES,
  orderCompletionRate,
  countCompleted,
  firstResponseMinutes,
  accumulateResponse,
  meetsReliableCriteria,
}
