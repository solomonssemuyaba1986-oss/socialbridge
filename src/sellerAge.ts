/**
 * How old a shop is — the one fact a product card is allowed to use when it says "New seller".
 *
 * A card cannot ask "is this shop trustworthy?" and answer it, but it can say the true and useful
 * thing: this shop opened within the last month. The seller's `createdAt` is written once at store
 * setup (`SetupStore.tsx`) and is public, so the badge costs no extra read — pages that already
 * join the seller document (Browse, Nearby) pass the date straight through.
 *
 * Missing evidence never becomes a badge: a shop whose `createdAt` predates that field, or whose
 * date cannot be read, is simply not new. `functions/backfill-store-dates.js` fills those in from
 * real evidence (first product → first order → first visit), not from guesswork.
 */
import { toMillis } from './productCardUtils'

/** The window a shop is called new. Long enough to be discovered, short enough to mean something. */
export const NEW_SELLER_DAYS = 30

export const NEW_SELLER_LABEL = 'New seller'

export function isNewSeller(createdAt: unknown, now: number = Date.now()): boolean {
  const openedAt = toMillis(createdAt)
  if (openedAt === undefined) return false
  const age = now - openedAt
  // A future date is a bad clock or a typo, not a new shop — never claim it.
  return age >= 0 && age < NEW_SELLER_DAYS * 24 * 60 * 60 * 1000
}
