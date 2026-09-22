import { useCallback, useEffect, useMemo, useState } from 'react'
import { doc, onSnapshot, setDoc } from 'firebase/firestore'
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

  const account = useMemo(
    () => ({ displayName: auth.currentUser?.displayName, email: auth.currentUser?.email }),
    // Recomputes when the account changes; auth fields themselves are read at call time.
    [uid],
  )
  const suggestion = useMemo(() => suggestName(account), [account])
  /** What checkout pre-fills: what they confirmed, else our suggestion. */
  const prefill = useMemo(() => checkoutPrefill(state, account), [state, account])

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
    trackEvent('buyer_name_saved', { source: next.source, wasSuggestion: fromSuggestion, surface })
    return true
  }, [suggestion, state.askedAt])

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
