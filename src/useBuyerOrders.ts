import { useCallback, useEffect, useRef, useState } from 'react'
import { collection, collectionGroup, getDocs, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore'
import { onAuthStateChanged } from 'firebase/auth'
import { db, auth } from './firebase'

/**
 * "Everything I have ever ordered, from every shop."
 *
 * Orders live under each **seller** (`sellers/{sellerId}/orders/{id}`), so a buyer's own orders
 * are scattered across the whole database. This asks the one question that gathers them:
 * "orders where `buyerUid` is me, newest first" — which is what the `orders` collection-group
 * index in `firestore.indexes.json` exists for.
 *
 * Live, not a snapshot: a seller tapping ✓ Confirm while the buyer is looking flips the row
 * to "Delivered" by itself.
 *
 * `buyerUid` is written on every order the app creates. Orders from before that field existed
 * (the old guest flow) will not match — they are simply not yours any more.
 */

export interface BuyerOrder {
  /** The order document's own id. */
  id: string
  /** Taken from the path — `sellers/{sellerId}/orders/{id}`. */
  sellerId: string
  buyerName?: string
  buyerUid?: string
  productId?: string
  productName?: string
  productPrice?: string
  /** Only on orders placed after this was added — older ones have no thumbnail. */
  productImage?: string
  quantity?: number | string
  deliveryArea?: string
  /** The colour/size chosen in the details sheet — absent on older orders, and on products
   *  that never listed any options. */
  color?: string
  size?: string
  orderId?: string
  status?: string
  sourcePlatform?: string
  createdAt?: unknown
  /** Stamped every time the seller changes the status — see `OrderHistory.updateOrderStatus`. */
  updatedAt?: unknown
}

/** How many orders the first screen carries, and how many more each tap adds. */
export const BUYER_ORDERS_PAGE = 20

/**
 * The rules refuse the question (usually a deploy that hasn't been run yet). This is *not* an
 * offline state, and telling somebody with real orders that they have no internet is a lie that
 * costs trust — so it gets its own answer.
 */
function isBlocked(err: unknown): boolean {
  return String((err as { code?: string })?.code || '') === 'permission-denied'
}

/** Firestore Timestamp / Date / number → ms, so rows can be sorted without an index. */
function toMs(value: unknown): number {
  if (value && typeof value === 'object' && typeof (value as { toMillis?: () => number }).toMillis === 'function') {
    return (value as { toMillis: () => number }).toMillis()
  }
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number') return value
  return 0
}

/** A real account, or null — anonymous accounts are guests and have no orders. */
function realUid(user: { uid: string; isAnonymous: boolean } | null): string | null {
  if (!user || user.isAnonymous) return null
  return user.uid
}

/**
 * The slow way to find a buyer's orders — and the reason the page keeps working before the
 * collection-group index exists.
 *
 * Firebase cannot answer "all orders where buyerUid == me" across every shop without that index.
 * But a buyer's orders are always reachable another way: they are the shops this person has
 * actually touched. So we collect those shops first (from their threads — no index needed — and
 * from their bag), then ask each shop's orders for `buyerUid == me` (a single equality inside one
 * subcollection, which needs no index at all), and sort client-side.
 */
async function readOrdersTheSlowWay(uid: string, pageSize: number): Promise<{ rows: BuyerOrder[]; denied: boolean }> {
  const sellerIds = new Set<string>()

  // 1. Threads this buyer is part of. A top-level equality query — no composite index.
  try {
    const convos = await getDocs(query(collection(db, 'conversations'), where('buyerId', '==', uid)))
    convos.docs.forEach(d => {
      const sellerId = String((d.data() as { sellerId?: unknown }).sellerId || '')
      if (sellerId) sellerIds.add(sellerId)
    })
  } catch (err) {
    console.warn('Buyer orders (slow way): could not list threads', err)
  }

  // 2. The shops in their bag — the same signal a buyer would expect to count.
  try {
    const bag = await getDocs(collection(db, 'users', uid, 'bag'))
    bag.docs.forEach(d => {
      const sellerId = String((d.data() as { sellerId?: unknown }).sellerId || '')
      if (sellerId) sellerIds.add(sellerId)
    })
  } catch (err) {
    console.warn('Buyer orders (slow way): could not read the bag', err)
  }

  // 3. One question per shop, then newest first. A shop that refuses (rules not deployed yet)
  //    must not sink the others — we keep whatever answered, and only report a refusal if *every*
  //    shop refused and nothing at all came back.
  const rows: BuyerOrder[] = []
  let attempts = 0
  let refusals = 0
  await Promise.all([...sellerIds].map(async sellerId => {
    attempts++
    try {
      const snap = await getDocs(query(collection(db, 'sellers', sellerId, 'orders'), where('buyerUid', '==', uid)))
      snap.docs.forEach(d => {
        rows.push({ ...(d.data() as Omit<BuyerOrder, 'id' | 'sellerId'>), id: d.id, sellerId })
      })
    } catch (err) {
      if (isBlocked(err)) refusals++
      console.warn('Buyer orders (slow way): could not read shop', sellerId, err)
    }
  }))

  rows.sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt))
  return { rows: rows.slice(0, pageSize), denied: attempts > 0 && refusals === attempts }
}

export function useBuyerOrders() {
  const [orders, setOrders] = useState<BuyerOrder[]>([])
  const [loading, setLoading] = useState(true)
  /** 'index' = Firebase cannot answer this question yet; 'offline' = no connection. */
  const [error, setError] = useState<'setup' | 'offline' | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [pageSize, setPageSize] = useState(BUYER_ORDERS_PAGE)
  const [reloadToken, setReloadToken] = useState(0)
  const [uid, setUid] = useState<string | null>(realUid(auth.currentUser))
  /** 'feed' = the one-shot index query; 'slow' = per-shop reads while it isn't available. */
  const modeRef = useRef<'feed' | 'slow'>('feed')

  /** The no-index path, used whenever the fast query can't be answered. */
  const readTheSlowWay = useCallback(async (buyerId: string, size: number) => {
    try {
      const { rows, denied } = await readOrdersTheSlowWay(buyerId, size)
      setOrders(rows)
      setHasMore(rows.length >= size)
      // Having the orders is what matters. A missing index is our problem, not the buyer's — so
      // we say nothing about it as long as something answered.
      setError(denied && rows.length === 0 ? 'setup' : null)
    } catch (err) {
      console.warn('Buyer orders (slow way) failed:', err)
      setError(isBlocked(err) ? 'setup' : 'offline')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, user => {
      // Anonymous accounts are guests everywhere else — they cannot have placed an order.
      setUid(realUid(user))
    })
    return () => unsub()
  }, [])

  useEffect(() => {
    if (!uid) return
    if (modeRef.current === 'slow') {
      void readTheSlowWay(uid, pageSize)
      return
    }
    const q = query(
      collectionGroup(db, 'orders'),
      where('buyerUid', '==', uid),
      orderBy('createdAt', 'desc'),
      limit(pageSize),
    )

    const unsub = onSnapshot(
      q,
      snap => {
        setOrders(snap.docs.map(d => {
          const data = d.data() as Omit<BuyerOrder, 'id' | 'sellerId'>
          return { ...data, id: d.id, sellerId: d.ref.parent.parent?.id || '' }
        }))
        // A full page means there is probably more behind it.
        setHasMore(snap.size >= pageSize)
        setError(null)
        setLoading(false)
      },
      err => {
        // The index (or the rules) can't answer this question. Read it the slow way instead of
        // telling somebody who has real orders that they have no internet.
        console.warn('Buyer orders: the fast query is unavailable — reading shop by shop.', err)
        modeRef.current = 'slow'
        void readTheSlowWay(uid, pageSize)
      },
    )
    return () => unsub()
  }, [uid, pageSize, reloadToken, readTheSlowWay])

  const loadMore = useCallback(() => setPageSize(n => n + BUYER_ORDERS_PAGE), [])
  /**
   * "Try again" — and the moment to go back to the fast path, since the reason we were on the slow
   * one was almost certainly a deploy somebody has now run.
   */
  const reload = useCallback(() => {
    modeRef.current = 'feed'
    setReloadToken(n => n + 1)
  }, [])

  /**
   * Nothing is reset in an effect: without an account there is simply nothing to show, so the
   * signed-out answer is derived here. (A page that is open when someone signs out must not
   * keep showing their orders either.)
   */
  return {
    orders: uid ? orders : [],
    loading: uid ? loading : false,
    error: uid ? error : null,
    hasMore: uid ? hasMore : false,
    loadMore,
    reload,
  }
}
