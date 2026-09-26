/**
 * What somebody looked at, and when.
 *
 * Browse and Nearby keep **separate** histories on purpose: the same product opened from two places
 * answers two different questions — "what was I shopping for" versus "what is around me" — so they
 * are stored under different keys and never merged into one list.
 *
 * `timeAgo` (reviewUtils) already knows how to say how fresh a single view is. What this module adds
 * is the thing people actually remember by: intervals. Today, yesterday, past 3 days, this week,
 * last week, this month, last month.
 *
 * Pure on purpose — no React, no Firestore, no storage — so every rule here can be reasoned about
 * against a fixed `now`. The keeping of it lives in `useViewHistory`.
 */

/** Where a history came from. The key, the analytics and the copy all hang off this. */
export type HistorySurface = 'browse' | 'nearby'

/** One thing they looked at. Everything here is what a card needs to be drawn again. */
export interface ViewEntry {
  productId: string
  name: string
  price: string
  imageUrl: string
  sellerId: string
  /** Kept as a fallback: a product document may not carry its shop's public fields. */
  sellerSlug: string
  businessName: string
  /** When they last opened it (ms). Opening it again moves it up; it never repeats. */
  at: number
}

/** The fields a view is built from, in whatever shape a page happens to hold its products. */
export interface ViewProduct {
  id?: unknown
  productId?: unknown
  name?: unknown
  price?: unknown
  imageUrl?: unknown
  images?: unknown
  sellerId?: unknown
  sellerSlug?: unknown
  businessName?: unknown
}

/**
 * How much we keep, per surface. About a month of shopping for one person, a few kilobytes of
 * storage — this is a convenience, not an archive.
 */
export const HISTORY_MAX = 60

/** Past this, an entry is dropped: older than the last interval we have a name for. */
export const HISTORY_MAX_AGE_DAYS = 62

export type HistoryBucket = 'today' | 'yesterday' | 'threeDays' | 'week' | 'lastWeek' | 'month' | 'lastMonth'

/** Newest first — the order somebody reads them in. */
export const BUCKET_ORDER: HistoryBucket[] = [
  'today', 'yesterday', 'threeDays', 'week', 'lastWeek', 'month', 'lastMonth',
]

export const BUCKET_LABEL: Record<HistoryBucket, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  threeDays: 'Past 3 days',
  week: 'This week',
  lastWeek: 'Last week',
  month: 'This month',
  lastMonth: 'Last month',
}

const DAY = 24 * 60 * 60 * 1000

/** "40,000" stays "40,000"; 40000 becomes "40000"; junk becomes ''. */
function line(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

/**
 * Which interval a view belongs to — measured in **elapsed hours**, never calendar dates, so no
 * timezone can move yesterday's shopping into today. `null` means older than we keep.
 *
 *   0–1d today · 1–2d yesterday · 2–3d past 3 days · 3–7d this week · 7–14d last week ·
 *   14–31d this month · 31–62d last month
 *
 * A stamp in the future (a clock that moved) counts as today: it is happening now.
 */
export function bucketFor(at: number, now = Date.now()): HistoryBucket | null {
  const when = Number(at)
  if (!Number.isFinite(when)) return null

  const days = (now - when) / DAY
  if (days < 1) return 'today'
  if (days < 2) return 'yesterday'
  if (days < 3) return 'threeDays'
  if (days < 7) return 'week'
  if (days < 14) return 'lastWeek'
  if (days < 31) return 'month'
  if (days < HISTORY_MAX_AGE_DAYS) return 'lastMonth'
  return null
}

/** The interval's name for a single view — the strip needs it without building the groups. */
export function bucketLabelFor(at: number, now = Date.now()): string {
  const bucket = bucketFor(at, now)
  return bucket ? BUCKET_LABEL[bucket] : 'Older'
}

/**
 * A view, built from a page's product. Returns null rather than storing a row that cannot work: no
 * id means it could never be opened again, and no name means a blank chip nobody can recognise.
 */
export function toViewEntry(product?: ViewProduct | null, at = Date.now()): ViewEntry | null {
  if (!product || typeof product !== 'object') return null

  const productId = line(product.productId) || line(product.id)
  const name = line(product.name)
  if (!productId || !name) return null

  const images = Array.isArray(product.images) ? product.images : []
  const when = Number(at)

  return {
    productId,
    name,
    price: line(product.price),
    imageUrl: line(product.imageUrl) || line(images[0]),
    sellerId: line(product.sellerId),
    sellerSlug: line(product.sellerSlug),
    businessName: line(product.businessName),
    at: Number.isFinite(when) && when > 0 ? when : Date.now(),
  }
}

/** Newest first, one row per product, and nothing older than the last interval we can name. */
export function pruneHistory(entries: ViewEntry[], now = Date.now()): ViewEntry[] {
  return entries
    .filter(entry => bucketFor(entry.at, now) !== null)
    .sort((a, b) => b.at - a.at)
    .slice(0, HISTORY_MAX)
}

/**
 * Add a view to the list. Opening something a second time **moves it to the top** rather than adding
 * a second row — a history that repeats itself is a history nobody reads.
 */
export function mergeView(entries: ViewEntry[], next: ViewEntry, now = Date.now()): ViewEntry[] {
  return pruneHistory([next, ...entries.filter(entry => entry.productId !== next.productId)], now)
}

/** Read whatever is in storage. Junk, a foreign shape or a hand-edited key is simply forgotten. */
export function parseHistory(raw: unknown, now = Date.now()): ViewEntry[] {
  if (typeof raw !== 'string' || raw.trim() === '') return []

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []

  const entries: ViewEntry[] = []
  for (const item of parsed) {
    const at = Number((item as { at?: unknown } | null)?.at)
    // No timestamp means no idea when it happened — not something we can put in an interval.
    if (!Number.isFinite(at) || at <= 0) continue
    const entry = toViewEntry(item as ViewProduct, at)
    if (entry) entries.push(entry)
  }
  return pruneHistory(entries, now)
}

export interface HistoryGroup {
  bucket: HistoryBucket
  label: string
  entries: ViewEntry[]
}

/** The list folded into intervals, newest first — intervals with nothing in them are left out. */
export function groupHistory(entries: ViewEntry[], now = Date.now()): HistoryGroup[] {
  const sorted = [...entries].sort((a, b) => b.at - a.at)
  const groups: HistoryGroup[] = []
  for (const bucket of BUCKET_ORDER) {
    const inBucket = sorted.filter(entry => bucketFor(entry.at, now) === bucket)
    if (inBucket.length > 0) groups.push({ bucket, label: BUCKET_LABEL[bucket], entries: inBucket })
  }
  return groups
}

