import { collection, doc, setDoc, updateDoc, getDoc, addDoc, serverTimestamp } from 'firebase/firestore'
import { db } from './firebase'
import { getConversationId } from './useConversation'

export type BuyerOrderFields = {
  buyerName: string
  buyerUid: string
  /** Guest orders carry the phone they verified — that's how the seller reaches them. */
  buyerPhone?: string
  /** True when the buyer proved their phone with an OTP before ordering. */
  verified?: boolean
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
 * Keeps one thread's header fresh — the Inbox row is read from here, whichever side wrote.
 * Returns the conversation id so the caller can drop a message into it.
 */
async function bumpConversationHeader(opts: {
  sellerId: string
  buyerId: string
  /** Optional: a caller that only knows the uids (confirming an order) must never blank
   *  out a name the thread is already showing. */
  sellerName?: string
  buyerName?: string
  senderId: string
  lastMessage: string
}) {
  const conversationId = getConversationId(opts.sellerId, opts.buyerId)
  const convoRef = doc(db, 'conversations', conversationId)
  const convoSnap = await getDoc(convoRef)

  if (!convoSnap.exists()) {
    await setDoc(convoRef, {
      sellerId: opts.sellerId,
      buyerId: opts.buyerId,
      ...(opts.sellerName ? { sellerName: opts.sellerName } : {}),
      ...(opts.buyerName ? { buyerName: opts.buyerName } : {}),
      lastMessage: opts.lastMessage,
      lastMessageAt: serverTimestamp(),
      lastMessageBy: opts.senderId,
      lastMessageStatus: 'sent',
      unreadBySeller: opts.senderId === opts.buyerId,
      unreadBySellerCount: opts.senderId === opts.buyerId ? 1 : 0,
      unreadByBuyer: opts.senderId === opts.sellerId,
      unreadByBuyerCount: opts.senderId === opts.sellerId ? 1 : 0,
    })
  } else {
    const existing = convoSnap.data()
    const patch: Record<string, unknown> = {
      lastMessage: opts.lastMessage,
      lastMessageAt: serverTimestamp(),
      lastMessageBy: opts.senderId,
      lastMessageStatus: 'sent',
      unreadBySeller: opts.senderId === opts.buyerId,
      unreadByBuyer: opts.senderId === opts.sellerId,
    }
    if (opts.senderId === opts.buyerId) patch.unreadBySellerCount = (existing.unreadBySellerCount || 0) + 1
    if (opts.senderId === opts.sellerId) patch.unreadByBuyerCount = (existing.unreadByBuyerCount || 0) + 1
    await updateDoc(convoRef, patch)
  }

  return conversationId
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
  /** Which product — the delivered bubble needs it to offer the ♥. */
  productId?: string
}) {
  try {
    const text = `📦 Order placed — Ref: ${opts.orderId}`
    const conversationId = await bumpConversationHeader({ ...opts, senderId: opts.buyerId, lastMessage: text })

    await addDoc(collection(db, 'conversations', conversationId, 'messages'), {
      senderId: opts.buyerId,
      type: 'order',
      text,
      orderId: opts.orderId,
      productId: opts.productId,
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

/**
 * The delivery moment. When a seller confirms an order the buyer finds out where they already
 * track it — the thread — and is asked the one question that turns a delivery into a ♥.
 * It is the seller's own message, so the buyer's order document stays read-only to them.
 */
export async function postOrderDeliveredMessage(opts: {
  sellerId: string
  buyerId: string
  /** Optional — confirming an order only knows the uid, and the thread already has the name. */
  sellerName?: string
  buyerName?: string
  orderId: string
  productId?: string
  productName?: string
  productPrice?: string
  quantity?: string
}) {
  try {
    if (!opts.buyerId || opts.buyerId === opts.sellerId) return
    const text = `✅ Delivered — Ref: ${opts.orderId}`
    const conversationId = await bumpConversationHeader({ ...opts, senderId: opts.sellerId, lastMessage: text })

    await addDoc(collection(db, 'conversations', conversationId, 'messages'), {
      senderId: opts.sellerId,
      type: 'order',
      text,
      orderId: opts.orderId,
      // Marks this as the *delivery* bubble (the read-receipt field `status` is taken),
      // which is what makes the "Did you love it?" prompt appear for the buyer.
      orderStatus: 'fulfilled',
      productId: opts.productId,
      productName: opts.productName,
      productPrice: opts.productPrice,
      quantity: opts.quantity,
      status: 'sent',
      createdAt: serverTimestamp(),
    })
  } catch (err) {
    console.warn('Failed to post the delivered message:', err)
  }
}

export async function incrementProductOrderCount(
  sellerId: string,
  productId: string,
  currentCount: number
) {
  // Guests can't bump this (the rule needs an account) — never let it break their order.
  try {
    await updateDoc(doc(db, 'sellers', sellerId, 'products', productId), {
      orderCount: currentCount + 1,
    })
  } catch (err) {
    console.warn('Could not bump product order count:', err)
  }
}
