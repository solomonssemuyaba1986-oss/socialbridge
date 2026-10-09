import { useEffect, useState, useRef } from 'react'
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore'
import { onAuthStateChanged } from 'firebase/auth'
import { auth, db } from './firebase'

export interface SellerOrder {
  id: string
  buyerName: string
  /** Who placed it — the seller needs it to reach them in the thread. */
  buyerUid?: string
  productName: string
  productPrice: string
  quantity: number | string
  deliveryArea?: string
  orderId?: string
  status?: string
  message?: string
  sourcePlatform?: string
  createdAt: { toDate?: () => Date } | null
  read?: boolean
  productId?: string
  /** The colour/size the buyer chose in the details sheet, when they chose one. */
  color?: string
  size?: string
  /**
   * What the online payment recorded about the money. Both flows write these onto the order
   * (`functions/index.js`), and until now nothing read them — a buyer who had paid still showed as
   * "Pending". `orderPayment.ts` is what turns them into words; the harnesses pin the two together.
   */
  paymentProcessor?: string
  paymentStatus?: string
  paymentDepositId?: string
  paymentProvider?: string
  paymentMethod?: string
  paymentAmount?: number
  paymentCurrency?: string
  paymentNote?: string
  paymentInitiatedAt?: { toDate?: () => Date } | null
  paymentUpdatedAt?: { toDate?: () => Date } | null
  paymentAttempts?: number
  /** Set with `status: 'paid'` by the server when the money landed — never by the seller. */
  paidAt?: { toDate?: () => Date } | null
  /**
   * Stamped by every status change. The seller may only write a return decision onto an order that
   * is already `fulfilled`, so on a delivered order the last `updatedAt` *is* the delivery date —
   * which is what the seven days are counted from (`returnView.deliveredAtMsOf`).
   */
  updatedAt?: { toDate?: () => Date } | null
  /**
   * ↩️ The return: the buyer's request, and the seller's answer to it. The seller writes only
   * `returnState`, `returnNote` and `returnDecidedAt` (`firestore.rules`) — never `updatedAt`,
   * so answering a return cannot move the delivery date it is counted from.
   */
  returnState?: string
  returnReason?: string
  returnFault?: string
  returnNote?: string
  returnRequestedAt?: number
  returnUpdatedAt?: number
  returnDecidedAt?: number
  /**
   * ⭐ When the seller asked for a rating. Written once and never again (`firestore.rules`), so
   * this is both the record that the ask went out and the reason the button stops offering it.
   * It is not `updatedAt`: asking must not move the delivery date the return window runs from.
   */
  reviewAskedAt?: number
}

export function isUnread(order: SellerOrder): boolean {
  return order.read !== true
}

export function useSellerOrders(onNewUnread?: () => void) {
  const [orders, setOrders] = useState<SellerOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState('')
  const prevUnreadRef = useRef<number | null>(null)
  const onNewUnreadRef = useRef(onNewUnread)
  onNewUnreadRef.current = onNewUnread

  useEffect(() => {
    let ordersUnsub: (() => void) | undefined

    const authUnsub = onAuthStateChanged(auth, (user) => {
      ordersUnsub?.()
      if (!user) {
        setOrders([])
        setUserId('')
        setLoading(false)
        prevUnreadRef.current = null
        return
      }

      setUserId(user.uid)
      setLoading(true)

      const q = query(
        collection(db, 'sellers', user.uid, 'orders'),
        orderBy('createdAt', 'desc')
      )

      ordersUnsub = onSnapshot(q, (snap) => {
        const next = snap.docs.map(d => ({ id: d.id, ...d.data() } as SellerOrder))
        const unread = next.filter(isUnread).length

        if (prevUnreadRef.current !== null && unread > prevUnreadRef.current) {
          onNewUnreadRef.current?.()
        }
        prevUnreadRef.current = unread

        setOrders(next)
        setLoading(false)
      })
    })

    return () => {
      authUnsub()
      ordersUnsub?.()
    }
  }, [])

  const unreadCount = orders.filter(isUnread).length

  return { orders, unreadCount, loading, userId }
}
