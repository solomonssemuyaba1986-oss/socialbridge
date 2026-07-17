import { useEffect, useState } from 'react'
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore'
import { onAuthStateChanged } from 'firebase/auth'
import { auth, db } from './firebase'

export interface BuyerConversation {
  id: string
  sellerId: string
  buyerId: string
  sellerName: string
  buyerName: string
  lastMessage: string
  lastMessageAt: any
  unreadByBuyer: boolean
  productName?: string
  productPrice?: string
  productImage?: string
}

export function useBuyerConversations() {
  const [conversations, setConversations] = useState<BuyerConversation[]>([])
  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState<string | null>(null)

  useEffect(() => {
    let unsub: (() => void) | undefined

    const authUnsub = onAuthStateChanged(auth, (user) => {
      unsub?.()
      if (!user) {
        setConversations([])
        setUserId(null)
        setLoading(false)
        return
      }

      setUserId(user.uid)
      setLoading(true)

      const q = query(
        collection(db, 'conversations'),
        where('buyerId', '==', user.uid),
        orderBy('lastMessageAt', 'desc')
      )

      unsub = onSnapshot(q, (snap) => {
        setConversations(snap.docs.map(d => ({ id: d.id, ...d.data() } as BuyerConversation)))
        setLoading(false)
      }, (err) => {
        console.error('Failed to load buyer conversations:', err)
        setLoading(false)
      })
    })

    return () => {
      authUnsub()
      unsub?.()
    }
  }, [])

  const unreadCount = conversations.filter(c => c.unreadByBuyer).length

  return { conversations, unreadCount, loading, userId }
}
