import { useCallback, useEffect, useRef, useState } from 'react'
import { doc, getDoc, onSnapshot, setDoc } from 'firebase/firestore'
import { onAuthStateChanged } from 'firebase/auth'
import { auth, db } from './firebase'
import {
  answeredInterests,
  deviceInterestsToState,
  emptyInterests,
  interestsFrom,
  interestsPatch,
  needsInterestsAsk,
  readInterests,
  type InterestsState,
  type InterestSource,
} from './interests'
import {
  clearDeviceInterests,
  readDeviceInterests,
  writeDeviceInterests,
} from './interestsDevice'
import { trackEvent } from './analytics'

/**
 * What this buyer likes, and the one-time ask that collects it.
 *
 * The answer lives on `users/{uid}` — a document the person already owns, so this needs no rules
 * deploy — and it is asked **once**, at most. `interestsAt` is the marker that stops the asking: it
 * is written when they pick shelves, and also when they tap Skip, because "none for now" is an
 * answer. Because the marker is on the account rather than the phone, a new device never re-asks.
 *
 * The one exception is somebody with no account yet (a guest, or a "just looking" visitor): their
 * choices wait on this phone (`interestsDevice.ts`) and are adopted by the account on their first
 * sign-in. A choice given before signing up is never a choice that evaporates.
 *
 * This is optional, so nothing gates on it — but it is the clean signal recommendations are built
 * on, and it stays on the person's own document: never on an order, never on a shop.
 */
export function useInterests() {
  /**
   * Seeded from this phone, not from an empty box: the account answer arrives over the network, and
   * starting empty would flash the ask at somebody who answered on their last visit.
   */
  const [state, setState] = useState<InterestsState>(() => deviceInterestsToState(readDeviceInterests()))
  const [uid, setUid] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let unsubDoc: (() => void) | undefined
    const unsubAuth = onAuthStateChanged(auth, user => {
      unsubDoc?.()
      unsubDoc = undefined
      if (!user || user.isAnonymous) {
        // No account to hold it. Whatever this phone knows is the whole answer we have.
        setUid('')
        setState(deviceInterestsToState(readDeviceInterests()))
        setLoading(false)
        return
      }
      setUid(user.uid)
      setLoading(true)
      unsubDoc = onSnapshot(
        doc(db, 'users', user.uid),
        snap => {
          setState(interestsFrom(snap.data() || {}))
          setLoading(false)
        },
        err => {
          console.warn('Interests: could not read the account', err)
          setLoading(false)
        },
      )
    })
    return () => {
      unsubAuth()
      unsubDoc?.()
    }
  }, [])

  const answered = answeredInterests(state)
  const needsAsk = needsInterestsAsk(state)

  /** Note that the ask was put in front of them (informational; it drives the funnel). */
  const markAsked = useCallback((surface: string) => {
    const at = Date.now()
    setState(prev => (prev.askedAt ? prev : { ...prev, askedAt: at }))
    if (state.askedAt) return
    trackEvent('interests_prompt_shown', { surface })

    const user = auth.currentUser
    if (!user || user.isAnonymous) return
    setDoc(doc(db, 'users', user.uid), { interestsAskedAt: at }, { merge: true })
      .catch(err => console.warn('Interests: could not record the ask', err))
  }, [state.askedAt])

  /**
   * Keep their choices. An empty list is a deliberate skip, not a missing answer. Returns false
   * only when the account write failed, so the picker can say so and let them try again.
   */
  const save = useCallback(async (
    value: string[],
    surface: InterestSource = 'onboarding',
  ): Promise<boolean> => {
    const interests = readInterests(value)
    const at = Date.now()
    const changed = answeredInterests(state)
    const next: InterestsState = {
      interests,
      askedAt: state.askedAt || at,
      answeredAt: at,
      skipped: interests.length === 0,
      source: surface,
    }

    const user = auth.currentUser
    if (!user || user.isAnonymous) {
      // No account yet — the onboarding ask, or a guest. The answer still has to stick somewhere,
      // so it goes to this phone and is adopted by the account on their first sign-in.
      writeDeviceInterests({ interests, skipped: next.skipped, at })
      setState(next)
      trackEvent('interests_saved', {
        count: interests.length,
        categories: interests.join('|'),
        skipped: next.skipped,
        changed,
        surface,
      })
      return true
    }

    setState(next)
    try {
      await setDoc(doc(db, 'users', user.uid), interestsPatch(next), { merge: true })
    } catch (err) {
      console.warn('Interests: could not save', err)
      return false
    }
    trackEvent('interests_saved', {
      count: interests.length,
      categories: interests.join('|'),
      skipped: next.skipped,
      changed,
      surface,
    })
    return true
  }, [state])

  /**
   * Choices given before signing in belong to the account they then sign in to.
   *
   * Decided from the **database**, never from local state: a snapshot that has not landed yet would
   * otherwise make a long-standing account look unanswered and overwrite what it already holds. An
   * answer on the account wins outright; otherwise the one from this phone is adopted, and the
   * device copy is cleared so nothing can ever be adopted twice.
   *
   * It sits below `save` on purpose: a dependency array is read during render, so naming it from
   * further up the hook would be a ReferenceError rather than a re-run.
   */
  const adoptedFor = useRef('')
  useEffect(() => {
    if (!uid || loading || adoptedFor.current === uid) return
    const device = readDeviceInterests()
    if (!device) return
    adoptedFor.current = uid

    void (async () => {
      try {
        const snap = await getDoc(doc(db, 'users', uid))
        const account = interestsFrom(snap.data() || {})
        if (answeredInterests(account)) {
          // They answered on the account itself — that answer is the one of record.
          clearDeviceInterests()
          return
        }
        const ok = await save(device.interests, 'device-adopted')
        if (ok) clearDeviceInterests()
      } catch (err) {
        console.warn('Interests: could not adopt the answer from this device', err)
      }
    })()
  }, [uid, loading, save])

  return {
    state,
    loading,
    uid,
    /** Answered with shelves, or with a deliberate skip. */
    answered,
    /** The optional ask still has to be put in front of them. */
    needsAsk,
    markAsked,
    save,
  }
}

export type Interests = ReturnType<typeof useInterests>

/** The blank record, exported for callers that need it without mounting the hook. */
export { emptyInterests }

