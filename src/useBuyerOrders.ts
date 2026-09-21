import { useCallback, useEffect, useState } from 'react'
import { collectionGroup, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore'
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

function isMissingIndex(err: unknown): boolean {
  const code = String((err as { code?: string })?.code || '')
  const message = String((err as { message?: string })?.message || '')
  return code === 'failed-precondition' || /index/i.test(message)
}

/** A real account, or null — anonymous accounts are guests and have no orders. */
function realUid(user: { uid: string; isAnonymous: boolean } | null): string | null {
  if (!user || user.isAnonymous) return null
  return user.uid
}

export function useBuyerOrders() {
  const [orders, setOrders] = useState<BuyerOrder[]>([])
  const [loading, setLoading] = useState(true)
  /** 'index' = Firebase cannot answer this question yet; 'offline' = no connection. */
  const [error, setError] = useState<'index' | 'offline' | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [pageSize, setPageSize] = useState(BUYER_ORDERS_PAGE)
  const [reloadToken, setReloadToken] = useState(0)
  const [uid, setUid] = useState<string | null>(realUid(auth.currentUser))

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, user => {
      // Anonymous accounts are guests everywhere else — they cannot have placed an order.
      setUid(realUid(user))
    })
    return () => unsub()
  }, [])

  useEffect(() => {
    if (!uid) return
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
        console.warn('Buyer orders listener error:', err)
        setError(isMissingIndex(err) ? 'index' : 'offline')
        setLoading(false)
      },
    )
    return () => unsub()
  }, [uid, pageSize, reloadToken])

  const loadMore = useCallback(() => setPageSize(n => n + BUYER_ORDERS_PAGE), [])
  /** Used by "Try again" after the index has been switched on. */
  const reload = useCallback(() => setReloadToken(n => n + 1), [])

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
