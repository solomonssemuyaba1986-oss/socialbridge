import { collection, doc, setDoc, updateDoc } from 'firebase/firestore'
import { db } from './firebase'

export type BuyerOrderFields = {
  buyerName: string
  buyerUid: string
  productName: string
  productPrice: string
  quantity: string
  deliveryArea: string
  status: 'pending'
  read: false
  sourcePlatform: string
  createdAt: Date
}

/** One Firestore write — buyers are not allowed to patch orders after create (see firestore.rules). */
export async function createBuyerOrder(sellerId: string, fields: BuyerOrderFields) {
  const orderRef = doc(collection(db, 'sellers', sellerId, 'orders'))
  const orderId = `RT-${orderRef.id.slice(0, 6).toUpperCase()}`
  await setDoc(orderRef, { ...fields, orderId })
  return { orderRef, orderId }
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
