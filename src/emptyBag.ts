/**
 * What to put in front of somebody whose bag is empty.
 *
 * An empty bag is the worst screen in a shop: it is the one place a buyer is told "no". This module
 * decides what that screen offers instead, and it is pure on purpose — no React, no Firestore, no
 * storage — so every rule can be pinned against fixed data (`_empty_bag_check.cjs`).
 *
 * Three rules it keeps:
 *
 *  - **Their own trail first.** What they opened on this phone (`useViewHistory`) is better than
 *    anything we could pick for them, and it costs no reads.
 *  - **Then what is really moving.** Only in-stock things from shops that can actually be opened —
 *    and, when we know their area, things from shops within reach of it. A suggestion nobody can
 *    buy, or that leads to a dead link, is worse than an empty shelf.
 *  - **Never a hole where a shelf should be.** If nothing qualifies nearby we widen out rather than
 *    show an empty rail; if nothing qualifies at all, the page keeps its plain "Browse stores" state.
 *
 * Age/gender ("people like you bought…") is deliberately absent *here*: we now hold both — the
 * one-time ask lives in `demographics.ts` (`users/{uid}.ageBand` / `gender`) — but nothing yet
 * connects a person's band to what a product is *for*, and inventing that connection would be a
 * fact about a person we never asked. The sentence needs two halves: `recommendationAudience()`
 * (who is asking) and an `audience` on the product (who it is for). When the second exists, this
 * module gains one filter — not a rewrite.
 */
import type { ViewEntry } from './history'

/** How many recent looks the empty bag shows. One small rail, never a wall. */
export const EMPTY_BAG_RECENT_LIMIT = 6
/** How many suggestions the fallback rail shows. */
export const EMPTY_BAG_SUGGESTION_LIMIT = 6
/** "Within reach" for a delivery — the radius a suggestion still counts as local. */
export const BAG_NEAR_REACH_KM = 25

/** The words a rail wears, exported so the page and the checks agree on them. */
export const RECENT_RAIL_TITLE = 'Pick up where you left off'
export const RECENT_RAIL_BLURB = 'Opened on this phone — tap to look again.'
export const BOUGHT_NEAR_TITLE = 'Bought near you'
export const BOUGHT_NEAR_BLURB = 'Moving fast at shops within reach of your area.'
export const BOUGHT_TITLE = 'Being bought right now'
export const BOUGHT_BLURB = 'The things moving fastest on rachett today.'

/** The product fields this module reads — a feed row, whatever else it carries. */
export interface BagFeedProduct {
  id?: unknown
  name?: unknown
  price?: unknown
  imageUrl?: unknown
  images?: unknown
  sellerId?: unknown
  sellerSlug?: unknown
  businessName?: unknown
  orderCount?: unknown
  salesCount?: unknown
  outOfStock?: unknown
  createdAt?: unknown
  createdAtMs?: unknown
}

export interface BagSuggestion {
  product: BagFeedProduct
  /** The product's own id, already proven to exist — the rail's key and what a tap reports. */
  id: string
  imageUrl: string
  name: string
  price: string
  businessName: string
  /** How many have been bought (orders count double, sales once — the market's own definition). */
  bought: number
  /** Where tapping it goes. Never empty: a suggestion with no door is not offered at all. */
  href: string
  /** Why it is on this shelf, so the rail can say so. */
  why: string
}

function text(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function count(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** Orders count double, a completed sale once — the same sum the market's "Popular" sort uses. */
export function movedCount(product: BagFeedProduct | null | undefined): number {
  return count(product?.orderCount) * 2 + count(product?.salesCount)
}

/**
 * The door to a product: `/store/{slug}?productId={id}` — the deep link StorePage already understands.
 * Empty when either half is missing, because a card that cannot be opened is not a suggestion.
 */
export function bagHref(product: BagFeedProduct | null | undefined, sellerSlug = ''): string {
  const id = text(product?.id)
  const slug = text(product?.sellerSlug) || text(sellerSlug)
  if (!id || !slug) return ''
  return `/store/${encodeURIComponent(slug)}?productId=${encodeURIComponent(id)}`
}

/** The first photo, or the stand-in every other card in the app uses. */
export function firstPhoto(product: BagFeedProduct | null | undefined): string {
  const direct = text(product?.imageUrl)
  if (direct) return direct
  const images = Array.isArray(product?.images) ? product.images : []
  for (const img of images) {
    const line = text(img)
    if (line) return line
  }
  return ''
}

/**
 * One row per product, newest first, across every surface handed in.
 *
 * A product opened on Browse *and* Nearby is one row: their most recent look wins, because the row
 * is a memory of the last time they cared about it.
 */
export function mergeRecent(
  groups: (ViewEntry[] | null | undefined)[],
  limit = EMPTY_BAG_RECENT_LIMIT,
): ViewEntry[] {
  const byId = new Map<string, ViewEntry>()
  for (const group of groups) {
    for (const entry of group || []) {
      const id = text(entry?.productId)
      if (!id) continue
      const previous = byId.get(id)
      if (!previous || (entry.at || 0) > (previous.at || 0)) byId.set(id, entry)
    }
  }
  return [...byId.values()]
    .sort((a, b) => (b.at || 0) - (a.at || 0))
    .slice(0, Math.max(0, limit))
}

export interface BagSuggestionOptions {
  /** Product IDs they have already looked at — never suggested back to them. */
  seen?: Set<string> | string[]
  /** How far away the shop is, in km — `null` when we cannot say honestly. */
  distanceOf?: (product: BagFeedProduct) => number | null
  /**
   * The shop behind a product row: a product document does not carry its shop's slug or name, and a
   * suggestion without a slug cannot be opened at all. The page hands us its shop directory (one
   * read, shared with Browse's Nearby sort) and the row's own fields still win when it has them.
   */
  storeOf?: (sellerId: string) => { slug?: unknown; businessName?: unknown } | null | undefined
  limit?: number
}

/**
 * The fallback shelf: what is actually moving, that they can actually get.
 *
 * Filters, in order — each one is a way a suggestion could have been a lie:
 *   - out of stock, or unopenable (no id / no shop slug) → out;
 *   - already looked at → out (their own rail sits directly above this one);
 *   - too far, *when we know the distance*, → out — but only if something is left; a narrow area
 *     must never empty the shelf, so we widen back out rather than show nothing.
 * Then it is ranked by movement (orders×2 + sales), nearest first on ties.
 */
export function bagSuggestions(
  list: (BagFeedProduct | null | undefined)[],
  options: BagSuggestionOptions = {},
): BagSuggestion[] {
  const limit = Math.max(0, options.limit ?? EMPTY_BAG_SUGGESTION_LIMIT)
  const seen = options.seen instanceof Set ? options.seen : new Set(options.seen || [])
  const distanceOf = options.distanceOf
  const storeOf = options.storeOf

  const candidates: {
    product: BagFeedProduct
    id: string
    href: string
    bought: number
    km: number | null
    shopName: string
  }[] = []
  for (const row of list || []) {
    if (!row) continue
    if (row.outOfStock === true) continue
    const id = text(row.id)
    if (!id || seen.has(id)) continue
    const sellerId = text(row.sellerId)
    const shop = sellerId && storeOf ? storeOf(sellerId) : null
    // The row's own slug wins; the shop directory is what makes a row without one openable at all.
    const href = bagHref(row, text(shop?.slug))
    if (!href) continue
    const km = distanceOf ? distanceOf(row) : null
    candidates.push({
      product: row,
      id,
      href,
      bought: movedCount(row),
      km,
      shopName: text(row.businessName) || text(shop?.businessName),
    })
  }

  const near = distanceOf
    ? candidates.filter(c => c.km !== null && c.km <= BAG_NEAR_REACH_KM)
    : []
  const usingNear = near.length > 0
  const pool = usingNear ? near : candidates

  return pool
    .slice()
    .sort((a, b) => {
      if (b.bought !== a.bought) return b.bought - a.bought
      if (a.km !== null && b.km !== null && a.km !== b.km) return a.km - b.km
      return 0
    })
    .slice(0, limit)
    .map(c => ({
      product: c.product,
      id: c.id,
      imageUrl: firstPhoto(c.product),
      name: text(c.product.name) || 'This item',
      price: text(c.product.price),
      businessName: c.shopName,
      bought: c.bought,
      href: c.href,
      why: usingNear ? BOUGHT_NEAR_TITLE : BOUGHT_TITLE,
    }))
}

export interface EmptyBagRail {
  kind: 'recent' | 'bought'
  title: string
  blurb: string
}

/**
 * Whether the page should go and fetch a fallback shelf at all.
 *
 * Their own trail comes first, and it is already on the phone. If it fills the rail we are about to
 * draw, there is nothing to top up — so an empty bag with a trail costs no reads at all, and only a
 * buyer with little or nothing of their own is served the catalogue.
 */
export function wantsFallbackShelf(recentCount: number): boolean {
  return Math.max(0, recentCount || 0) < EMPTY_BAG_RECENT_LIMIT
}

/**
 * Which rails the empty bag shows, in the order somebody reads them: their own trail, then ours.
 * Nothing to show means no rail — never a labelled shelf standing empty.
 */
export function emptyBagRails(input: {
  recentCount: number
  suggestionCount: number
  near?: boolean
}): EmptyBagRail[] {
  const rails: EmptyBagRail[] = []
  if (input.recentCount > 0) {
    rails.push({ kind: 'recent', title: RECENT_RAIL_TITLE, blurb: RECENT_RAIL_BLURB })
  }
  if (input.suggestionCount > 0) {
    rails.push({
      kind: 'bought',
      title: input.near ? BOUGHT_NEAR_TITLE : BOUGHT_TITLE,
      blurb: input.near ? BOUGHT_NEAR_BLURB : BOUGHT_BLURB,
    })
  }
  return rails
}

/**
 * The line under "Your bag is empty" — the one sentence that has to be true about *this* person.
 * A bag with nothing in it says what it can offer, and never congratulates itself on offering it.
 */
export function emptyBagBlurb(input: {
  recentCount: number
  suggestionCount: number
  near?: boolean
}): string {
  const hasRecent = input.recentCount > 0
  const hasSuggestions = input.suggestionCount > 0
  if (hasRecent && hasSuggestions) {
    return input.near
      ? 'Nothing saved yet. Pick up where you left off, or see what is being bought near you.'
      : 'Nothing saved yet. Pick up where you left off, or see what is moving right now.'
  }
  if (hasRecent) return 'Nothing saved yet. Here is what you were looking at.'
  if (hasSuggestions) {
    return input.near
      ? 'Nothing saved yet. Here is what is being bought near you.'
      : 'Nothing saved yet. Here is what people are buying right now.'
  }
  return 'Browse stores and tap the bag on any product to save it here.'
}

/** "✓ 12 bought", trimmed to nothing when nobody has. */
export function boughtWords(count: number): string {
  const n = Math.max(0, Math.floor(count || 0))
  if (n <= 0) return ''
  return `✓ ${n > 999 ? '999+' : n} bought`
}
