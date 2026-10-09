/**
 * rachett's own measurement of a seller — the math behind the 💎 Reliable Seller badge and the ⭐
 * rating every card shows.
 *
 * None of these numbers can be produced by the browser: one needs every order the shop received,
 * one needs the private buyer↔seller threads, one needs every comment the shop has received. So
 * all three are computed here, in Cloud Functions. The first two land in
 * `sellers/{uid}/stats/main`; the rating lands on `sellers/{uid}` itself, the document every card
 * already reads. `firestore.rules` refuses all of these keys from a browser, so the app only ever
 * *reads* them.
 *
 *   completion rate — completed orders ÷ every order the shop received
 *   first response  — the gap between a buyer's first message and the seller's first reply,
 *                     folded into a running average (`responseTotalMinutes` / `responsesMeasured`)
 *   shop rating     — every comment the shop has received, 1–5 stars, averaged
 *
 * The *thresholds* the app judges these numbers by live in `src/reliableBadge.ts`; this file owns
 * only the numbers themselves. `_reliable_check.cjs` requires both and proves they agree — a
 * rounding rule that diverges here would silently move the badge line for every shop at once.
 *
 * The rating's own ruler is `src/reviewUtils.ts` — the star a buyer writes (`Review.score`), and the
 * table an older comment's reaction is read through — and `src/sellerRatingUtils.ts` (how the two
 * fields are read and shown). `_ratings_check.cjs` compares all three, because a scoring change on
 * one side would re-rate every shop on rachett at once.
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

/* ── ⭐ The shop rating — what every comment on every product adds up to ─────────────────────────
 *
 * A rating is one tap on a star, and the star *is* the score: a whole number from 1 to 5, counted
 * exactly as the buyer tapped it. Nothing is translated on the way in — that is the whole point of
 * stars — so the number written by `src/reviewUtils.ts` (`useProductReviews.postReview`), the number
 * the product's own `reviewScoreSum` is moved by, and the number counted here are one and the same.
 * `_ratings_check.cjs` requires that.
 *
 * Comments written before stars existed carry a tapped reaction instead. Those are read through the
 * legacy table below and nothing else: love was always worth 5, fine 3, bad 1, so **no shop's
 * average moves** because the interface changed, and no comment has to be rewritten. New comments
 * never write `reaction` at all.
 */
const STAR_MIN = 1
const STAR_MAX = 5
const LEGACY_REACTION_SCORES = { love: 5, fine: 3, bad: 1 }

/** Is this a rating at all? A whole star from 1 to 5 — not 0, not 4.5, not "5", not 900. */
function isStar(value) {
  return typeof value === 'number' && Number.isInteger(value) && value >= STAR_MIN && value <= STAR_MAX
}

/**
 * One comment's score, or `null` when it cannot be read at all.
 *
 * The stored `score` wins over the reaction: it is what the product's `reviewScoreSum` was moved
 * by, so reading *it* keeps the shop average and the product counters on the same ruler even if
 * the two fields ever drift apart. A comment with neither a usable score nor a reaction we
 * recognise counts toward nothing — one comment fewer is better than a number nobody can explain.
 */
function reviewScore(review) {
  const stored = review && review.score
  if (isStar(stored)) return stored
  const reaction = review && review.reaction
  if (reaction && Object.prototype.hasOwnProperty.call(LEGACY_REACTION_SCORES, reaction)) {
    return LEGACY_REACTION_SCORES[reaction]
  }
  return null
}

/**
 * Every comment a shop has received, as one rating: how many counted, what they add up to, and the
 * average to one decimal.
 *
 * `avg` is `null` for a shop nobody has commented on — never a flattering 0, never a fake 5,
 * exactly as `src/reviewUtils.ts:summaryOf` refuses to invent an average for a product.
 * The average is rounded from whole numbers (`sum * 10 / count`) rather than from the float
 * quotient, so 87 over 20 comments reads 4.4 rather than 4.3.
 */
function ratingFromReviews(reviews) {
  let count = 0
  let sum = 0
  for (const review of reviews || []) {
    const score = reviewScore(review)
    if (score === null) continue
    count += 1
    sum += score
  }
  return {
    count,
    sum,
    avg: count > 0 ? Math.round((sum * 10) / count) / 10 : null,
  }
}

module.exports = {
  COMPLETION_PCT,
  MAX_RESPONSE_MINUTES,
  STAR_MIN,
  STAR_MAX,
  LEGACY_REACTION_SCORES,
  isStar,
  orderCompletionRate,
  countCompleted,
  firstResponseMinutes,
  accumulateResponse,
  reviewScore,
  ratingFromReviews,
  meetsReliableCriteria,
}
