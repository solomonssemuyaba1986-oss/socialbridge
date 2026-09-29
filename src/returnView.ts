/**
 * Turning a real order into the shapes `returnPolicy` and `care` ask for.
 *
 * `returnPolicy.ts` reads exactly four things about an order — `status`, `returnState`, the delivery
 * date and the category — and `care.ts` reads the rest of the story (item, shop, order number, the
 * date it was placed). Both are pure and pinned to `firestore.rules` by the harnesses, so the one
 * piece of judgement that is about *our* data lives here instead: **which order field is the day it
 * was delivered.**
 *
 * That is not a guess. A seller may only write a return decision onto an order that is already
 * `fulfilled` (`firestore.rules`, the seller's return branch), so the last write such an order ever
 * takes is the seller's own ✓ Confirm — and `OrderHistory.updateOrderStatus` stamps `updatedAt` on
 * exactly that write. Nothing downstream can move it again: the buyer's six return fields and the
 * seller's three do not include `updatedAt`. So on a delivered order `updatedAt` *is* the delivery
 * date, and it is the same date the buyer already reads on the row ("Updated 2h ago") — nobody has
 * to take our word for it.
 *
 * When it is missing we say so (`0`) rather than inventing one. The policy's own answer for an
 * unknown date is to get help, and a made-up date would quietly move the seven days.
 *
 * Pure — no Firebase, no React — so the screens are the only thing left that can be wrong.
 */
import {
  canOpenReturn,
  returnIsOpen,
  returnRowLine,
  sellerAnswerWords,
  SELLER_ANSWER_HOURS,
  type ReturnableOrder,
} from './returnPolicy'
import type { CareContext } from './care'

/** The order fields this module reads. `BuyerOrder` and `SellerOrder` both satisfy it. */
export interface ReturnOrderLike {
  /** The **document** id — the one a return is written to. */
  id?: string
  /** The order number the buyer and seller both read (`#1042`). Falls back to `id`. */
  orderId?: string
  sellerId?: string
  productName?: string
  quantity?: number | string
  buyerName?: string
  status?: string
  returnState?: string
  returnReason?: string
  /** When the buyer sent it, in ms — the write-once start of the seller's 48 hours. */
  returnRequestedAt?: number
  /** The seller's own words on their decision, when they left any. */
  returnNote?: string
  returnUpdatedAt?: number
  returnDecidedAt?: number
  category?: string
  subCategory?: string
  createdAt?: unknown
  updatedAt?: unknown
}

/** Firestore Timestamp / Date / number → ms. `0` for anything we cannot read honestly. */
export function orderMs(value: unknown): number {
  if (value && typeof value === 'object' && typeof (value as { toMillis?: () => number }).toMillis === 'function') {
    return (value as { toMillis: () => number }).toMillis()
  }
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number' && isFinite(value)) return value
  return 0
}

/** The day it was delivered, as the seller's own ✓ Confirm wrote it. `0` = we do not know. */
export function deliveredAtMsOf(order: { status?: string; updatedAt?: unknown } | null | undefined): number {
  if (!order || order.status !== 'fulfilled') return 0
  return orderMs(order.updatedAt)
}

/** The four fields the policy reads, filled from the order as it really is. */
export function returnableFromOrder(order: ReturnOrderLike): ReturnableOrder {
  return {
    status: order.status,
    returnState: order.returnState,
    deliveredAtMs: deliveredAtMsOf(order),
    category: order.category,
    subCategory: order.subCategory,
  }
}

/**
 * What the whole ticket is about, taken off the order so the buyer never types it again. `shopName`
 * comes from the shop document the screen already loaded; everything else is on the order itself.
 */
export function returnContextFromOrder(order: ReturnOrderLike, shopName = ''): CareContext {
  return {
    orderId: order.orderId || order.id || '',
    itemName: order.productName || '',
    quantity: Number(order.quantity) || 1,
    shopName,
    sellerId: order.sellerId || '',
    orderedAtMs: orderMs(order.createdAt),
    returnState: order.returnState || '',
    returnReason: order.returnReason || '',
  }
}

/** One line for an order row: where the return stands, and the clock if one is running. */
export function returnLineForOrder(order: ReturnOrderLike, nowMs: number): string {
  if (!order.returnState) return ''
  return returnRowLine({ ...returnableFromOrder(order), returnRequestedAtMs: orderMs(order.returnRequestedAt) }, nowMs)
}

export interface ReturnSos {
  /** A `CARE_ISSUES` value — the prewritten message is built from it. */
  issue: string
  /** The sentence that goes with that message, so a person knows what to answer. */
  note: string
  /** The button the buyer taps, in their words. */
  label: string
}

/**
 * The one tap the policy promises: when the seller's 48 hours have run out, when a return was
 * refused, or when the order never arrived, the whole story goes to rachett care — order, reason and
 * dates attached by `returnContextFromOrder`.
 *
 * `null` means there is nothing to escalate: the return is theirs to file, the seller is still
 * inside their 48 hours, or it is already finished. Offering care early would quietly undermine the
 * seller, which is the one thing the clock exists to protect.
 */
export function returnSos(order: ReturnOrderLike, nowMs: number): ReturnSos | null {
  const state = order.returnState
  if (state === 'declined') {
    return {
      issue: 'return_refused',
      note: 'They refused it, and I do not agree with the reason they gave.',
      label: 'Get help with this refusal',
    }
  }
  if (state === 'refunded' || state === 'completed') return null
  if (returnIsOpen(state)) {
    const clock = sellerAnswerWords(orderMs(order.returnRequestedAt), nowMs)
    // Inside the 48 hours the seller is playing by the rule; outside it, the clock is ours to act on.
    if (!clock.late) return null
    return {
      issue: 'seller_silent',
      note: `The seller is past the ${SELLER_ANSWER_HOURS} hours and nothing has happened since I sent the return.`,
      label: 'Take this return to rachett care',
    }
  }
  if (order.status !== 'fulfilled') {
    return {
      issue: 'not_arrived',
      note: 'The seller has not marked it delivered, so I cannot even start a return.',
      label: 'Get help with this order',
    }
  }
  if (!deliveredAtMsOf(order)) {
    return {
      issue: 'not_arrived',
      note: 'The order says delivered, but nothing reached me and there is no delivery date on it.',
      label: 'Get help with this order',
    }
  }
  // Delivered, no return running — so the only way left to be blocked is the seven days themselves.
  const { ok, text } = canOpenReturn({ status: order.status, deliveredAtMs: deliveredAtMsOf(order) }, nowMs)
  if (ok) return null
  return {
    issue: 'something_else',
    note: `My return window closed before I could send it back: ${text}`,
    label: 'Get help with the window',
  }
}

