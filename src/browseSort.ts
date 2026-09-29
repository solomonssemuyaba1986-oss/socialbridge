/**
 * How the market is ordered — one place, so a sort means the same thing on every page.
 *
 * Four rules this module keeps:
 *
 *  - **"Popular" and "Trending" are not the same promise.** *Popular* is everything a listing has
 *    ever moved (orders count double, a completed sale counts too — the same definition Nearby and
 *    the Browse rail already used). *Trending* is the same movement **per unit of freshness**, so
 *    something gaining orders this week is not buried under a listing that was busy last year.
 *  - **Nothing dead floats up.** A product with no orders and no sales scores zero on both, so it
 *    can never outrank something that is actually selling. Among zeros the tie is broken by
 *    *newest first* — the one honest way to order things nobody has bought yet.
 *  - **Distance is never guessed.** `nearby` sorts by the seller's stored coordinates against the
 *    buyer's own area; when either is missing the product goes **last**, in the order relevance
 *    already put it. `nearbyNeedsArea()` is what a page asks before offering the option at all.
 *  - **Every key has words.** The select's options come from here, so a sort can never be offered
 *    without saying what it does — and no page can quietly offer a different set.
 */
export interface SortableProduct {
  id?: string
  sellerId?: string
  price?: string
  orderCount?: number
  salesCount?: number
  /** Firestore Timestamp, ms number, or ISO string — whichever the document happens to hold. */
  createdAt?: unknown
  /** NearbyPage hands this in already converted; the module prefers it when present. */
  createdAtMs?: number
}

/** A point on the map. Structurally the same as `GeoPoint` in `place.ts`, kept local so this module has no imports. */
export interface Point {
  lat: number
  lng: number
}

export type SortKey =
  | 'relevance'
  | 'price-asc'
  | 'price-desc'
  | 'popular'
  | 'trending'
  | 'newest'
  | 'nearby'

/** The order the select shows them in: default first, then price, then movement, then place. */
export const SORT_KEYS: SortKey[] = ['relevance', 'price-asc', 'price-desc', 'popular', 'trending', 'newest', 'nearby']

export const SORT_LABELS: Record<SortKey, string> = {
  relevance: 'Sort: Relevance',
  'price-asc': 'Sort: Price (Low → High)',
  'price-desc': 'Sort: Price (High → Low)',
  popular: 'Sort: Most Popular',
  trending: 'Sort: Trending now',
  newest: 'Sort: Newest',
  nearby: 'Sort: Nearby (closest shop first)',
}

/** What a page says when `nearby` is chosen but we do not know their area yet. */
export const NEARBY_NO_AREA_HINT = 'Add your area to sort by distance. It stays on this phone.'

const DAY_MS = 24 * 60 * 60 * 1000
/** Movement halves roughly every month of shelf life — the decay that separates Trending from Popular. */
export const TRENDING_HALF_LIFE_DAYS = 30

/** "40,000" → 40000. The same reading the bag, the order form and the server use. */
export function priceNumber(raw: unknown): number {
  return Number(String(raw ?? '').replace(/[^0-9.]/g, '')) || 0
}

/**
 * When it was listed, in ms — `createdAtMs` if the page already computed it, else whatever shape
 * `createdAt` arrived in. 0 means "we do not know", which is sorted as the oldest thing there is.
 */
export function listedMs(p: SortableProduct): number {
  if (typeof p.createdAtMs === 'number' && p.createdAtMs > 0) return p.createdAtMs
  const value = p.createdAt
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? 0 : parsed
  }
  if (value && typeof (value as { toDate?: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().getTime()
  }
  if (value && typeof (value as { seconds?: number }).seconds === 'number') {
    return (value as { seconds: number }).seconds * 1000
  }
  return 0
}

/** What's actually moving: an order counts double, a completed sale counts once. */
export function popularScore(p: SortableProduct): number {
  return (Number(p.orderCount) || 0) * 2 + (Number(p.salesCount) || 0)
}

/**
 * The same movement, decayed by how long the listing has been up.
 *
 * A product nobody has bought scores 0 — never a small number it could be ranked by. A listing with
 * no known date is placed in the **middle** of the curve rather than at the top: guessing that it was
 * posted today is exactly how an abandoned listing gets handed the best spot on the page.
 */
export function trendingScore(p: SortableProduct, nowMs: number = Date.now()): number {
  const moving = popularScore(p)
  if (moving <= 0) return 0
  const listed = listedMs(p)
  const ageDays = listed > 0 ? Math.max(0, (nowMs - listed) / DAY_MS) : TRENDING_HALF_LIFE_DAYS
  return moving / (1 + ageDays / TRENDING_HALF_LIFE_DAYS)
}

/** Kilometres between two points. Duplicated from `geo.ts` on purpose: no imports, so it can be pinned alone. */
function kmBetween(a: Point, b: Point): number {
  const R = 6371
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

/** Where a seller is, if we know. A product whose shop has no pin has no distance — not a zero one. */
export function distanceToSeller(
  sellerId: string | undefined,
  buyer: Point | null | undefined,
  sellerGeo: Map<string, Point> | null | undefined,
): number | null {
  if (!buyer || !sellerId || !sellerGeo) return null
  const point = sellerGeo.get(sellerId)
  if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return null
  return kmBetween(buyer, point)
}

/**
 * Where each shop is, read from the seller documents a page already has.
 *
 * `0, 0` is the place a map defaults to when nobody chose a pin, so it is dropped along with every
 * other unusable value — a shop we cannot place must come out as *unknown*, never as a shop in the
 * Gulf of Guinea that would beat every real one in a "nearest" sort.
 */
export function sellerGeoFrom(
  rows: (SellerDirectoryRow | null | undefined)[] | null | undefined,
): Map<string, Point> {
  return sellerDirectoryFrom(rows).geo
}

/** The shop document's part a page needs: how to open it, what to call it, and where it is. */
export interface SellerDirectoryRow {
  id?: unknown
  geo?: { lat?: unknown; lng?: unknown } | null
  slug?: unknown
  businessName?: unknown
}

export interface SellerStore {
  id: string
  slug: string
  businessName: string
  /** `null` when we cannot place the shop — the same rule as `geo`, so the two can never disagree. */
  point: Point | null
}

function shopText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * The same read, answering both questions a page asks of a shop document: *where is it* (the pins,
 * for distances — exactly what `sellerGeoFrom` returns) and *how do I open it / what is it called*
 * (the slug and name a product row does not carry itself).
 *
 * One loop, one rule: a pin that is missing, junk or `0, 0` is unknown here and unknown there.
 */
export function sellerDirectoryFrom(
  rows: (SellerDirectoryRow | null | undefined)[] | null | undefined,
): { geo: Map<string, Point>; stores: Map<string, SellerStore> } {
  const geo = new Map<string, Point>()
  const stores = new Map<string, SellerStore>()
  for (const row of rows || []) {
    const id = shopText(row?.id)
    if (!id) continue
    const lat = Number(row?.geo?.lat)
    const lng = Number(row?.geo?.lng)
    const placeable =
      Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0)
    if (placeable) geo.set(id, { lat, lng })
    const slug = shopText(row?.slug)
    const businessName = shopText(row?.businessName)
    // A shop with no slug and no name tells a page nothing it cannot already read — not kept.
    if (!slug && !businessName) continue
    stores.set(id, { id, slug, businessName, point: placeable ? { lat, lng } : null })
  }
  return { geo, stores }
}

export interface SortOptions {
  /** The buyer's own area — device-local (`useBuyerLocation`), never sent anywhere. */
  buyer?: Point | null
  /** Where each shop is: sellerId → coordinates, from the seller documents the page already has. */
  sellerGeo?: Map<string, Point> | null
  /** Anything the page knows that we do not (a like, a look) — used only to break ties. */
  boost?: Map<string, number> | null
}

/**
 * The sorted copy. `relevance` hands back what it was given (the page's own ranking, kept by the
 * stable sort as the tie-break for every other key), and nothing here ever mutates the input.
 */
export function sortProducts<T extends SortableProduct>(
  list: T[],
  key: SortKey,
  options: SortOptions = {},
): T[] {
  const copy = [...list]
  if (key === 'relevance') return copy

  const { buyer, sellerGeo, boost } = options
  const now = Date.now()
  const boostOf = (p: T) => (boost && p.id ? boost.get(p.id) || 0 : 0)

  if (key === 'price-asc') return copy.sort((a, b) => priceNumber(a.price) - priceNumber(b.price))
  if (key === 'price-desc') return copy.sort((a, b) => priceNumber(b.price) - priceNumber(a.price))
  if (key === 'newest') return copy.sort((a, b) => listedMs(b) - listedMs(a))
  if (key === 'popular') return copy.sort((a, b) => popularScore(b) - popularScore(a))
  if (key === 'trending') {
    return copy.sort((a, b) => {
      const diff = trendingScore(b, now) - trendingScore(a, now)
      if (diff !== 0) return diff
      // 0 vs 0 is the common case in a young catalogue: newest first, and nothing else claimed.
      const byDate = listedMs(b) - listedMs(a)
      if (byDate !== 0) return byDate
      return boostOf(b) - boostOf(a)
    })
  }

  // nearby — closest first, and anything we cannot place keeps its relevance order at the end.
  return copy.sort((a, b) => {
    const da = distanceToSeller(a.sellerId, buyer, sellerGeo)
    const db = distanceToSeller(b.sellerId, buyer, sellerGeo)
    if (da === null && db === null) return 0
    if (da === null) return 1
    if (db === null) return -1
    return da - db
  })
}

/**
 * Should the page tell them to set an area? True only for the one sort that needs it — a buyer who
 * never taps Nearby must never be nagged for their location.
 */
export function nearbyNeedsArea(key: SortKey, hasBuyerArea: boolean): boolean {
  return key === 'nearby' && !hasBuyerArea
}

/** "Sorted by what's moving today." — a page's one-line confirmation under the select. */
export function sortWords(key: SortKey): string {
  if (key === 'trending') return "Sorted by what's moving now — recent orders count for more."
  if (key === 'popular') return 'Sorted by everything each listing has moved so far.'
  if (key === 'nearby') return 'Closest shop first. Anything we cannot place comes last.'
  return ''
}

/** The distance in words, or '' when we do not know it — never "0 km" for a shop we cannot place. */
export function distanceWords(km: number | null): string {
  if (km === null || !Number.isFinite(km)) return ''
  if (km < 1) return 'less than 1 km away'
  if (km < 10) return `${km.toFixed(1)} km away`
  return `${Math.round(km)} km away`
}
