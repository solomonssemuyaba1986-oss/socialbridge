/**
 * The shop rating — where it lives, how it is read, and what a surface is allowed to say.
 *
 * A shop's rating is the average of **every comment that shop has received**, and a comment is worth
 * the star its buyer tapped — one whole number from 1 to 5. It is computed by `recomputeSellerRating` (Cloud
 * Functions, `functions/index.js`) and written to `sellers/{sellerId}` as two fields:
 *
 *   ratingAvg    number | null   the average, already rounded to one decimal by the server
 *   ratingCount  number          how many comments were counted
 *
 * `firestore.rules` refuses those keys (and `ratingUpdatedAt`) from any browser write, so the
 * number cannot be awarded by the shop it describes — the same protection the 🟢 badge got when
 * `phoneVerified` stopped being a client field.
 *
 * Everything here is free of React, Firestore and the DOM so Node can check it
 * (`_ratings_check.cjs`), and the ruler itself is compared against
 * `functions/sellerStats.js:isStar`/`LEGACY_REACTION_SCORES` and `reviewUtils.ts:isScore`/`legacyScore`
 * by that same harness. `SellerRating.tsx` is the one component that draws these numbers — this file
 * is the rule, that file is the picture.
 */

/** What a surface needs to show a rating — the seller document, a joined product row, a store tile. */
export interface RatingSource {
  /** The server's average to one decimal, or `null`/absent for a shop nobody has rated. */
  ratingAvg?: number | null
  /** How many comments were counted. Absent on documents written before the rating existed. */
  ratingCount?: number
}

export interface SellerRating {
  count: number
  /** `null` when there is nothing to average — never 0, which would render as "★ 0.0". */
  avg: number | null
}

/**
 * The two fields as a rating, tolerating whatever is actually on the document.
 *
 * A count with no usable average, or an average with no count, is **no rating** rather than a
 * half-true one: `{ ratingAvg: 5 }` with no count is not "★ 5.0 from nobody". Old shops have
 * neither field, and read as unrated — which is exactly what they are.
 */
export function sellerRatingOf(source: RatingSource | null | undefined): SellerRating {
  const count = Math.floor(Number(source?.ratingCount) || 0)
  const avg = Number(source?.ratingAvg)
  const usable = count > 0 && Number.isFinite(avg) && avg > 0
  return usable ? { count, avg } : { count: 0, avg: null }
}

/** Is there a rating worth showing? A type guard, so `rating.avg` is a number after the check. */
export function hasRating(rating: SellerRating): rating is SellerRating & { avg: number } {
  return rating.count > 0 && rating.avg !== null && Number.isFinite(rating.avg)
}

/**
 * The same question asked of the raw fields — for a surface that decides *what to render* before it
 * hands the number to `SellerRating` (the storefront shows the shop's rating, or the hearts line).
 */
export function hasSellerRating(source: RatingSource | null | undefined): boolean {
  return hasRating(sellerRatingOf(source))
}

/** `4.7` — one decimal, the same shape the server rounded to. `averageLabel` does this for comments. */
export function formatRatingValue(avg: number): string {
  return Number.isFinite(avg) ? avg.toFixed(1) : ''
}

/** `"12 buyer ratings"` · `"1 buyer rating"` — the count, in words, with the noun it is counting. */
export function ratingCountLabel(count: number, word = 'rating'): string {
  const safe = Math.max(0, Math.floor(Number(count) || 0))
  return `${safe} ${word}${safe === 1 ? '' : 's'}`
}
