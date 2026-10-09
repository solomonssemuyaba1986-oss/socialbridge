/**
 * What the Marketing page needs to know, decided here rather than in the middle of a component.
 *
 * Every function is pure and imports nothing — so `_marketing_check.cjs` can compile this file alone
 * and check the things a seller would notice if they were wrong: a link that opens the wrong shop, a
 * "what's working" order that puts a dead product first, a filename with a slash in it.
 *
 * Anything that touches Firestore, the clipboard or the analytics client lives in `productViews.ts`
 * and `shareStore.ts`. A link builder is arithmetic; keeping it here is what makes it checkable.
 */

export interface MarketingProduct {
  id: string
  name?: string
  price?: string
  imageUrl?: string
  images?: string[]
  likeCount?: number
  orderCount?: number
  reviewCount?: number
  reviewScoreSum?: number
}

export interface BagCount {
  count: number
  baggedCount: number
}

export interface InterestRow {
  id: string
  name: string
  price: string
  image: string
  /** Sessions that opened the product sheet — the interest nobody paid for. */
  opens: number
  /** Distinct people who put it in a bag. */
  bags: number
  likes: number
  orders: number
  /** null when nobody has rated it: an unrated product is not a badly rated one. */
  rating: number | null
  reviews: number
}

/** ── Links ──────────────────────────────────────────────────────────────────────────────────── */

/** `/store/{slug}`, never doubled up when the origin ends with a slash. */
export function storeLink(origin: string, slug: string): string {
  const base = String(origin || '').replace(/\/+$/, '')
  return `${base}/store/${String(slug || '').trim()}`
}

/** The deep link that opens the shop *on* one product — the one worth sharing. */
export function productLink(origin: string, slug: string, productId: string): string {
  return `${storeLink(origin, slug)}?productId=${encodeURIComponent(String(productId || ''))}`
}

/** "Amina Fabrics" → "amina-fabrics" — used for filenames, never for the link itself. */
export function slugify(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

export function qrFileName(slug: string): string {
  return `rachett-${slugify(slug) || 'shop'}-qr.png`
}

export function productQrFileName(slug: string, productName: string): string {
  return `rachett-${slugify(slug) || 'shop'}-${slugify(productName) || 'product'}-qr.png`
}

/** ── What to say ────────────────────────────────────────────────────────────────────────────── */

/** The caption that goes with a store link: short enough for a status, specific enough to be a shop. */
export function storeCaption(businessName: string): string {
  const name = String(businessName || 'my shop').trim() || 'my shop'
  return `Shop ${name} on rachett 🛍️ Pick what you like, order on your phone, get it delivered.`
}

export function productCaption(productName: string, price: string, businessName: string): string {
  const name = String(productName || 'something new').trim() || 'something new'
  const shop = String(businessName || 'my shop').trim() || 'my shop'
  const money = String(price || '').trim()
  return money
    ? `${name} — ${money} at ${shop} 🛍️ Tap to see it and order.`
    : `${name} at ${shop} 🛍️ Tap to see it and order.`
}

/** ── Where it can go ─────────────────────────────────────────────────────────────────────────── */

export type ShareChannel = 'whatsapp' | 'telegram' | 'x' | 'facebook' | 'email' | 'copy'

export interface ShareTarget {
  channel: ShareChannel
  label: string
  icon: string
  /** Empty for `copy`, which is the clipboard rather than a URL. */
  href: string
}

/**
 * The channels a seller actually has, in the order they use them. WhatsApp first because that is
 * where a small shop's customers already are — the ordering is part of the advice.
 */
export function shareTargets(link: string, caption: string): ShareTarget[] {
  const url = String(link || '')
  const text = String(caption || '')
  const both = `${text} ${url}`.trim()
  return [
    { channel: 'whatsapp', label: 'WhatsApp', icon: '💬', href: `https://wa.me/?text=${encodeURIComponent(both)}` },
    { channel: 'telegram', label: 'Telegram', icon: '✈️', href: `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}` },
    { channel: 'facebook', label: 'Facebook', icon: '📘', href: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}` },
    { channel: 'x', label: 'X', icon: '✖️', href: `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}` },
    { channel: 'email', label: 'Email', icon: '✉️', href: `mailto:?subject=${encodeURIComponent(text.slice(0, 60))}&body=${encodeURIComponent(both)}` },
    { channel: 'copy', label: 'Copy link', icon: '📋', href: '' },
  ]
}

export interface PromoteCard {
  id: string
  icon: string
  title: string
  /** One line of why-and-where. Never a promise rachett cannot keep. */
  why: string
  /** Ready to paste, link included. Tapping the card copies exactly this. */
  caption: string
}

/**
 * Plain, do-able promotion — the five things a seller with a phone can do today. No automation is
 * claimed, because none happens: every card is a caption to paste and a place to paste it.
 */
export function promoteCards(businessName: string, storeUrl: string): PromoteCard[] {
  const name = String(businessName || 'my shop').trim() || 'my shop'
  const link = String(storeUrl || '')
  return [
    {
      id: 'status',
      icon: '💬',
      title: 'WhatsApp status',
      why: 'The people who already know you — 30 seconds, no cost.',
      caption: `${storeCaption(name)}\n${link}`,
    },
    {
      id: 'bio',
      icon: '📸',
      title: 'Instagram / TikTok bio',
      why: 'One tap in your bio, working while you sleep.',
      caption: `Order from ${name} 👇\n${link}`,
    },
    {
      id: 'groups',
      icon: '👥',
      title: 'A group you are already in',
      why: 'Church, school, work, market — say it like a person.',
      caption: `I have put new stock on my rachett shop ${name} 🛍️\nHave a look and order here: ${link}`,
    },
    {
      id: 'parcel',
      icon: '📦',
      title: 'Every parcel you send',
      why: 'The QR card turns one delivery into the next order.',
      caption: 'Print the card above and tape it on the parcel — the buyer scans it and is back in your shop.',
    },
    {
      id: 'ask',
      icon: '🤝',
      title: 'Ask one happy customer',
      why: 'A share from a real buyer beats any advert.',
      caption: `Thank you for buying from ${name} 🙏 If you liked it, please share this with one friend who would too: ${link}`,
    },
  ]
}

/** ── What's working ─────────────────────────────────────────────────────────────────────────── */

export interface InterestInput {
  products: MarketingProduct[]
  /** `bagCounts/{productId}` — public, so a seller sees the same numbers a buyer's card shows. */
  bagCounts?: Record<string, BagCount>
  /** `productViews/{productId}.count` — opens, deduped per session. */
  views?: Record<string, number>
}

function priceLabel(price: unknown): string {
  const text = String(price ?? '').trim()
  if (!text) return ''
  return /^[0-9]/.test(text) ? `UGX ${text}` : text
}

function imageFor(product: MarketingProduct): string {
  if (product.imageUrl) return product.imageUrl
  return product.images && product.images.length > 0 ? product.images[0] : ''
}

/**
 * One row per product, sorted by what a seller would call "working": orders first, then bags, then
 * likes, then opens, then the name — so a tie breaks the same way every time and the table never
 * jumps around between refreshes.
 */
export function interestRows(input: InterestInput): InterestRow[] {
  const bagCounts = input.bagCounts || {}
  const views = input.views || {}
  const rows = (input.products || []).map<InterestRow>(product => {
    const bag = bagCounts[product.id]
    const reviews = Math.max(0, Number(product.reviewCount) || 0)
    const scoreSum = Math.max(0, Number(product.reviewScoreSum) || 0)
    return {
      id: product.id,
      name: String(product.name || '').trim() || 'Untitled product',
      price: priceLabel(product.price),
      image: imageFor(product),
      opens: Math.max(0, Number(views[product.id]) || 0),
      bags: Math.max(0, Number(bag?.baggedCount ?? bag?.count) || 0),
      likes: Math.max(0, Number(product.likeCount) || 0),
      orders: Math.max(0, Number(product.orderCount) || 0),
      rating: reviews > 0 ? scoreSum / reviews : null,
      reviews,
    }
  })
  rows.sort((a, b) => (
    b.orders - a.orders
    || b.bags - a.bags
    || b.likes - a.likes
    || b.opens - a.opens
    || a.name.localeCompare(b.name)
  ))
  return rows
}

/**
 * The one sentence under a row: what the numbers mean and what to do about it. Written to be true at
 * the numbers shown — a row with no opens is told nobody has looked, not that it is underperforming.
 */
export function insightFor(row: InterestRow): string {
  if (row.orders > 0) return row.orders === 1 ? 'Sold once — keep it in stock.' : `Sold ${row.orders} times — keep it in stock.`
  if (row.bags > 0) return 'Bagged but not ordered — one message about delivery wins this one.'
  if (row.likes > 0) return 'Loved, not bought yet — say the delivery cost out loud.'
  if (row.opens > 0) return 'Looked at but never bagged — check the price and the first photo.'
  return 'Nobody has opened it yet — share it once and watch this row.'
}

/** The teaching line for a seller whose table is completely empty. */
export function emptyTableLine(): string {
  return 'Share one product today. Tomorrow this table tells you which one to share again.'
}

/** ── The hero: one number, one sentence, one button ─────────────────────────────────────────── */

export interface VisitSummary {
  today: number
  week: number
  total: number
}

const DAY_MS = 24 * 60 * 60 * 1000

function millisOf(value: unknown): number | null {
  if (!value) return null
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number') return value
  const maybe = value as { toDate?: () => Date; seconds?: number }
  if (typeof maybe.toDate === 'function') return maybe.toDate().getTime()
  if (typeof maybe.seconds === 'number') return maybe.seconds * 1000
  const parsed = Date.parse(String(value))
  return Number.isNaN(parsed) ? null : parsed
}

/**
 * Store visits, counted from the same `sellers/{uid}/visits` documents the Analytics page reads.
 * A visit whose timestamp cannot be read is counted in the total only — never invented into "today".
 */
export function visitSummary(visits: Array<{ createdAt?: unknown }>, now: number): VisitSummary {
  let today = 0
  let week = 0
  let total = 0
  for (const visit of visits || []) {
    total++
    const at = millisOf(visit?.createdAt)
    if (at === null) continue
    const age = now - at
    if (age >= 0 && age < DAY_MS) today++
    if (age >= 0 && age < DAY_MS * 7) week++
  }
  return { today, week, total }
}

/** "7 people opened your shop this week" — or the honest singular. */
export function visitsLine(summary: VisitSummary): string {
  const people = summary.week === 1 ? '1 person' : `${summary.week} people`
  return `${people} opened your shop this week`
}

export type NextStepKind = 'add' | 'share-store' | 'share-product' | 'ask-review'

export interface NextStep {
  kind: NextStepKind
  label: string
  /** A route, or a `#section` on this page. */
  to: string
}

/**
 * The single green button: exactly one next best action, chosen from the numbers rather than offered
 * as a list. A seller should never have to choose between five calls to action.
 */
export function nextStep(input: { productCount: number; visits: number; orders: number }): NextStep {
  if (input.productCount === 0) return { kind: 'add', label: 'Add your first product', to: '/products' }
  if (input.visits === 0) return { kind: 'share-store', label: 'Share your store link', to: '#share-store' }
  if (input.orders === 0) return { kind: 'share-product', label: 'Share one product', to: '#share-product' }
  return { kind: 'ask-review', label: 'Ask your last buyer for a ★', to: '/orders' }
}

/** No products yet is the one empty state that needs teaching, not numbers. */
export function noProductsState(): { title: string; body: string; action: string } {
  return {
    title: 'Nothing to market yet',
    body: 'A shop with one product sells more than a shop with none. Add the one people ask you for most.',
    action: 'Add a product',
  }
}
