/**
 * The one thing the 🟢 badge is allowed to rest on: a proof the seller did not write.
 *
 * `sellers/{uid}.phoneVerified` used to be that proof, and the browser owned that document — so
 * the badge was a value anyone could set from the console, with no SMS ever sent. The server now
 * records the proof in `trust/{uid}`, a document every visitor may read and no browser may write
 * (see `firestore.rules`), and `isPhoneProven` below is the only place the app decides whether a
 * seller has earned the badge.
 *
 * Shops created before the move still carry the old field. It is left standing on purpose — a
 * frozen snapshot of a real Firebase phone-auth result — so those shops keep the badge they
 * earned. That is why there is a fallback, and why it is a *fallback*: the new record wins.
 *
 * Pure, and compiled to `_dsbuild/trust.cjs` so `_trust_check.cjs` can prove the merge rules.
 */

/** The collection the server writes and the browser only reads. */
export const TRUST_COLLECTION = 'trust'

/** The two documents a proof might live in, exactly as Firestore hands them over. */
export type ProofSources = {
  /** `trust/{uid}` — written by `api/_lib/identity.js` after a code came back correct. */
  trust?: { phoneProven?: unknown } | null
  /** `sellers/{uid}` — may still carry the pre-move field on an older shop. */
  seller?: { phoneVerified?: unknown } | null
}

/**
 * Has this seller's number been proved?
 *
 * Only the exact boolean `true` counts, from either source. A missing document, a string, a
 * number, an object — none of them is a proof, because a badge that appears for `"true"` is a
 * badge that appears for the wrong reason. The new record is checked first and short-circuits:
 * a shop proved after the move never needs the old field read at all.
 */
export function isPhoneProven({ trust, seller }: ProofSources): boolean {
  if (trust?.phoneProven === true) return true
  return seller?.phoneVerified === true
}
