import { useEffect, useState } from 'react'
import { collection, query, where, onSnapshot } from 'firebase/firestore'
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
        where('sellerId', '==', user.uid)
      )

      unsub = onSnapshot(q, (snap) => {
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as SellerConversation))
        // Sort client-side to avoid Firestore composite index requirement
        list.sort((a, b) => {
          const dateA = a.lastMessageAt?.toDate?.()?.getTime() || 0
          const dateB = b.lastMessageAt?.toDate?.()?.getTime() || 0
          return dateB - dateA
        })
        setConversations(list)
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