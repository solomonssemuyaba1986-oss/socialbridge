import { useCallback, useEffect, useState } from 'react'
import { collection, doc, getDocs, onSnapshot, query, setDoc, where, writeBatch } from 'firebase/firestore'
import { onAuthStateChanged, updateProfile } from 'firebase/auth'
import { auth, db } from './firebase'
import {
  checkoutPrefill,
  cleanBuyerName,
  emptyNameState,
  hasConfirmedName,
  needsNameAsk,
  publicName,
  suggestName,
  type BuyerNameState,
} from './buyerName'
import { trackEvent } from './analytics'

/**
 * A rename has to reach what already says the old name.
 *
 *  - **Comments**: kept under the buyer's own index (`users/{uid}/comments/{productId}`, written
 *    when they post), so we know exactly which ones to relabel — no collection-group query, no
 *    new rules, and nothing to guess at.
 *  - **Threads**: every conversation they are the buyer of, so the seller's Inbox row and the chat
 *    header stop showing the old name.
 *
 * **Orders are deliberately left alone.** An order records the name a delivery was actually made
 * under; rewriting it could leave a seller matching a parcel to a name that never existed.
 */
async function spreadNameEverywhere(uid: string, shortName: string): Promise<void> {
  if (!uid || !shortName) return

  try {
    const index = await getDocs(collection(db, 'users', uid, 'comments'))
    if (!index.empty) {
      const batch = writeBatch(db)
      let touched = 0
      index.docs.slice(0, 400).forEach(entry => {
        const sellerId = String((entry.data() as { sellerId?: unknown }).sellerId || '')
        if (!sellerId) return
        batch.set(doc(db, 'sellers', sellerId, 'products', entry.id, 'reviews', uid), { buyerName: shortName }, { merge: true })
        touched++
      })
      if (touched > 0) await batch.commit()
    }
  } catch (err) {
    console.warn('Rename: comments could not be relabelled', err)
  }

  try {
    const threads = await getDocs(query(collection(db, 'conversations'), where('buyerId', '==', uid)))
    if (!threads.empty) {
      const batch = writeBatch(db)
      threads.docs.forEach(thread => batch.update(thread.ref, { buyerName: shortName }))
      await batch.commit()
    }
  } catch (err) {
    console.warn('Rename: threads could not be relabelled', err)
  }
}

/**
 * What we call this buyer, and where we keep it.
 *
 * The name lives on `users/{uid}` — a document the buyer already owns, so this needs no rules
 * deploy — and it is mirrored into the auth profile, which is what makes every existing
 * `displayName || 'Buyer'` across the app start telling the truth from one call.
 *
 * Asked once, ever: `confirmedAt` (they accepted or typed one) or `skipped` (they tapped Later)
 * both stop the asking. Those markers are on the account, not the device, so a new phone never
 * re-asks.
 */
export function useBuyerName() {
  const [state, setState] = useState<BuyerNameState>(emptyNameState())
  const [uid, setUid] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let unsubDoc: (() => void) | undefined
    const unsubAuth = onAuthStateChanged(auth, user => {
      unsubDoc?.()
      unsubDoc = undefined
      if (!user || user.isAnonymous) {
        setUid('')
        setState(emptyNameState())
        setLoading(false)
        return
      }
      setUid(user.uid)
      setLoading(true)
      unsubDoc = onSnapshot(
        doc(db, 'users', user.uid),
        snap => {
          const data = (snap.data() || {}) as Record<string, unknown>
          setState({
            name: typeof data.displayName === 'string' ? data.displayName : '',
            source: typeof data.nameSource === 'string' ? (data.nameSource as BuyerNameState['source']) : '',
            askedAt: Number(data.nameAskedAt) || 0,
            confirmedAt: Number(data.nameConfirmedAt) || 0,
            skipped: data.nameSkipped === true,
          })
          setLoading(false)
        },
        err => {
          console.warn('Buyer name: could not read the account', err)
          setLoading(false)
        },
      )
    })
    return () => {
      unsubAuth()
      unsubDoc?.()
    }
  }, [])

  /**
   * Read at call time rather than memoised: `auth.currentUser` is not a reactive value, and these
   * two are cheap. (A `useMemo` here produced a dependency warning and bought nothing.)
   */
  const account = { displayName: auth.currentUser?.displayName, email: auth.currentUser?.email }
  const suggestion = suggestName(account)
  /** What checkout pre-fills: what they confirmed, else our suggestion. */
  const prefill = checkoutPrefill(state, account)

  /** Their confirmed name, or the suggestion to show in offers — never a bare "Buyer". */
  const label = publicName(state.name || suggestion.name)
  const confirmed = hasConfirmedName(state)
  const needsAsk = needsNameAsk(state)

  /** Note that the one-time ask was put in front of them (informational; drives the funnel). */
  const markAsked = useCallback((surface: string) => {
    const user = auth.currentUser
    if (!user) return
    const at = Date.now()
    setState(prev => (prev.askedAt ? prev : { ...prev, askedAt: at }))
    if (state.askedAt) return
    void setDoc(doc(db, 'users', user.uid), { nameAskedAt: at }, { merge: true })
      .catch(err => console.warn('Buyer name: could not record the ask', err))
    trackEvent('buyer_name_prompt_shown', { hasSuggestion: Boolean(suggestion.name), surface })
  }, [state.askedAt, suggestion.name])

  /** Accept a name (ours or theirs). Returns false when it isn't usable, so the field can say so. */
  const save = useCallback(async (entered: string, surface = 'inbox'): Promise<boolean> => {
    const clean = cleanBuyerName(entered)
    const user = auth.currentUser
    if (!clean || !user) return false
    const fromSuggestion = clean === suggestion.name
    const at = Date.now()
    const next = {
      name: clean,
      source: fromSuggestion ? (suggestion.source || 'self') : ('self' as BuyerNameState['source']),
      confirmedAt: at,
      skipped: false,
      askedAt: state.askedAt || at,
    }
    setState(prev => ({ ...prev, ...next }))
    try {
      await setDoc(doc(db, 'users', user.uid), {
        displayName: next.name,
        nameSource: next.source,
        nameConfirmedAt: next.confirmedAt,
        nameSkipped: false,
        nameAskedAt: next.askedAt,
      }, { merge: true })
      // One call, and every `displayName || 'Buyer'` in the app has a real name to use.
      await updateProfile(user, { displayName: next.name })
    } catch (err) {
      console.warn('Buyer name: could not save', err)
      return false
    }
    // Changing a name that already existed has to reach what already says the old one. Fire and
    // forget: the rename itself must never fail because a relabel did.
    if (state.name && state.name !== clean) {
      void spreadNameEverywhere(user.uid, publicName(clean))
    }
    trackEvent('buyer_name_saved', { source: next.source, wasSuggestion: fromSuggestion, surface })
    return true
  }, [suggestion, state.askedAt, state.name])

  /** "Later" — quietly, once. The line in the Inbox header stays available for good. */
  const skip = useCallback(async (surface = 'inbox') => {
    const user = auth.currentUser
    setState(prev => ({ ...prev, skipped: true, askedAt: prev.askedAt || Date.now() }))
    if (!user) return
    try {
      await setDoc(doc(db, 'users', user.uid), { nameSkipped: true, nameAskedAt: Date.now() }, { merge: true })
    } catch (err) {
      console.warn('Buyer name: could not record the skip', err)
    }
    trackEvent('buyer_name_skipped', { surface })
  }, [])

  /**
   * Remember a name that arrived from checkout — but only when it is actually new, so a buyer who
   * orders five times doesn't fire five "name saved" events for the same name.
   */
  const rememberIfNew = useCallback(async (entered: string, surface = 'checkout') => {
    const clean = cleanBuyerName(entered)
    if (!clean || clean === state.name) return
    await save(clean, surface)
  }, [save, state.name])

  return {
    state,
    loading,
    uid,
    /** Their name, or our suggestion for it — '' when we have nothing to offer. */
    name: state.name || suggestion.name,
    label,
    suggestion,
    prefill,
    confirmed,
    needsAsk,
    markAsked,
    save,
    skip,
    rememberIfNew,
  }
}

export type BuyerName = ReturnType<typeof useBuyerName>
