import { collection, doc, setDoc, updateDoc, getDoc, addDoc, serverTimestamp } from 'firebase/firestore'
import { db } from './firebase'
import { getConversationId } from './useConversation'

export type BuyerOrderFields = {
  buyerName: string
  buyerUid: string
  productName: string
  productPrice: string
  quantity: string
  deliveryArea: string
  status: 'pending' | 'paid' | 'awaiting_payment'
  read: false
  sourcePlatform: string
  createdAt: Date
  paymentMethod?: string
  transactionId?: string
  flwRef?: string
  paymentStatus?: string
  /** Which product the order is for — used to credit product salesCount on fulfillment. */
  productId?: string
}

/** One Firestore write — buyers are not allowed to patch orders after create (see firestore.rules). */
export async function createBuyerOrder(sellerId: string, fields: BuyerOrderFields) {
  const orderRef = doc(collection(db, 'sellers', sellerId, 'orders'))
  const orderId = `RT-${orderRef.id.slice(0, 6).toUpperCase()}`
  await setDoc(orderRef, { ...fields, orderId })
  return { orderRef, orderId }
}

/**
 * Creates (or bumps) the buyer↔seller conversation thread with an order bubble,
 * so placed orders actually show up in both Inboxes and "Track it in your Inbox" works.
 */
export async function createOrderConversation(opts: {
  sellerId: string
  buyerId: string
  sellerName: string
  buyerName: string
  orderId: string
  productName: string
  productPrice: string
  quantity: string
}) {
  try {
    const conversationId = getConversationId(opts.sellerId, opts.buyerId)
    const convoRef = doc(db, 'conversations', conversationId)
    const convoSnap = await getDoc(convoRef)

    if (!convoSnap.exists()) {
      await setDoc(convoRef, {
        sellerId: opts.sellerId,
        buyerId: opts.buyerId,
        sellerName: opts.sellerName,
        buyerName: opts.buyerName,
        lastMessage: `📦 Order placed — Ref: ${opts.orderId}`,
        lastMessageAt: serverTimestamp(),
        lastMessageBy: opts.buyerId,
        lastMessageStatus: 'sent',
        unreadBySeller: true,
        unreadBySellerCount: 1,
        unreadByBuyer: false,
        unreadByBuyerCount: 0,
      })
    } else {
      const existing = convoSnap.data()
      await updateDoc(convoRef, {
        lastMessage: `📦 Order placed — Ref: ${opts.orderId}`,
        lastMessageAt: serverTimestamp(),
        lastMessageBy: opts.buyerId,
        lastMessageStatus: 'sent',
        unreadBySeller: true,
        unreadBySellerCount: (existing.unreadBySellerCount || 0) + 1,
      })
    }

    await addDoc(collection(db, 'conversations', conversationId, 'messages'), {
      senderId: opts.buyerId,
      type: 'order',
      text: `📦 Order placed — Ref: ${opts.orderId}`,
      orderId: opts.orderId,
      productName: opts.productName,
      productPrice: opts.productPrice,
      quantity: opts.quantity,
      status: 'sent',
      createdAt: serverTimestamp(),
    })
  } catch (err) {
    console.warn('Failed to create order conversation:', err)
  }
}

export async function incrementProductOrderCount(
  sellerId: string,
  productId: string,
  currentCount: number
) {
  await updateDoc(doc(db, 'sellers', sellerId, 'products', productId), {
    orderCount: currentCount + 1,
  })
}
