import { useEffect, useState } from 'react'
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore'
import { onAuthStateChanged } from 'firebase/auth'
import { auth, db } from './firebase'

export interface SellerMessage {
  id: string
  senderUid: string
  senderEmail?: string
  senderName: string
  receiverUid: string
  productId?: string
  productName: string
  productPrice?: string
  text: string
  createdAt: { toDate?: () => Date } | null
  read?: boolean
  verified?: boolean
  senderPhone?: string
  sourcePlatform?: string
}

export function isUnreadMessage(msg: SellerMessage): boolean {
  return msg.read !== true
}

export function useSellerMessages() {
  const [messages, setMessages] = useState<SellerMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState('')

  useEffect(() => {
    let messagesUnsub: (() => void) | undefined

    const authUnsub = onAuthStateChanged(auth, (user) => {
      messagesUnsub?.()
      if (!user) {
        setMessages([])
        setUserId('')
        setLoading(false)
        return
      }

      setUserId(user.uid)
      setLoading(true)

      const q = query(
        collection(db, 'sellers', user.uid, 'messages'),
        orderBy('createdAt', 'desc')
      )

      messagesUnsub = onSnapshot(
        q,
        (snap) => {
          setMessages(snap.docs.map(d => ({ id: d.id, ...d.data() } as SellerMessage)))
          setLoading(false)
        },
        (err) => {
          console.error('Failed to load messages:', err)
          setLoading(false)
        }
      )
    })

    return () => {
      authUnsub()
      messagesUnsub?.()
    }
  }, [])

  const unreadCount = messages.filter(isUnreadMessage).length

  return { messages, unreadCount, loading, userId }
}
