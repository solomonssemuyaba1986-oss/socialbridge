import { useCallback, useEffect, useRef, useState } from 'react'
import { collection, doc, getDoc, getDocs, onSnapshot, query, setDoc, where, writeBatch } from 'firebase/firestore'
import { onAuthStateChanged, updateProfile } from 'firebase/auth'
import { auth, db } from './firebase'
import {
  checkoutPrefill,
  cleanBuyerName,
  deviceNameToState,
  emptyNameState,
  hasConfirmedName,
  needsNameAsk,
  publicName,
  suggestName,
  type BuyerNameState,
} from './buyerName'
import { clearDeviceName, readDeviceName, writeDeviceName } from './buyerNameDevice'
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
 * re-asks. The one exception is somebody with no account at all — the "just looking" visitor on the
 * onboarding screen. Their answer waits on the device (`buyerNameDevice.ts`) and is adopted by the
 * account on their first sign-in, so a name chosen before signing up is never one that evaporates.
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
        // No account yet. The name they chose on the onboarding screen (or the Later they tapped)
        // is kept on this device, so read it back in the same shape an account would give us.
        setUid('')
        setState(deviceNameToState(readDeviceName()))
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
    const at = Date.now()
    setState(prev => (prev.askedAt ? prev : { ...prev, askedAt: at }))
    if (state.askedAt) return
    // The funnel counts the ask itself, not the answer — and somebody with no account is still
    // somebody we asked, so this fires before the account write is even considered.
    trackEvent('buyer_name_prompt_shown', { hasSuggestion: Boolean(suggestion.name), surface })
    const user = auth.currentUser
    if (!user) return
    void setDoc(doc(db, 'users', user.uid), { nameAskedAt: at }, { merge: true })
      .catch(err => console.warn('Buyer name: could not record the ask', err))
  }, [state.askedAt, suggestion.name])

  /** Accept a name (ours or theirs). Returns false when it isn't usable, so the field can say so. */
  const save = useCallback(async (entered: string, surface = 'inbox'): Promise<boolean> => {
    const clean = cleanBuyerName(entered)
    if (!clean) return false
    const fromSuggestion = clean === suggestion.name
    const at = Date.now()
    const next = {
      name: clean,
      source: fromSuggestion ? (suggestion.source || 'self') : ('self' as BuyerNameState['source']),
      confirmedAt: at,
      skipped: false,
      askedAt: state.askedAt || at,
    }
    const user = auth.currentUser
    if (!user) {
      // No account yet — the "just looking" visitor on the onboarding step, or a guest at checkout.
      // The name still has to stick somewhere, so it goes to this device and is adopted by the
      // account on their first sign-in. Same events either way: this is one funnel.
      writeDeviceName({ name: clean, skipped: false, at })
      setState(prev => ({ ...prev, ...next }))
      trackEvent('buyer_name_saved', { source: next.source, wasSuggestion: fromSuggestion, surface })
      return true
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
    const at = Date.now()
    setState(prev => ({ ...prev, skipped: true, askedAt: prev.askedAt || at }))
    const user = auth.currentUser
    if (!user) {
      // Nobody to record it on yet: keep the Later on the device so the same ask does not come back
      // tomorrow, and let the account take it over when they sign in.
      writeDeviceName({ name: state.name, skipped: true, at })
      trackEvent('buyer_name_skipped', { surface })
      return
    }
    try {
      await setDoc(doc(db, 'users', user.uid), { nameSkipped: true, nameAskedAt: at }, { merge: true })
    } catch (err) {
      console.warn('Buyer name: could not record the skip', err)
    }
    trackEvent('buyer_name_skipped', { surface })
  }, [state.name])

  /**
   * A name chosen before signing in belongs to the account they then sign in to.
   *
   * Decided from the **database**, never from local state: a snapshot that has not landed yet would
   * otherwise make a long-standing account look nameless and overwrite the answer it already has.
   * A name they confirmed on the account wins outright; otherwise the one they chose on the device
   * is adopted — over a mere "Later", which is not a name — and the device copy is cleared so
   * nothing can ever be adopted twice.
   *
   * It sits below `save` and `skip` on purpose: a dependency array is read during render, so naming
   * them from further up the hook would be a ReferenceError rather than a re-run.
   */
  const adoptedFor = useRef('')
  useEffect(() => {
    if (!uid || loading || adoptedFor.current === uid) return
    const device = readDeviceName()
    if (!device) return
    adoptedFor.current = uid

    void (async () => {
      try {
        const snap = await getDoc(doc(db, 'users', uid))
        const data = (snap.data() || {}) as { nameConfirmedAt?: unknown }
        if (Number(data.nameConfirmedAt) > 0) {
          // They answered on the account itself — that answer is the one of record.
          clearDeviceName()
          return
        }
        if (device.name) {
          const ok = await save(device.name, 'device-adopted')
          if (ok) clearDeviceName()
          return
        }
        if (device.skipped) {
          await skip('device-adopted')
          clearDeviceName()
        }
      } catch (err) {
        console.warn('Buyer name: could not adopt the name from this device', err)
      }
    })()
  }, [uid, loading, save, skip])

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
