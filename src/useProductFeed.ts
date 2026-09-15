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
export function useProductFeed({ pageSize = 24 }: Options = {}) {
  const [products, setProducts] = useState<FeedProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [error, setError] = useState('')

  const cursorRef = useRef<QueryDocumentSnapshot | null>(null)
  const modeRef = useRef<'feed' | 'fallback'>('feed')
  const fallbackSellersRef = useRef<string[]>([])
  const fallbackIndexRef = useRef(0)
  const inFlightRef = useRef(false)

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
    if (first) setLoading(true)
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

      setProducts(prev => (first ? page.rows : [...prev, ...page.rows]))
      setHasMore(page.more)
      setError('')
    } catch (err) {
      console.error('BrowsePage: catalog load failed', err)
      setError('Could not load the catalog. Check your connection and try again.')
      setHasMore(false)
    } finally {
      inFlightRef.current = false
      setLoading(false)
      setLoadingMore(false)
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

  return { products, loading, loadingMore, hasMore, error, loadMore, reload }
}
