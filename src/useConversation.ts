import { useState, useEffect } from 'react'
import {
  collection, doc, addDoc, setDoc, getDoc, increment, updateDoc, writeBatch,
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

/** One conversation per seller↔buyer pair — products ride on the message, never split the thread. */
export async function sendConversationMessage(
  sellerId: string,
  buyerId: string,
  senderId: string,
  text: string,
  sellerName: string,
  buyerName: string,
  opts?: {
    imageUrl?: string
    type?: string
    productId?: string
    productName?: string
    productPrice?: string
    productImage?: string
  }
) {
  if (!sellerId || !buyerId || sellerId === buyerId) return // never allow self-messaging
  const conversationId = getConversationId(sellerId, buyerId)

  const isImage = !!opts?.imageUrl
  const isProduct = !!opts?.productId || !!opts?.productName
  let lastMessage: string
  if (isImage) lastMessage = '📷 Photo'
  else if (isProduct) lastMessage = `🛍️ ${opts!.productName || 'Product'}`
  else lastMessage = text

  const convoRef = doc(db, 'conversations', conversationId)
  const convoSnap = await getDoc(convoRef)

  if (!convoSnap.exists()) {
    await setDoc(convoRef, {
      sellerId, buyerId, sellerName, buyerName,
      lastMessage,
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
      lastMessage,
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

  const messageFields: Record<string, unknown> = {
    senderId, text, status: 'sent', createdAt: serverTimestamp()
  }
  if (isImage) {
    messageFields.imageUrl = opts!.imageUrl
    messageFields.type = opts?.type || 'image'
  } else if (isProduct) {
    messageFields.type = 'product'
  }
  if (isProduct) {
    if (opts!.productId) messageFields.productId = opts!.productId
    if (opts!.productName) messageFields.productName = opts!.productName
    if (opts!.productPrice) messageFields.productPrice = opts!.productPrice
    if (opts!.productImage) messageFields.productImage = opts!.productImage
  }
  await addDoc(collection(db, 'conversations', conversationId, 'messages'), messageFields)
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

  const sendMessage = async (
    senderId: string,
    text: string,
    sellerName: string,
    buyerName: string,
    opts?: { imageUrl?: string; type?: string }
  ) => {
    if (!sellerId || !buyerId) return
    await sendConversationMessage(sellerId, buyerId, senderId, text, sellerName, buyerName, opts)
  }

  /** Send multiple photos atomically as one compact batch. A caption rides on the first photo. */
  const sendImageBatch = async (
    senderId: string,
    imageUrls: string[],
    caption: string,
    sellerName: string,
    buyerName: string
  ) => {
    if (!conversationId || !sellerId || !buyerId || imageUrls.length === 0) return

    const hasCaption = !!caption && caption !== '📷 Photo'
    const batch = writeBatch(db)
    const messagesRef = collection(db, 'conversations', conversationId, 'messages')

    imageUrls.forEach((imageUrl, i) => {
      const fields: Record<string, unknown> = {
        senderId,
        status: 'sent',
        createdAt: serverTimestamp(),
        imageUrl,
        type: 'image',
        text: hasCaption && i === 0 ? caption : '📷 Photo'
      }
      batch.set(doc(messagesRef), fields)
    })

    const convoRef = doc(db, 'conversations', conversationId)
    const convoSnap = await getDoc(convoRef)

    if (!convoSnap.exists()) {
      batch.set(convoRef, {
        sellerId, buyerId, sellerName, buyerName,
        lastMessage: '📷 Photo',
        lastMessageAt: serverTimestamp(),
        lastMessageBy: senderId,
        lastMessageStatus: 'sent',
        unreadBySeller: senderId === buyerId,
        unreadByBuyer: senderId === sellerId,
        unreadBySellerCount: senderId === buyerId ? imageUrls.length : 0,
        unreadByBuyerCount: senderId === sellerId ? imageUrls.length : 0
      })
    } else {
      const patch: Record<string, unknown> = {
        lastMessage: '📷 Photo',
        lastMessageAt: serverTimestamp(),
        lastMessageBy: senderId,
        lastMessageStatus: 'sent',
        unreadBySeller: senderId === buyerId,
        unreadByBuyer: senderId === sellerId
      }
      if (senderId === buyerId) patch.unreadBySellerCount = increment(imageUrls.length)
      if (senderId === sellerId) patch.unreadByBuyerCount = increment(imageUrls.length)
      batch.update(convoRef, patch)
    }

    await batch.commit()
  }

  return { messages, loading, sendMessage, sendImageBatch, conversationId }
}