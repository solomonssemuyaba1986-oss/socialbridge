/**
 * The one action a buyer takes when there is no online rail to pay on: send the order and pay the
 * seller on delivery.
 *
 * The order already exists as a hidden draft, and a browser may not publish it (`firestore.rules`
 * allows a buyer to create an order, never to move it). So the server owns this transition exactly
 * as it owns the paid one — same publish path, same chat bubble, same counters.
 */
import { httpsCallable } from 'firebase/functions'
import { functions } from './firebase'

export interface CashOrderResult {
  orderId: string
  orderStatus: string
  published: boolean
}

interface CashOrderRequest {
  sellerId: string
  orderId: string
}

const publishCashCall = httpsCallable<CashOrderRequest, CashOrderResult>(functions, 'publishCashOrder')

/**
 * Publish the draft as a pay-on-delivery order. Safe to call twice: the server claims the publish
 * once, and the second answer is the same order.
 */
export async function publishCashOrder(sellerId: string, orderId: string): Promise<CashOrderResult> {
  const result = await publishCashCall({ sellerId, orderId })
  const data = result.data || ({} as CashOrderResult)
  return {
    orderId: String(data.orderId || ''),
    orderStatus: String(data.orderStatus || 'pending'),
    published: Boolean(data.published),
  }
}
