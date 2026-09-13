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
}

export const green = '#adff2f'

export function formatBagCount(n: number): string {
  if (n < 1000) return String(n)
  if (n < 10000) return (n / 1000).toFixed(1) + 'K'
  if (n < 1000000) return Math.round(n / 1000) + 'K'
  return (n / 1000000).toFixed(1) + 'M'
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
