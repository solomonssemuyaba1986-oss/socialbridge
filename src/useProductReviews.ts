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
  setDoc,
  writeBatch,
} from 'firebase/firestore'
import { auth, db } from './firebase'
import {
  cleanReviewText,
  cleanTags,
  displayName,
  postBlocker,
  scoreOfReview,
  summaryOf,
  toMillis,
  type Review,
  type Score,
} from './reviewUtils'
import { trackEvent } from './analytics'

/**
 * Reviews, read and written.
 *
 * One listener per product (`…/reviews`, newest first) and one function that posts — the two
 * halves of "what buyers said" and "a buyer says something".
 *
 * The counters on the product document (`reviewCount`, `reviewScoreSum`) move in the **same batch**
 * as the review itself: either both land or neither does, so the scoreboard can never drift away
 * from the comments. An edit moves them by the *difference* — never twice.
 */

/** How many comments a reading session loads. The counters still count every one of them. */
const REVIEW_PAGE = 40

function mapReview(id: string, data: Record<string, unknown>): Review {
  return {
    buyerUid: id,
    // A stored star, or the score an older comment's reaction always stood for. Nothing readable
    // at all reads as 3 — the same assumption the pre-stars code made — so a half-written
    // document can never be mistaken for a five-star rave.
    score: scoreOfReview(data) ?? 3,
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
  /** 1–5 stars. Required, and the only part of a comment the rules call a rating. */
  score: Score
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
  const blocker = postBlocker({ score: input.score, orderId: input.orderId, text: input.text })
  if (blocker) throw new Error(blocker)

  const reviewRef = doc(db, 'sellers', input.sellerId, 'products', input.productId, 'reviews', uid)
  const productRef = doc(db, 'sellers', input.sellerId, 'products', input.productId)

  // An edit must correct the tally, not double it — so we need the previous answer. A comment
  // written before stars existed answers with the score its reaction stood for (`scoreOfReview`),
  // which is exactly what its weight in `reviewScoreSum` has always been.
  const existing = await getDoc(reviewRef)
  const rawPrevious = existing.exists() ? (existing.data() as Record<string, unknown>) : null
  const previous = scoreOfReview(rawPrevious)

  const score = input.score
  const countDelta = existing.exists() ? 0 : 1
  const scoreDelta = score - (previous || 0)

  const text = cleanReviewText(input.text)
  const tags = cleanTags(input.tags)
  const batch = writeBatch(db)
  batch.set(reviewRef, {
    buyerUid: uid,
    // The rating itself. `reaction` is deliberately not written any more: it is history, and a
    // document carrying both fields would have two answers where there is one.
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

  if (countDelta || scoreDelta) {
    const patch: Record<string, unknown> = {}
    if (countDelta) patch.reviewCount = increment(countDelta)
    if (scoreDelta) patch.reviewScoreSum = increment(scoreDelta)
    batch.update(productRef, patch)
  }

  // A private index of "products I have commented on" — on the buyer's own document, so a later
  // rename knows exactly which comments to relabel without a collection-group query.
  batch.set(doc(db, 'users', uid, 'comments', input.productId), {
    sellerId: input.sellerId,
    at: serverTimestamp(),
  }, { merge: true })

  await batch.commit()
  trackEvent('review_posted', {
    productId: input.productId,
    sellerId: input.sellerId,
    score: input.score,
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

// ── Asking for a rating ──────────────────────────────────────────────────────────────────────

/**
 * "We have asked about this order." Written the first time the quiet fallback on My Orders offers
 * the stars, so it is asked exactly once — an ask that repeats is a nag, not an ask.
 *
 * Keyed by the order's document id, under the buyer's own document, and deliberately **not** the
 * old `loveAnswers` path: the ♥ question and the star question are different questions, and a
 * leftover private answer must never silence a rating ask.
 */
export async function markRatingAsked(orderId: string, surface: string): Promise<void> {
  const uid = auth.currentUser?.uid
  if (!uid || !orderId) return
  try {
    await setDoc(doc(db, 'users', uid, 'ratingAsks', orderId), { surface, at: serverTimestamp() }, { merge: true })
  } catch (err) {
    // Bookkeeping must never block the question: worst case they are asked once more.
    console.warn('Could not remember that we asked for a rating:', err)
  }
}

/** Has this order been asked about already? One read, before the fallback card is shown. */
export async function wasRatingAsked(orderId: string): Promise<boolean> {
  const uid = auth.currentUser?.uid
  if (!uid || !orderId) return false
  try {
    return (await getDoc(doc(db, 'users', uid, 'ratingAsks', orderId))).exists()
  } catch {
    // Unreadable (the rules for it are not deployed yet): treat it as "not asked". The rating is
    // the thing that matters, and that write would have been refused for the same reason.
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
  /** Firestore refused the read — the comments' rules are not live yet (see below). */
  const [blocked, setBlocked] = useState(false)
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
        setBlocked(false)
        setLoading(false)
      },
      err => {
        const code = String((err as { code?: string })?.code || '')
        if (code === 'permission-denied') {
          // This is *our* setup, not the buyer's connection: the comments rules have not been
          // deployed, so Firestore refuses the read on purpose. Say what to run, once, and stay
          // silent in the interface — an error banner would blame the wrong thing.
          console.warn('rachett: comments are not switched on yet — run `npm run deploy:rules` once.')
          setBlocked(true)
          setError('')
        } else {
          console.warn('Could not load comments:', err)
          setError('Comments could not load. Check your connection.')
        }
        setLoading(false)
      },
    )
    return unsub
  }, [sellerId, productId])

  const summary = useMemo(() => summaryOf(reviews), [reviews])
  const myReview = useMemo(() => reviews.find(r => r.buyerUid === uid) || null, [reviews, uid])

  return { reviews, summary, myReview, loading, error, blocked }
}

