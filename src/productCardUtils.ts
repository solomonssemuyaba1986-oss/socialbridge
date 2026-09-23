/** Product-card helpers shared by ProductCard, Browse and Nearby. */

/** The product shape Browse and Nearby both feed into these cards. */
export interface CardProduct {
  id: string
  name: string
  price: string
  description?: string
  imageUrl: string
  images?: string[]
  sellerSlug: string
  sellerId: string
  businessName: string
  category?: string
  subCategory?: string
  outOfStock?: boolean
  orderCount?: number
  salesCount?: number
  /**
   * Options the seller listed (ProductsPage writes these; older and bulk-uploaded products
   * have none — see `listVariants`, which normalises whatever is actually on the doc).
   */
  colors?: string[]
  sizes?: string[]
  /** Free text more often than not: "3", "in stock", "". `stockLine` decides what's worth saying. */
  stock?: string | number
  /**
   * The comment counters on the product document. They count *every* comment (not just the page
   * the sheet loaded), which is why the header can say "19 of 23" truthfully.
   */
  reviewCount?: number
  reviewScoreSum?: number
  reviewLovedCount?: number
  /** ♥ The universal like tally — lives on the product doc, the same for every visitor. */
  likeCount?: number
}

export const green = '#adff2f'

/**
 * Firestore refuses `undefined` — and it throws **synchronously**, so a `.catch()` never sees it.
 * That is exactly how a bag write with `color: undefined` could take a whole screen down.
 *
 * Anything written to Firestore goes through here first: absent fields are simply not sent.
 */
export function withoutUndefined(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined || item === null) continue
    out[key] = item
  }
  return out
}

/**
 * 999 → "999" · 1,200 → "1.2K" · 10,000 → "10K" · 1,000,000 → "1.0M".
 * A card never shows six digits: 999,500 rounds up to "1.0M" rather than "1000K".
 * Used by the ♥ like pill, 🛍️ bagged and ✓ bought counters — one number format, everywhere.
 */
export function formatCount(n: number): string {
  const value = Math.max(0, Math.floor(Number(n) || 0))
  if (value < 1000) return String(value)
  if (value < 10000) return (value / 1000).toFixed(1) + 'K'
  if (value < 1000000) {
    const thousands = Math.round(value / 1000)
    return thousands < 1000 ? thousands + 'K' : (value / 1000000).toFixed(1) + 'M'
  }
  return (value / 1000000).toFixed(1) + 'M'
}

/** The old name for {@link formatCount} — kept so the existing card callers don't churn. */
export const formatBagCount = formatCount

/**
 * ♥ The public like tally on a product: never negative, missing (or junk) tolerated — a
 * product created before likes existed simply reads as zero.
 */
export function likeTally(product: { likeCount?: number } | null | undefined): number {
  const raw = Number(product?.likeCount ?? 0)
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0
}

export function productImages(p: CardProduct): string[] {
  if (p.images && p.images.length > 0) return p.images
  return p.imageUrl ? [p.imageUrl] : []
}

/** Firestore Timestamp, Date or number → milliseconds. Older records have none. */
export function toMillis(value: unknown): number | undefined {
  if (value && typeof value === 'object' && typeof (value as { toMillis?: () => number }).toMillis === 'function') {
    return (value as { toMillis: () => number }).toMillis()
  }
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number') return value
  return undefined
}

/**
 * Deterministic shuffle (mulberry32). Same seed → same order, so a "random" feed
 * stays still while the user scrolls, and reshuffles only when they tap 🔀.
 */
export function seededShuffle<T>(items: T[], seed: number): T[] {
  const arr = [...items]
  let s = seed || 1
  const rand = () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    const tmp = arr[i]
    arr[i] = arr[j]
    arr[j] = tmp
  }
  return arr
}
