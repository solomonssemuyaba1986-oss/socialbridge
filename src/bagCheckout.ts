/**
 * The bag's checkout arithmetic — which lines are ready, which are on hold, and what one shop's
 * payment will be.
 *
 * The bag is paid **one shop at a time**. A single pawaPay deposit belongs to one seller, so a bag
 * with three shops is three payments, each with its own order and its own chat bubble. Pretending a
 * single prompt can cover three shops would either charge one seller for another's goods or take
 * money the buyer did not intend to spend.
 *
 * Pure on purpose (no React, no Firestore): `_bag_hold_check.cjs` checks the grouping.
 */

export interface BagCheckoutItem {
  productId: string
  productName: string
  productPrice: string
  imageUrl: string
  sellerId: string
  sellerSlug?: string
  businessName: string
  quantity: number
  addedAt?: number
  color?: string
  size?: string
  /** ms timestamp when the buyer put this line on hold; absent/0 means ready to buy. */
  heldAt?: number
}

export interface CheckoutLine {
  productId: string
  productName: string
  productPrice: string
  imageUrl: string
  quantity: number
  sellerId: string
  color?: string
  size?: string
  held: boolean
  price: number
  lineTotal: number
}

export interface ShopCheckout {
  sellerId: string
  businessName: string
  sellerSlug?: string
  lines: CheckoutLine[]
  total: number
  itemCount: number
}

export interface BagCheckoutSummary {
  /** Shops that have at least one line ready to pay, in bag order. */
  groups: ShopCheckout[]
  readyTotal: number
  readyCount: number
  shopCount: number
  /** Held and unavailable lines never enter a payment. */
  heldTotal: number
  heldCount: number
  unavailableTotal: number
  unavailableCount: number
}

export interface BagCheckoutOptions {
  /** Product ids the seller deleted or that cannot be bought any more. */
  unavailable?: Record<string, boolean> | null
  /**
   * "Buy Now" on one held row is an explicit decision to buy it, so the checkout may include held
   * lines. The bag-wide button leaves this off, which is what makes Hold on mean something.
   */
  includeHeld?: boolean
}

/** "45,000" / "UGX 45,000" / 45000 → 45000. Unreadable is 0, never a guess. */
export function bagPriceNumber(raw: unknown): number {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? raw : 0
  if (typeof raw !== 'string') return 0
  const cleaned = raw.replace(/[^0-9.]/g, '')
  if (!cleaned || !/\d/.test(cleaned)) return 0
  const value = Number(cleaned)
  return Number.isFinite(value) && value > 0 ? value : 0
}

export function isHeld(item: Pick<BagCheckoutItem, 'heldAt'> | null | undefined): boolean {
  return Number(item?.heldAt || 0) > 0
}

export function groupBagForCheckout(
  items: BagCheckoutItem[] | null | undefined,
  options: BagCheckoutOptions = {},
): BagCheckoutSummary {
  const unavailable = options.unavailable || {}
  const includeHeld = options.includeHeld === true
  const groups = new Map<string, ShopCheckout>()
  const summary: BagCheckoutSummary = {
    groups: [],
    readyTotal: 0,
    readyCount: 0,
    shopCount: 0,
    heldTotal: 0,
    heldCount: 0,
    unavailableTotal: 0,
    unavailableCount: 0,
  }

  for (const item of items || []) {
    if (!item || !item.productId) continue
    const price = bagPriceNumber(item.productPrice)
    const quantity = Math.max(1, Math.floor(Number(item.quantity) || 1))
    const lineTotal = price * quantity
    const sellerId = String(item.sellerId || '').trim()

    if (unavailable[item.productId] || !sellerId) {
      summary.unavailableCount += 1
      summary.unavailableTotal += lineTotal
      continue
    }

    const held = isHeld(item)
    if (held && !includeHeld) {
      summary.heldCount += quantity
      summary.heldTotal += lineTotal
      continue
    }

    let group = groups.get(sellerId)
    if (!group) {
      group = {
        sellerId,
        businessName: String(item.businessName || 'Seller'),
        ...(item.sellerSlug ? { sellerSlug: item.sellerSlug } : {}),
        lines: [],
        total: 0,
        itemCount: 0,
      }
      groups.set(sellerId, group)
    }
    group.lines.push({
      productId: item.productId,
      productName: String(item.productName || 'Product'),
      productPrice: String(item.productPrice || ''),
      imageUrl: String(item.imageUrl || ''),
      quantity,
      sellerId,
      ...(item.color ? { color: item.color } : {}),
      ...(item.size ? { size: item.size } : {}),
      held,
      price,
      lineTotal,
    })
    group.total += lineTotal
    group.itemCount += quantity
    summary.readyTotal += lineTotal
    summary.readyCount += quantity
  }

  summary.groups = [...groups.values()]
  summary.shopCount = summary.groups.length
  return summary
}

/** "Pay & send order · UGX 45,000" — one shop, one payment. */
export function bagCheckoutLabel(summary: BagCheckoutSummary): string {
  if (summary.shopCount === 0) return 'Nothing ready to pay'
  const money = `UGX ${summary.readyTotal.toLocaleString('en-US')}`
  return summary.shopCount === 1
    ? `⚡ Pay & send order · ${money}`
    : `⚡ Pay & send orders · ${money}`
}

/** "3 items · UGX 45,000" — what one shop in the bag adds up to. */
export function shopCheckoutWords(group: ShopCheckout | null | undefined): string {
  if (!group) return ''
  const items = `${group.itemCount} item${group.itemCount === 1 ? '' : 's'}`
  return `${items} · UGX ${group.total.toLocaleString('en-US')}`
}
