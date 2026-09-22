import { useEffect, useMemo, useState } from 'react'
import {
  collection,
  doc,
  getDoc,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore'
import { auth, db } from './firebase'
import {
  cleanReviewText,
  cleanTags,
  displayName,
  isReaction,
  postBlocker,
  scoreOf,
  summaryOf,
  toMillis,
  type Reaction,
  type Review,
} from './reviewUtils'
import { trackEvent } from './analytics'

/**
 * Reviews, read and written.
 *
 * One listener per product (`…/reviews`, newest first) and one function that posts — the two
 * halves of "what buyers said" and "a buyer says something".
 *
 * The counters on the product document (`reviewCount`, `reviewScoreSum`, `reviewLovedCount`) move
 * in the **same batch** as the review itself: either both land or neither does, so the scoreboard
 * can never drift away from the comments. An edit moves them by the *difference* — never twice.
 */

/** How many comments a reading session loads. The counters still count every one of them. */
const REVIEW_PAGE = 40

function mapReview(id: string, data: Record<string, unknown>): Review {
  return {
    buyerUid: id,
    reaction: isReaction(data.reaction) ? data.reaction : 'fine',
    tags: cleanTags(data.tags),
    text: cleanReviewText(data.text),
    photoUrl: typeof data.photoUrl === 'string' && data.photoUrl ? data.photoUrl : undefined,
    orderId: typeof data.orderId === 'string' ? data.orderId : '',
    orderRef: typeof data.orderRef === 'string' && data.orderRef ? data.orderRef : undefined,
    variant: typeof data.variant === 'string' && data.variant ? data.variant : undefined,
    buyerName: typeof data.buyerName === 'string' && data.buyerName ? data.buyerName : undefined,
    createdAt: toMillis(data.createdAt),
  }
}

export interface PostReviewInput {
  sellerId: string
  productId: string
  /**
   * The **document id** of the delivered order that proves the purchase. The security rules look
   * this document up, so it is what actually authorises the comment.
   */
  orderId: string
  /** The reference shown to a human ("RT-AB12CD"). Display only. */
  orderRef?: string
  reaction: Reaction
  tags?: string[]
  text?: string
  photoUrl?: string
  /** "Black / M", when they had chosen a variant. */
  variant?: string
  /** The buyer's own name — stored shortened ("Aisha N.") because it becomes public. */
  buyerName?: string
  /** Which surface posted it: 'orders' | 'sheet' | 'inbox'. */
  surface?: string
}

/**
 * Writes the comment and moves the counters, atomically. Throws a plain-language error the caller
 * can show as-is: the checking here is for the buyer's benefit — the *rules* are what enforce it.
 */
export async function postReview(input: PostReviewInput): Promise<void> {
  const uid = auth.currentUser?.uid
  if (!uid) throw new Error('Sign in to write a comment.')
  if (uid === input.sellerId) throw new Error('You cannot comment on your own product.')
  const blocker = postBlocker({ reaction: input.reaction, orderId: input.orderId, text: input.text })
  if (blocker) throw new Error(blocker)

  const reviewRef = doc(db, 'sellers', input.sellerId, 'products', input.productId, 'reviews', uid)
  const productRef = doc(db, 'sellers', input.sellerId, 'products', input.productId)

  // An edit must correct the tally, not double it — so we need the previous answer.
  const existing = await getDoc(reviewRef)
  const rawPrevious = existing.exists() ? existing.data() : null
  const previous: Reaction | null = rawPrevious && isReaction(rawPrevious.reaction) ? rawPrevious.reaction : null

  const score = scoreOf(input.reaction)
  const countDelta = previous ? 0 : 1
  const scoreDelta = score - (previous ? scoreOf(previous) : 0)
  const lovedDelta = (input.reaction === 'love' ? 1 : 0) - (previous === 'love' ? 1 : 0)

  const text = cleanReviewText(input.text)
  const tags = cleanTags(input.tags)
  const batch = writeBatch(db)
  batch.set(reviewRef, {
    buyerUid: uid,
    reaction: input.reaction,
    score,
    tags,
    text,
    orderId: input.orderId,
    ...(input.orderRef ? { orderRef: input.orderRef } : {}),
    // Set by us because the rules proved it — never by the buyer ticking a box.
    verified: true,
    ...(input.photoUrl ? { photoUrl: input.photoUrl } : {}),
    ...(input.variant ? { variant: input.variant } : {}),
    ...(input.buyerName ? { buyerName: displayName(input.buyerName) } : {}),
    ...(previous ? { editedAt: serverTimestamp() } : {}),
    createdAt: serverTimestamp(),
  }, { merge: true })

  if (countDelta || scoreDelta || lovedDelta) {
    const patch: Record<string, unknown> = {}
    if (countDelta) patch.reviewCount = increment(countDelta)
    if (scoreDelta) patch.reviewScoreSum = increment(scoreDelta)
    if (lovedDelta) patch.reviewLovedCount = increment(lovedDelta)
    batch.update(productRef, patch)
  }

  await batch.commit()
  trackEvent('review_posted', {
    productId: input.productId,
    sellerId: input.sellerId,
    reaction: input.reaction,
    hasText: text.length > 0,
    hasPhoto: Boolean(input.photoUrl),
    tagCount: tags.length,
    edited: Boolean(previous),
    surface: input.surface || 'orders',
  })
}

/**
 * This buyer's own comment on a product, if they wrote one — so the form can open in edit mode and
 * the button can say "your comment" instead of pretending there is nothing there.
 */
export async function getMyReview(sellerId: string, productId: string): Promise<Review | null> {
  const uid = auth.currentUser?.uid
  if (!uid || !sellerId || !productId) return null
  try {
    const snap = await getDoc(doc(db, 'sellers', sellerId, 'products', productId, 'reviews', uid))
    return snap.exists() ? mapReview(snap.id, snap.data() as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** Has this buyer already had their say about this product? One read, before opening the form. */
export async function hasReviewed(sellerId: string, productId: string): Promise<boolean> {
  const uid = auth.currentUser?.uid
  if (!uid || !sellerId || !productId) return false
  try {
    const snap = await getDoc(doc(db, 'sellers', sellerId, 'products', productId, 'reviews', uid))
    return snap.exists()
  } catch {
    // Offline or blocked: say "not yet" rather than inventing a review that isn't there.
    return false
  }
}

/**
 * The comments on one product, live. Someone else's new comment (or an edit) appears without a
 * reload — the details sheet is where a buyer decides, so it must never show yesterday's list.
 */
export function useProductReviews(sellerId?: string | null, productId?: string | null) {
  const [reviews, setReviews] = useState<Review[]>([])
  const [loading, setLoading] = useState(Boolean(sellerId && productId))
  const [error, setError] = useState('')
  const uid = auth.currentUser?.uid || ''

  useEffect(() => {
    if (!sellerId || !productId) return
    const q = query(
      collection(db, 'sellers', sellerId, 'products', productId, 'reviews'),
      orderBy('createdAt', 'desc'),
      limit(REVIEW_PAGE),
    )
    const unsub = onSnapshot(
      q,
      snap => {
        setReviews(snap.docs.map(d => mapReview(d.id, d.data() as Record<string, unknown>)))
        setError('')
        setLoading(false)
      },
      err => {
        console.warn('Could not load reviews:', err)
        setError('Comments could not load. Check your connection.')
        setLoading(false)
      },
    )
    return unsub
  }, [sellerId, productId])

  const summary = useMemo(() => summaryOf(reviews), [reviews])
  const myReview = useMemo(() => reviews.find(r => r.buyerUid === uid) || null, [reviews, uid])

  return { reviews, summary, myReview, loading, error }
}

