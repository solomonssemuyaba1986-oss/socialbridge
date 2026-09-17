import { useCallback, useEffect, useRef, useState } from 'react'
import {
  collection,
  collectionGroup,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { db } from './firebase'

/** A product row plus the store it belongs to. */
export interface FeedProduct extends DocumentData {
  id: string
  sellerId: string
}

interface Options {
  /** How many products each page carries. */
  pageSize?: number
}

/** How many stores we walk per page when running on the fallback path. */
const FALLBACK_SELLERS_PER_PAGE = 10

function createdMs(row: DocumentData): number {
  const value = row.createdAt
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? 0 : parsed
  }
  if (value && typeof (value as { toDate?: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().getTime()
  }
  return 0
}

/**
 * The Browse catalog feed.
 *
 * One paged query — `collectionGroup('products')`, newest first — instead of reading
 * every store's products one at a time. The old shape capped the page at the first
 * 50 stores (Firestore returns documents in document-ID order, i.e. random uids) and
 * cost 51 reads on every visit.
 *
 * If the collection-group index hasn't been deployed yet the query fails, so we fall
 * back to the old per-seller walk (a batch of stores at a time) — the page keeps
 * working and the console says exactly which index to create.
 */
/**
 * Survives remounts, so going Browse → store → back is instant instead of showing
 * a full-screen loader again. Kept short-lived on purpose (a stale catalogue is
 * worse than a fresh one) — the background refresh below replaces it either way.
 */
interface FeedCache {
  rows: FeedProduct[]
  cursor: QueryDocumentSnapshot | null
  hasMore: boolean
  mode: 'feed' | 'fallback'
  updatedAt: number
}

let feedCache: FeedCache | null = null
const FEED_CACHE_MAX_AGE_MS = 5 * 60 * 1000

function readCache(): FeedCache | null {
  if (!feedCache) return null
  if (Date.now() - feedCache.updatedAt > FEED_CACHE_MAX_AGE_MS) return null
  return feedCache
}

export function useProductFeed({ pageSize = 24 }: Options = {}) {
  const cached = readCache()
  const [products, setProducts] = useState<FeedProduct[]>(() => cached?.rows ?? [])
  /** Only a genuine cold start counts as "loading" — a cached page refreshes quietly. */
  const [loading, setLoading] = useState(() => !cached)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(() => cached?.hasMore ?? true)
  const [error, setError] = useState('')
  /** True while we already have rows on screen and are refreshing them. */
  const [refreshing, setRefreshing] = useState(false)
  const cursorRef = useRef<QueryDocumentSnapshot | null>(cached?.cursor ?? null)
  const modeRef = useRef<'feed' | 'fallback'>(cached?.mode ?? 'feed')
  const fallbackSellersRef = useRef<string[]>([])
  const fallbackIndexRef = useRef(0)
  const inFlightRef = useRef(false)
  const rowsRef = useRef<FeedProduct[]>(cached?.rows ?? [])

  const readFeedPage = useCallback(async (first: boolean) => {
    const base = collectionGroup(db, 'products')
    const ordered = orderBy('createdAt', 'desc')
    const q = !first && cursorRef.current
      ? query(base, ordered, startAfter(cursorRef.current), limit(pageSize))
      : query(base, ordered, limit(pageSize))

    const snap = await getDocs(q)
    cursorRef.current = snap.docs[snap.docs.length - 1] || null
    return {
      rows: snap.docs.map(d => ({
        ...(d.data() as DocumentData),
        id: d.id,
        sellerId: d.ref.parent.parent?.id || '',
      })) as FeedProduct[],
      more: snap.size === pageSize,
    }
  }, [pageSize])

  const readFallbackPage = useCallback(async (first: boolean) => {
    if (first || fallbackSellersRef.current.length === 0) {
      const sellerSnap = await getDocs(collection(db, 'sellers'))
      fallbackSellersRef.current = sellerSnap.docs
        .filter(d => String(d.data().slug || '').trim())
        .map(d => d.id)
      fallbackIndexRef.current = 0
    }

    const batch = fallbackSellersRef.current.slice(
      fallbackIndexRef.current,
      fallbackIndexRef.current + FALLBACK_SELLERS_PER_PAGE,
    )
    fallbackIndexRef.current += batch.length

    const rows: FeedProduct[] = []
    for (const sellerId of batch) {
      try {
        const snap = await getDocs(collection(db, 'sellers', sellerId, 'products'))
        snap.docs.forEach(d => rows.push({
          ...(d.data() as DocumentData),
          id: d.id,
          sellerId,
        } as FeedProduct))
      } catch (err) {
        console.warn('BrowsePage: could not read products for store', sellerId, err)
      }
    }
    rows.sort((a, b) => createdMs(b) - createdMs(a))
    return { rows, more: fallbackIndexRef.current < fallbackSellersRef.current.length }
  }, [])

  const load = useCallback(async (first: boolean) => {
    if (inFlightRef.current) return
    inFlightRef.current = true
    const coldStart = first && rowsRef.current.length === 0
    if (coldStart) setLoading(true)
    else if (first) setRefreshing(true)
    else setLoadingMore(true)

    try {
      let page
      if (modeRef.current === 'feed') {
        try {
          page = await readFeedPage(first)
        } catch (err) {
          // No collection-group index yet → keep the page alive on the old path.
          console.warn(
            'BrowsePage: catalog feed needs an index — falling back to per-store reads.\n' +
            'Create it with: firebase deploy --only firestore:indexes  (see firestore.indexes.json)\n',
            err,
          )
          modeRef.current = 'fallback'
          page = await readFallbackPage(first)
        }
      } else {
        page = await readFallbackPage(first)
      }

      const nextRows = first ? page.rows : [...rowsRef.current, ...page.rows]
      rowsRef.current = nextRows
      setProducts(nextRows)
      setHasMore(page.more)
      setError('')
      // Remember it so a remount (Browse → store → back) is instant.
      feedCache = {
        rows: nextRows,
        cursor: cursorRef.current,
        hasMore: page.more,
        mode: modeRef.current,
        updatedAt: Date.now(),
      }
    } catch (err) {
      console.error('BrowsePage: catalog load failed', err)
      setError('Could not load the catalog. Check your connection and try again.')
      setHasMore(false)
    } finally {
      inFlightRef.current = false
      setLoading(false)
      setLoadingMore(false)
      setRefreshing(false)
    }
  }, [readFeedPage, readFallbackPage])

  useEffect(() => {
    // Kick the first page off just after the effect body — setting state straight
    // inside an effect triggers cascading renders.
    const timer = window.setTimeout(() => { void load(true) }, 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const loadMore = useCallback(() => { void load(false) }, [load])
  const reload = useCallback(() => { void load(true) }, [load])

  return { products, loading, loadingMore, refreshing, hasMore, error, loadMore, reload }
}

/** Used by tests/tools to prove the cache behaves; harmless in the app. */
export function __resetFeedCache() {
  feedCache = null
}
