import { useEffect, useState } from 'react'
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore'
import { onAuthStateChanged } from 'firebase/auth'
import { auth, db } from './firebase'

export interface SellerConversation {
  id: string
  sellerId: string
  buyerId: string
  sellerName: string
  buyerName: string
  lastMessage: string
  lastMessageAt: any
  unreadBySeller: boolean
  productName?: string
  productPrice?: string
  productImage?: string
}

export function useSellerConversations() {
  const [conversations, setConversations] = useState<SellerConversation[]>([])
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
        where('sellerId', '==', user.uid),
        orderBy('lastMessageAt', 'desc')
      )

      unsub = onSnapshot(q, (snap) => {
        setConversations(snap.docs.map(d => ({ id: d.id, ...d.data() } as SellerConversation)))
        setLoading(false)
      }, (err) => {
        console.error('Failed to load seller conversations:', err)
        setLoading(false)
      })
    })

    return () => {
      authUnsub()
      unsub?.()
    }
  }, [])

  const unreadCount = conversations.filter(c => c.unreadBySeller).length

  return { conversations, unreadCount, loading, userId }
}
