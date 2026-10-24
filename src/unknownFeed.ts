/**
 * The Unknown shelf — rachett's home mix.
 *
 * "Unknown" is the part of shopping nobody searches for: the thing you did not know you wanted
 * until it was in front of you. It is not a random feed, and it is not a second search box. It is a
 * deliberate mix of the shelves the **age bracket before** the buyer usually shops from, the one
 * after it, and a little of their own.
 *
 * Why adjacent brackets? People rarely move in a straight line. A 25–34-year-old still buys the
 * streetwear their 18–24 self liked, and already wants the home and family things a 35–44-year-old
 * is buying. The prior shelf is the strongest signal (the habit they brought with them); the next
 * shelf is the horizon (what they are growing into); their own shelf is the anchor.
 *
 * The function is pure and takes only a band. It does **not** pretend to know an individual's
 * purchase history; it maps categories to cohorts, then lets real movement (orders, sales, ♥) break
 * ties. When the buyer has not shared an age, it falls back to what is moving across rachett rather
 * than guessing. That rule is pinned in `_unknown_feed_check.cjs`.
 */
import type { AgeAnswer } from './demographics'
import { canonicalCategory } from './categories'

/** Youngest to oldest. The two ends have one neighbour; everybody else has two. */
export const UNKNOWN_AGE_ORDER: Exclude<AgeAnswer, 'undisclosed'>[] = [
  'under-18',
  '18-24',
  '25-34',
  '35-44',
  '45-54',
  '55+',
]

export interface UnknownProduct {
  id?: string
  category?: string
  orderCount?: number
  salesCount?: number
  likeCount?: number
}

type KnownAgeBand = Exclude<AgeAnswer, 'undisclosed'>

/** The brackets that surround this one. Missing edges are simply absent, never invented. */
export function adjacentAgeBands(
  ageBand: AgeAnswer | '' | null | undefined,
): { prior: KnownAgeBand | null; next: KnownAgeBand | null; current: KnownAgeBand | null } {
  if (!ageBand || ageBand === 'undisclosed') return { prior: null, next: null, current: null }
  const index = UNKNOWN_AGE_ORDER.indexOf(ageBand)
  if (index < 0) return { prior: null, next: null, current: null }
  return {
    prior: index > 0 ? UNKNOWN_AGE_ORDER[index - 1] : null,
    next: index < UNKNOWN_AGE_ORDER.length - 1 ? UNKNOWN_AGE_ORDER[index + 1] : null,
    current: UNKNOWN_AGE_ORDER[index],
  }
}

/** How much each neighbour contributes. Prior first — the brief is "mostly the bracket before". */
export const UNKNOWN_BAND_WEIGHTS = { prior: 1, next: 0.72, current: 0.4 } as const

/**
 * The shelves each bracket is most likely to browse. Deliberately broad: this is a discovery
 * shelf, not a stereotype. A category may appear in several brackets, and anything unlisted still
 * appears when it is moving.
 */
export const UNKNOWN_CATEGORY_AFFINITY: Record<Exclude<AgeAnswer, 'undisclosed'>, string[]> = {
  'under-18': [
    'Youths',
    'Fashion & Clothing',
    'Electronics & Gadgets',
    'Beauty & Cosmetics',
    'Books & Stationery',
    'Sports & Outdoors',
  ],
  '18-24': [
    'Fashion & Clothing',
    'Youths',
    'Beauty & Cosmetics',
    'Electronics & Gadgets',
    'Sports & Outdoors',
    'Second Hand / Used',
    'Pets & Pet Supplies',
    'Food & Beverages',
  ],
  '25-34': [
    'Home & Living',
    'Electronics & Gadgets',
    'Baby & Maternity',
    'Health & Wellness',
    'Fashion & Clothing',
    'Beauty & Cosmetics',
    'Industrial & Commercial',
    'Services',
  ],
  '35-44': [
    'Home & Living',
    'Baby & Maternity',
    'Health & Wellness',
    'Automotive',
    'Industrial & Commercial',
    'Food & Beverages',
    'Books & Stationery',
    'Jewelry',
  ],
  '45-54': [
    'Home & Living',
    'Health & Wellness',
    'Automotive',
    'Industrial & Commercial',
    'Books & Stationery',
    'Jewelry',
    'Services',
    'Second Hand / Used',
  ],
  '55+': [
    'Health & Wellness',
    'Home & Living',
    'Books & Stationery',
    'Pets & Pet Supplies',
    'Jewelry',
    'Food & Beverages',
    'Second Hand / Used',
  ],
}

/** Everything a listing has moved — the same reading Browse uses, so the shelves agree. */
export function unknownMovement(product: UnknownProduct): number {
  return (Number(product.orderCount) || 0) * 2 + (Number(product.salesCount) || 0)
}

/**
 * How strongly a listing belongs on this person's Unknown shelf.
 *
 * A category affinity is worth 10 points before the band weight is applied; movement and likes are
 * the tie-break, capped so a single bestseller cannot turn the shelf into one shop's catalogue.
 */
export function unknownScore(product: UnknownProduct, ageBand: AgeAnswer | '' | null | undefined): number {
  const category = canonicalCategory(String(product.category || ''))
  const { prior, next, current } = adjacentAgeBands(ageBand)

  let affinity = 0
  if (prior && UNKNOWN_CATEGORY_AFFINITY[prior].includes(category)) affinity += UNKNOWN_BAND_WEIGHTS.prior
  if (next && UNKNOWN_CATEGORY_AFFINITY[next].includes(category)) affinity += UNKNOWN_BAND_WEIGHTS.next
  if (current && UNKNOWN_CATEGORY_AFFINITY[current].includes(category)) affinity += UNKNOWN_BAND_WEIGHTS.current

  const movement = Math.min(unknownMovement(product), 40) * 0.05
  const likes = Math.min(Number(product.likeCount) || 0, 200) * 0.01
  return affinity * 10 + movement + likes
}

/**
 * The Unknown order. Stable for equal scores (the page's own order is the tie-break), so a re-render
 * never reshuffles the shelf under somebody's thumb.
 */
export function rankUnknown<T extends UnknownProduct>(
  products: T[],
  ageBand: AgeAnswer | '' | null | undefined,
): T[] {
  return [...products].sort((a, b) => {
    const diff = unknownScore(b, ageBand) - unknownScore(a, ageBand)
    if (diff !== 0) return diff
    return unknownMovement(b) - unknownMovement(a)
  })
}

/**
 * One honest sentence about why this mix looks the way it does. No band means no claim about the
 * person — just the market.
 */
export function unknownCohortLine(ageBand: AgeAnswer | '' | null | undefined): string {
  const { prior, next, current } = adjacentAgeBands(ageBand)
  if (!current) return 'A mix from across rachett — what people are buying and loving now.'
  if (prior && next) {
    return `A mix from the ${prior} and ${next} shelves, with a little of your ${current} — things you may not have known you wanted.`
  }
  if (prior) return `A mix from the ${prior} shelf and your ${current} — the tastes you brought with you, plus something new.`
  return `A mix from your ${current} shelf and the ${next} one — a look at what comes next.`
}

/** The short headline the home page wears. */
export const UNKNOWN_TITLE = 'Unknown'
export const UNKNOWN_BLURB = 'Things you did not know you wanted — until they were in front of you.'

