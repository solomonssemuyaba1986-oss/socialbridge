import { useCallback, useEffect, useRef, useState } from 'react'
import { doc, getDoc, onSnapshot, setDoc } from 'firebase/firestore'
import { onAuthStateChanged } from 'firebase/auth'
import { auth, db } from './firebase'
import {
  answeredDemographics,
  demographicsFrom,
  demographicsPatch,
  deviceDemographicsToState,
  needsDemographicsAsk,
  readAgeAnswer,
  readGenderAnswer,
  type AgeAnswer,
  type DemographicsSource,
  type DemographicsState,
  type GenderAnswer,
} from './demographics'
import {
  clearDeviceDemographics,
  readDeviceDemographics,
  writeDeviceDemographics,
} from './demographicsDevice'
import { trackEvent } from './analytics'

/**
 * Who this person is: their age band and their gender, and the one-time ask that collects them.
 *
 * The answer lives on `users/{uid}` — a document the person already owns, so this needs no rules
 * deploy — and it is asked **once**. `answeredAt` is the marker that stops the asking, and it is on
 * the account rather than the phone, so a new device never re-asks. The one exception is somebody
 * with no account at all (a guest, or a "just looking" visitor): their two taps wait on the device
 * (`demographicsDevice.ts`) and are adopted by the account on their first sign-in, so an answer
 * given before signing up is never an answer that evaporates.
 *
 * It is required — every surface that shows the ask blocks on it — but "Prefer not to say" is one of
 * the answers, so nobody is ever forced into a fact that is not theirs (see `demographics.ts`).
 */
export function useDemographics() {
  /**
   * Seeded from this phone, not from an empty box: the account answer arrives over the network, and
   * starting empty would flash the ask at somebody who answered on their last visit.
   */
  const [state, setState] = useState<DemographicsState>(() => deviceDemographicsToState(readDeviceDemographics()))
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
        setState(deviceDemographicsToState(readDeviceDemographics()))
        setLoading(false)
        return
      }
      setUid(user.uid)
      setLoading(true)
      unsubDoc = onSnapshot(
        doc(db, 'users', user.uid),
        snap => {
          setState(demographicsFrom(snap.data() || {}))
          setLoading(false)
        },
        err => {
          console.warn('Age & gender: could not read the account', err)
          setLoading(false)
        },
      )
    })
    return () => {
      unsubAuth()
      unsubDoc?.()
    }
  }, [])

  const answered = answeredDemographics(state)
  const needsAsk = needsDemographicsAsk(state)

  /** Note that the ask was put in front of them (informational; it drives the funnel). */
  const markAsked = useCallback((surface: string) => {
    const at = Date.now()
    setState(prev => (prev.askedAt ? prev : { ...prev, askedAt: at }))
    if (state.askedAt) return
    // The funnel counts the ask itself, not the answer — and somebody with no account is still
    // somebody we asked, so this fires before the account write is even considered.
    trackEvent('demographics_prompt_shown', { surface })
    const user = auth.currentUser
    if (!user || user.isAnonymous) return
    void setDoc(doc(db, 'users', user.uid), { demographicsAskedAt: at }, { merge: true })
      .catch(err => console.warn('Age & gender: could not record the ask', err))
  }, [state.askedAt])

  /**
   * Keep both answers. Returns false if either is missing, so the ask can say so rather than store
   * half a person.
   */
  const save = useCallback(async (
    ageBand: AgeAnswer | '',
    gender: GenderAnswer | '',
    surface: DemographicsSource = 'gate',
  ): Promise<boolean> => {
    const band = readAgeAnswer(ageBand)
    const who = readGenderAnswer(gender)
    if (!band || !who) return false

    const at = Date.now()
    const changed = answeredDemographics(state)
    const next: DemographicsState = {
      ageBand: band,
      gender: who,
      askedAt: state.askedAt || at,
      answeredAt: at,
      source: surface,
    }

    const user = auth.currentUser
    if (!user || user.isAnonymous) {
      // No account yet — the onboarding ask, or a guest. The answer still has to stick somewhere,
      // so it goes to this phone and is adopted by the account on their first sign-in. Same events
      // either way: this is one funnel.
      writeDeviceDemographics({ ageBand: band, gender: who, at })
      setState(next)
      trackEvent('demographics_answered', { ageBand: band, gender: who, surface, changed })
      return true
    }

    setState(next)
    try {
      await setDoc(doc(db, 'users', user.uid), demographicsPatch(next), { merge: true })
    } catch (err) {
      console.warn('Age & gender: could not save', err)
      return false
    }
    trackEvent('demographics_answered', { ageBand: band, gender: who, surface, changed })
    return true
  }, [state])

  /**
   * An answer given before signing in belongs to the account they then sign in to.
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
    const device = readDeviceDemographics()
    if (!device) return
    adoptedFor.current = uid

    void (async () => {
      try {
        const snap = await getDoc(doc(db, 'users', uid))
        const account = demographicsFrom(snap.data() || {})
        if (answeredDemographics(account)) {
          // They answered on the account itself — that answer is the one of record.
          clearDeviceDemographics()
          return
        }
        const ok = await save(device.ageBand, device.gender, 'device-adopted')
        if (ok) clearDeviceDemographics()
      } catch (err) {
        console.warn('Age & gender: could not adopt the answer from this device', err)
      }
    })()
  }, [uid, loading, save])

  return {
    state,
    loading,
    uid,
    /** Both questions answered — either on the account or on this phone. */
    answered,
    /** The ask still has to be put in front of them. */
    needsAsk,
    markAsked,
    save,
  }
}

export type Demographics = ReturnType<typeof useDemographics>
