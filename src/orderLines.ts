/**
 * What an order is made of — one definition for every screen that reads one.
 *
 * A single-product order has always been `productName` + `productPrice` + `quantity`. The bag now
 * allows several products from one shop in a single order, and rather than teach every reader a
 * second shape, a combined order still carries those three fields: `productPrice` is the sum of the
 * lines, `quantity` is `1`, and `items[]` holds the truth. `orderTotal` on the server already reads
 * `productPrice × quantity`, so the amount charged and the amount shown cannot disagree.
 *
 * Pure on purpose (no React, no Firebase): `_order_lines_check.cjs` checks the arithmetic.
 */

export interface OrderLine {
  productId?: string
  productName: string
  productPrice: string
  quantity: number
  productImage?: string
  color?: string
  size?: string
}

export interface OrderLineSource {
  items?: Partial<OrderLine>[] | null
  productId?: string
  productName?: string
  productPrice?: string
  productImage?: string
  quantity?: number | string
  color?: string
  size?: string
}

/** "45,000" / "UGX 45,000" / 45000 → 45000. Anything unreadable is 0, never a guess. */
export function orderPriceNumber(raw: unknown): number {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? raw : 0
  if (typeof raw !== 'string') return 0
  const cleaned = raw.replace(/[^0-9.]/g, '')
  if (!cleaned || !/\d/.test(cleaned)) return 0
  const value = Number(cleaned)
  return Number.isFinite(value) && value > 0 ? value : 0
}

/** A line quantity is a whole number from 1 to 99 — the same ceiling the details sheet uses. */
export function orderQuantityNumber(raw: unknown): number {
  const digits = String(raw === null || raw === undefined ? '' : raw).replace(/[^\d]/g, '')
  const value = Math.floor(Number(digits) || 1)
  return Math.min(Math.max(1, value), 99)
}

export function orderLineTotal(line: Partial<OrderLine> | null | undefined): number {
  return orderPriceNumber(line?.productPrice) * orderQuantityNumber(line?.quantity)
}

export function orderLinesTotal(lines: (Partial<OrderLine> | null | undefined)[] | null | undefined): number {
  if (!Array.isArray(lines)) return 0
  return lines.reduce((sum, line) => sum + orderLineTotal(line), 0)
}

/** Read any order — new `items[]` or old single-product — as lines. */
export function orderLinesOf(source: OrderLineSource | null | undefined): OrderLine[] {
  if (!source) return []
  const stored = Array.isArray(source.items) ? source.items : []
  const lines = stored
    .map(line => {
      const productName = String(line?.productName || '').trim()
      if (!productName) return null
      return {
        ...(line?.productId ? { productId: String(line.productId) } : {}),
        productName,
        productPrice: String(line?.productPrice || '').trim(),
        quantity: orderQuantityNumber(line?.quantity),
        ...(line?.productImage ? { productImage: String(line.productImage) } : {}),
        ...(line?.color ? { color: String(line.color) } : {}),
        ...(line?.size ? { size: String(line.size) } : {}),
      } as OrderLine
    })
    .filter((line): line is OrderLine => line !== null)

  if (lines.length > 0) return lines

  const productName = String(source.productName || '').trim()
  if (!productName) return []
  return [{
    ...(source.productId ? { productId: String(source.productId) } : {}),
    productName,
    productPrice: String(source.productPrice || '').trim(),
    quantity: orderQuantityNumber(source.quantity),
    ...(source.productImage ? { productImage: String(source.productImage) } : {}),
    ...(source.color ? { color: String(source.color) } : {}),
    ...(source.size ? { size: String(source.size) } : {}),
  }]
}

/**
 * The three fields every old reader needs, from one or more lines.
 *
 * `productPrice` becomes the sum and `quantity` becomes 1, so `productPrice × quantity` is the same
 * number on both sides — the server's `orderAmount.js`, the buyer's receipt and the seller's list all
 * read one order, not three descriptions of one.
 */
export function combineOrderLines(lines: OrderLine[]): {
  productName: string
  productPrice: string
  quantity: string
  productId?: string
  productImage?: string
  items: OrderLine[]
} {
  const clean = lines.filter(line => String(line.productName || '').trim() !== '')
  const first = clean[0]
  const total = orderLinesTotal(clean)
  return {
    productName: first
      ? (clean.length === 1 ? first.productName : `${first.productName} + ${clean.length - 1} more`)
      : '',
    productPrice: total > 0 ? String(total) : '',
    quantity: '1',
    ...(first?.productId ? { productId: first.productId } : {}),
    ...(first?.productImage ? { productImage: first.productImage } : {}),
    items: clean,
  }
}

/**
 * A draft exists so the seller is not told about an order nobody paid for. `published` and every
 * legacy order (no state at all) are visible; `paying` and `abandoned` are not.
 */
export function isPublishedOrder(order: { checkoutState?: string } | null | undefined): boolean {
  return order?.checkoutState !== 'paying' && order?.checkoutState !== 'abandoned'
}

/** "2 × Shirt · 1 × Shoes" — the line-by-line summary a receipt and a seller both read. */
export function orderLineWords(lines: (Partial<OrderLine> | null | undefined)[] | null | undefined): string {
  if (!Array.isArray(lines)) return ''
  return lines
    .filter((line): line is Partial<OrderLine> => Boolean(line && String(line.productName || '').trim()))
    .map(line => `${orderQuantityNumber(line.quantity)} × ${String(line.productName).trim()}`)
    .join(' · ')
}

/** A variant for one line, in the same wording as `variantLabel` in `productSheetUtils.ts`. */
export function lineVariantWords(line: Partial<OrderLine> | null | undefined): string {
  return [line?.color, line?.size]
    .map(value => String(value || '').trim())
    .filter(Boolean)
    .join(' / ')
}
