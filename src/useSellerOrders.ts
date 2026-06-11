import { useEffect, useState, useRef } from 'react'
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore'
import { onAuthStateChanged } from 'firebase/auth'
import { auth, db } from './firebase'

export interface SellerOrder {
  id: string
  buyerName: string
  productName: string
  productPrice: string
  quantity: number | string
  deliveryArea?: string
  orderId?: string
  status?: string
  message?: string
  createdAt: { toDate?: () => Date } | null
  read?: boolean
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
