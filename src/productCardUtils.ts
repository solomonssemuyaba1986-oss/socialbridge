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
