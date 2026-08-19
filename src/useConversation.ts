import { useState, useEffect } from 'react'
import {
  collection, doc, addDoc, setDoc, getDoc, increment, updateDoc,
  query, orderBy, onSnapshot, serverTimestamp
} from 'firebase/firestore'
import { db, auth } from './firebase'

export function getConversationId(sellerId: string, buyerId: string) {
  return [sellerId, buyerId].sort().join('_')
}

export async function markConversationRead(
  conversationId: string,
  userId: string,
  sellerId: string,
  buyerId: string
) {
  const patch: Record<string, unknown> = {}
  if (userId === sellerId) { patch.unreadBySeller = false; patch.unreadBySellerCount = 0 }
  if (userId === buyerId) { patch.unreadByBuyer = false; patch.unreadByBuyerCount = 0 }
  if (Object.keys(patch).length === 0) return
  await setDoc(doc(db, 'conversations', conversationId), patch, { merge: true })
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
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      setMessages(list)
      setLoading(false)

      // Read receipt: mark the other party's messages as seen (chat is open = read).
      const myUid = auth.currentUser?.uid
      if (myUid) {
        const unreadByOther = list.filter(
          (m: any) => m.senderId && m.senderId !== myUid && m.status !== 'seen'
        )
        if (unreadByOther.length > 0) {
          unreadByOther.forEach((m: any) => {
            updateDoc(doc(db, 'conversations', conversationId, 'messages', m.id), { status: 'seen' }).catch(err => {
              console.warn('Failed to mark message seen:', err)
            })
          })
          updateDoc(doc(db, 'conversations', conversationId), { lastMessageStatus: 'seen' }).catch(err => {
            console.warn('Failed to update conversation status:', err)
          })
        }
      }
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
        lastMessageBy: senderId,
        lastMessageStatus: 'sent',
        unreadBySeller: senderId === buyerId,
        unreadByBuyer: senderId === sellerId,
        unreadBySellerCount: senderId === buyerId ? 1 : 0,
        unreadByBuyerCount: senderId === sellerId ? 1 : 0
      })
    } else {
      const patch: Record<string, unknown> = {
        lastMessage: text,
        lastMessageAt: serverTimestamp(),
        lastMessageBy: senderId,
        lastMessageStatus: 'sent',
        unreadBySeller: senderId === buyerId,
        unreadByBuyer: senderId === sellerId
      }
      if (senderId === buyerId) patch.unreadBySellerCount = increment(1)
      if (senderId === sellerId) patch.unreadByBuyerCount = increment(1)
      await setDoc(convoRef, patch, { merge: true })
    }

    await addDoc(collection(db, 'conversations', conversationId, 'messages'), {
      senderId, text, status: 'sent', createdAt: serverTimestamp()
    })
  }

  return { messages, loading, sendMessage, conversationId }
}