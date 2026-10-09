/**
 * How many times a product has been opened: `productViews/{productId}`, one number per product.
 *
 * Why this exists at all: the seller's own page needs to say which product people are interested in,
 * and the honest answer is currently *nowhere* — `product_sheet_opened` goes into `events/`, which no
 * browser is allowed to read (see `firestore.rules`). A seller cannot be told "12 people looked at
 * this" from a collection they cannot open, so the count gets its own tiny public document, exactly
 * like `bagCounts` — same shape, same limits, same reasoning.
 *
 * Three limits, and they matter more than the number:
 *   • it only ever goes **up** — the rules refuse a write that is not `count + 1`
 *   • **no uid** is stored anywhere near it (the session marker lives in the opener's own browser)
 *   • the seller's own opens are not counted — a shop does not become popular by refreshing itself
 */
import { doc, getDoc, runTransaction } from 'firebase/firestore'
import { db, auth } from './firebase'
import { sessionStore, shouldCountView } from './viewOnce'

export interface ProductViewData {
  count: number
  /** Present on everything written since the counter was added. */
  updatedAt?: number
}

/**
 * One open, counted once per session. Fire-and-forget: a counter must never be able to break a
 * product page, so every failure here is a warning in the console and nothing else.
 *
 * Written as a **transaction with an absolute number**, not an `increment()` sentinel: the rules have
 * to be able to say "you may write `count + 1` and nothing else", and an absolute value is a claim the
 * rules can check against the document they already have. It is the same shape as the ever-bagged
 * counter in `useBag.ts` — read, add one, write — and it also means two people opening the same
 * product at the same moment cannot land on the same number.
 */
export async function countProductView(productId: string, sellerId?: string): Promise<void> {
  const id = String(productId || '')
  if (!id) return
  // The seller looking at their own shop is not a customer. (StorePage skips the visit for the same
  // reason — the two numbers should agree about who counts.)
  if (sellerId && auth.currentUser?.uid === sellerId) return
  if (!shouldCountView(sessionStore(), id)) return
  try {
    const ref = doc(db, 'productViews', id)
    await runTransaction(db, async tx => {
      const snap = await tx.get(ref)
      const current = snap.exists() ? Math.max(0, Number(snap.data().count) || 0) : 0
      tx.set(ref, { count: current + 1, updatedAt: Date.now() }, { merge: true })
    })
  } catch (e) {
    console.warn('Failed to count product view:', e)
  }
}

/**
 * The counts for a list of the seller's own products, one small read each. A seller has tens of
 * products, not thousands, and this avoids depending on an index for a number that is decoration
 * until somebody opens the page.
 */
export async function fetchProductViews(productIds: string[]): Promise<Record<string, number>> {
  const unique = Array.from(new Set((productIds || []).map(id => String(id || '')).filter(Boolean)))
  const out: Record<string, number> = {}
  await Promise.all(unique.map(async id => {
    try {
      const snap = await getDoc(doc(db, 'productViews', id))
      out[id] = snap.exists() ? Math.max(0, Number(snap.data().count) || 0) : 0
    } catch (e) {
      console.warn('Failed to read product views:', e)
      out[id] = 0
    }
  }))
  return out
}
