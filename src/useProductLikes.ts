import { useCallback, useEffect, useRef, useState } from 'react'
import {
  collection,
  doc,
  increment as firestoreIncrement,
  onSnapshot,
  runTransaction,
} from 'firebase/firestore'
import { onAuthStateChanged, type User } from 'firebase/auth'
import { db, auth } from './firebase'
import { trackEvent } from './analytics'
import { likeTally } from './productCardUtils'

/**
 * ♥ The product like — universal, one vote per account.
 *
 * The tally is public and identical for everyone (a buyer in Uganda, the seller in Kenya
 * and a seller in Morocco all read the same number):
 *
 *   sellers/{sellerId}/products/{productId}.likeCount    ← the number the cards show
 *   sellers/{sellerId}/products/{productId}/likes/{uid}  ← the vote; the document ID *is*
 *                                                          the voter, so a second like can
 *                                                          only ever be an un-like (delete)
 *   users/{uid}/likes/{productId}                        ← my votes only, so one listener
 *                                                          draws every heart on a page
 *
 * A vote is one transaction: the vote, my index and the tally move together — or not at all.
 * `firestore.rules` enforces the rest: one per account, never your own product, ±1 only.
 */

/** productId → true when the signed-in person has voted for it. */
type MyLikes = Record<string, boolean>

/**
 * My own optimistic tallies, keyed by productId. Module-level on purpose: Browse → store →
 * back remounts this hook while `useProductFeed` still serves a cached product doc carrying
 * the pre-vote number — this keeps my own vote from "un-counting" itself in the meantime.
 */
const countOverrides = new Map<string, number>()

export interface ToggleLikeOptions {
  sellerId: string
  productId: string
  /** The tally as the card has it right now — the base for the optimistic number. */
  currentCount?: number
  /** 'tap' from a card, 'purchase' from the "Did you love it?" prompt. */
  source?: 'tap' | 'purchase'
  orderId?: string
  /** Which page did it — stamped on the event. */
  surface?: string
}

export interface ToggleLikeResult {
  /** False when nothing was written: not signed in, your own product, or the write failed. */
  ok: boolean
  needsSignIn?: boolean
  ownProduct?: boolean
  /** Where the vote ended up — true after a like, false after an un-like. */
  liked?: boolean
  count?: number
  failed?: boolean
}

/** A real account, or null. Anonymous accounts are guests everywhere else — they are here too. */
function realUid(user: User | null): string | null {
  if (!user || user.isAnonymous) return null
  return user.uid
}

export function useProductLikes() {
  const [mine, setMine] = useState<MyLikes>({})
  const [overrides, setOverrides] = useState<Record<string, number>>(() => Object.fromEntries(countOverrides))
  const uidRef = useRef<string | null>(realUid(auth.currentUser))
  const mineRef = useRef<MyLikes>({})
  // Mirrored in an effect, never during render: `toggleLike` needs the current votes without
  // being re-created on every one of them.
  useEffect(() => { mineRef.current = mine }, [mine])
  /** Votes mid-flight: a snapshot that left the server before the write must not flip the heart back. */
  const pendingRef = useRef<Map<string, boolean>>(new Map())

  // Which products have I already loved? One listener for the whole page, not one read per card.
  useEffect(() => {
    let unsubLikes: (() => void) | null = null
    const unsubAuth = onAuthStateChanged(auth, user => {
      uidRef.current = realUid(user)
      if (unsubLikes) { unsubLikes(); unsubLikes = null }
      if (!uidRef.current) { setMine({}); return }
      const uid = uidRef.current
      unsubLikes = onSnapshot(
        collection(db, 'users', uid, 'likes'),
        snap => {
          const confirmed: MyLikes = {}
          snap.forEach(d => { confirmed[d.id] = true })
          setMine(() => {
            const next: MyLikes = { ...confirmed }
            // A tap that hasn't landed yet outranks the server's older answer.
            pendingRef.current.forEach((liked, productId) => { next[productId] = liked })
            return next
          })
        },
        err => console.warn('Likes listener error:', err),
      )
    })
    return () => {
      unsubAuth()
      if (unsubLikes) unsubLikes()
    }
  }, [])

  const isLiked = useCallback((productId: string) => Boolean(mine[productId]), [mine])

  /** The number to show: my optimistic value when I have one, otherwise the product doc's. */
  const likeCountFor = useCallback(
    (product: { id: string; likeCount?: number } | null | undefined) => {
      if (!product) return 0
      const override = overrides[product.id]
      return override !== undefined ? override : likeTally(product)
    },
    [overrides],
  )

  const toggleLike = useCallback(async (opts: ToggleLikeOptions): Promise<ToggleLikeResult> => {
    const { sellerId, productId, currentCount = 0, source = 'tap', orderId, surface } = opts
    // Reading auth.currentUser too covers the moment after sign-in, before
    // onAuthStateChanged has delivered the user to this hook.
    const uid = uidRef.current ?? realUid(auth.currentUser)
    if (!uid) return { ok: false, needsSignIn: true }
    if (!sellerId || sellerId === uid) return { ok: false, ownProduct: true }

    const wasLiked = Boolean(mineRef.current[productId])
    const hadOverride = countOverrides.has(productId)
    /**
     * Only ever move a number we actually know. A surface that doesn't hold the product doc
     * (a chat bubble, a deep link) hands us no count, and inventing one would shadow the real
     * tally for the rest of the session — so there we move the heart alone and let the card
     * show the true number when it loads.
     */
    const knownBase = hadOverride
      ? countOverrides.get(productId)
      : (typeof currentCount === 'number' ? Math.max(0, Math.floor(currentCount)) : undefined)
    const optimistic = knownBase === undefined ? undefined : Math.max(0, knownBase + (wasLiked ? -1 : 1))

    // The heart answers the finger; the network catches up.
    pendingRef.current.set(productId, !wasLiked)
    if (optimistic !== undefined) {
      countOverrides.set(productId, optimistic)
      setOverrides(prev => ({ ...prev, [productId]: optimistic }))
    }
    setMine(prev => ({ ...prev, [productId]: !wasLiked }))

    // Hold the optimistic answer through the write, then let the server win again.
    const releasePending = window.setTimeout(() => pendingRef.current.delete(productId), 1500)

    try {
      const voteRef = doc(db, 'sellers', sellerId, 'products', productId, 'likes', uid)
      const productRef = doc(db, 'sellers', sellerId, 'products', productId)
      const myIndexRef = doc(db, 'users', uid, 'likes', productId)

      const removed = await runTransaction(db, async tx => {
        const voteSnap = await tx.get(voteRef)
        if (voteSnap.exists()) {
          tx.delete(voteRef)
          tx.delete(myIndexRef)
          tx.set(productRef, { likeCount: firestoreIncrement(-1) }, { merge: true })
          return true
        }
        tx.set(voteRef, { at: Date.now(), source, ...(orderId ? { orderId } : {}) })
        tx.set(myIndexRef, { sellerId, at: Date.now() })
        tx.set(productRef, { likeCount: firestoreIncrement(1) }, { merge: true })
        return false
      })

      // The vote document decides, not the tap: a vote cast somewhere else between the tap
      // and the transaction settles the answer, and the heart has to follow it.
      const liked = !removed
      const settled = optimistic === undefined
        ? undefined
        : (liked === !wasLiked ? optimistic : Math.max(0, optimistic + (liked ? 1 : -1)))
      pendingRef.current.set(productId, liked)
      if (settled !== undefined) {
        countOverrides.set(productId, settled)
        setOverrides(prev => ({ ...prev, [productId]: settled }))
      }
      setMine(prev => ({ ...prev, [productId]: liked }))

      trackEvent(liked ? 'product_liked' : 'product_unliked', { productId, sellerId, surface, source })
      return { ok: true, liked, count: settled }
    } catch (err) {
      console.warn('Failed to save like:', err)
      // Put the heart back exactly where it was — the write never happened.
      window.clearTimeout(releasePending)
      pendingRef.current.delete(productId)
      setMine(prev => {
        const next = { ...prev }
        if (wasLiked) next[productId] = true
        else delete next[productId]
        return next
      })
      if (hadOverride && knownBase !== undefined) {
        countOverrides.set(productId, knownBase)
        setOverrides(prev => ({ ...prev, [productId]: knownBase }))
      } else if (!hadOverride) {
        countOverrides.delete(productId)
        setOverrides(prev => {
          const next = { ...prev }
          delete next[productId]
          return next
        })
      }
      return { ok: false, failed: true }
    }
  }, [])

  return { isLiked, likeCountFor, toggleLike }
}
