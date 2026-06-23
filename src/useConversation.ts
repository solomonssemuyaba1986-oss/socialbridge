import { useState, useEffect } from 'react'
import {
  collection, doc, addDoc, setDoc, getDoc,
  query, orderBy, onSnapshot, serverTimestamp
} from 'firebase/firestore'
import { db } from './firebase'

export function getConversationId(sellerId: string, buyerId: string) {
  return [sellerId, buyerId].sort().join('_')
}

export function useConversation(sellerId: string | null, buyerId: string | null) {
  const [messages, setMessages] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  const conversationId = sellerId && buyerId ? getConversationId(sellerId, buyerId) : null

  useEffect(() => {
    if (!conversationId) return
    const q = query(
      collection(db, 'conversations', conversationId, 'messages'),
      orderBy('createdAt', 'asc')
    )
    const unsub = onSnapshot(q, (snap) => {
      setMessages(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      setLoading(false)
    })
    return unsub
  }, [conversationId])

  const sendMessage = async (senderId: string, text: string, sellerName: string, buyerName: string) => {
    if (!conversationId || !sellerId || !buyerId) return

    const convoRef = doc(db, 'conversations', conversationId)
    const convoSnap = await getDoc(convoRef)

    if (!convoSnap.exists()) {
      await setDoc(convoRef, {
        sellerId, buyerId, sellerName, buyerName,
        lastMessage: text,
        lastMessageAt: serverTimestamp(),
        unreadBySeller: senderId === buyerId,
        unreadByBuyer: senderId === sellerId
      })
    } else {
      await setDoc(convoRef, {
        lastMessage: text,
        lastMessageAt: serverTimestamp(),
        unreadBySeller: senderId === buyerId,
        unreadByBuyer: senderId === sellerId
      }, { merge: true })
    }

    await addDoc(collection(db, 'conversations', conversationId, 'messages'), {
      senderId, text, createdAt: serverTimestamp()
    })
  }

  return { messages, loading, sendMessage, conversationId }
}