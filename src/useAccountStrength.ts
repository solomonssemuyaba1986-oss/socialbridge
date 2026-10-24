/**
 * The live account-strength state: which ways in this account has, what it is missing, and when
 * the next phone reminder is due.
 *
 * It listens to three things, and only three:
 *   - Firebase Auth, which knows the account's phone number and email identity;
 *   - `users/{uid}`, where consent/reminder timestamps live (the person owns this document);
 *   - `trust/{uid}`, the server-written proof that can land a moment before Auth refreshes.
 *
 * Everything derived is pure and lives in `accountStrength.ts`. This file is just the wiring.
 */
import { useCallback, useEffect, useState } from 'react'
import { onAuthStateChanged, type User } from 'firebase/auth'
import { doc, onSnapshot, setDoc } from 'firebase/firestore'
import { auth, db } from './firebase'
import {
  accountStrength,
  nextPhoneNudgeAt,
  phoneNudgeDue,
  shouldOfferContacts,
  type AccountFacts,
  type AccountStrength,
} from './accountStrength'

export type AccountDocFacts = {
  contactsAskedAt: number
  contactsConsentAt: number
  contactsMatchedCount: number
  accountNudgeAt: number
}

const EMPTY_DOC: AccountDocFacts = {
  contactsAskedAt: 0,
  contactsConsentAt: 0,
  contactsMatchedCount: 0,
  accountNudgeAt: 0,
}

/** Firestore can hand a timestamp back as a number or as a Timestamp. Both become ms. */
function millisOf(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (value && typeof value === 'object' && 'toMillis' in value) {
    try {
      const ms = (value as { toMillis: () => number }).toMillis()
      return Number.isFinite(ms) ? ms : 0
    } catch {
      return 0
    }
  }
  return 0
}

function docFacts(data: Record<string, unknown> | null | undefined): AccountDocFacts {
  const source = data || {}
  return {
    contactsAskedAt: millisOf(source.contactsAskedAt),
    contactsConsentAt: millisOf(source.contactsConsentAt),
    contactsMatchedCount: Math.max(0, Number(source.contactsMatchedCount) || 0),
    accountNudgeAt: millisOf(source.accountNudgeAt),
  }
}

function deviceFacts(): { timeZone: string; language: string } {
  let timeZone = ''
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || ''
  } catch {
    // A browser that cannot name its zone simply falls back to the locale.
  }
  const language = typeof navigator !== 'undefined' ? navigator.language || '' : ''
  return { timeZone, language }
}

export type AccountStrengthState = {
  user: User | null
  loading: boolean
  strength: AccountStrength
  facts: AccountFacts
  account: AccountDocFacts
  /** The account is email-only, in phone-first territory, and the nine days are up. */
  nudgeDue: boolean
  /** When the next reminder would be due; 0 when there can never be one. */
  nextNudgeAt: number
  /** Whether contact discovery has never been offered for this account. */
  contactsDue: boolean
  /** Re-read the Auth user after the server changes their phone number. */
  refresh: () => Promise<void>
  /** Record that the News page showed the nine-day reminder, starting the next interval. */
  markNudgeSeen: () => Promise<void>
  /** Record that contact discovery was put in front of them, so it never nags. */
  markContactsAsked: () => Promise<void>
}

export function useAccountStrength(): AccountStrengthState {
  const [user, setUser] = useState<User | null>(auth.currentUser)
  const [account, setAccount] = useState<AccountDocFacts>(EMPTY_DOC)
  const [phoneProven, setPhoneProven] = useState(false)
  const [loading, setLoading] = useState(true)
  const [, setRevision] = useState(0)

  useEffect(() => {
    let unsubUserDoc: (() => void) | undefined
    let unsubTrust: (() => void) | undefined

    const unsubAuth = onAuthStateChanged(auth, next => {
      unsubUserDoc?.()
      unsubTrust?.()
      unsubUserDoc = undefined
      unsubTrust = undefined
      setUser(next)

      if (!next || next.isAnonymous) {
        setAccount(EMPTY_DOC)
        setPhoneProven(false)
        setLoading(false)
        return
      }

      setLoading(true)
      unsubUserDoc = onSnapshot(
        doc(db, 'users', next.uid),
        snap => {
          setAccount(docFacts(snap.data() as Record<string, unknown> | undefined))
          setLoading(false)
        },
        err => {
          console.warn('Account strength: could not read the account record', err)
          setLoading(false)
        },
      )
      unsubTrust = onSnapshot(
        doc(db, 'trust', next.uid),
        snap => setPhoneProven(snap.exists() && snap.data()?.phoneProven === true),
        err => {
          console.warn('Account strength: could not read the phone proof', err)
          setPhoneProven(false)
        },
      )
    })

    return () => {
      unsubAuth()
      unsubUserDoc?.()
      unsubTrust?.()
    }
  }, [])

  const device = deviceFacts()
  const facts: AccountFacts = {
    anonymous: !!user?.isAnonymous,
    phoneNumber: user?.phoneNumber || null,
    phoneProven,
    email: user?.email || null,
    providers: user?.providerData?.map(provider => provider.providerId) || [],
    createdAtMs: user?.metadata?.creationTime ? Date.parse(user.metadata.creationTime) : 0,
    timeZone: device.timeZone,
    language: device.language,
  }
  const strength = accountStrength(facts)

  const refresh = useCallback(async () => {
    // Firebase mutates the same User object in place, so a state update that only sets the same
    // reference would be ignored. `setRevision` is what makes the new phone number render.
    try {
      await auth.currentUser?.reload()
    } catch (err) {
      console.warn('Account strength: could not refresh the account', err)
    }
    setUser(auth.currentUser)
    setRevision(value => value + 1)
  }, [])

  const markNudgeSeen = useCallback(async () => {
    const at = Date.now()
    setAccount(prev => ({ ...prev, accountNudgeAt: at }))
    const uid = auth.currentUser?.uid
    if (!uid) return
    try {
      await setDoc(doc(db, 'users', uid), { accountNudgeAt: at }, { merge: true })
    } catch (err) {
      console.warn('Account strength: could not record the reminder', err)
    }
  }, [])

  const markContactsAsked = useCallback(async () => {
    const at = Date.now()
    setAccount(prev => ({ ...prev, contactsAskedAt: at }))
    const uid = auth.currentUser?.uid
    if (!uid) return
    try {
      await setDoc(doc(db, 'users', uid), { contactsAskedAt: at }, { merge: true })
    } catch (err) {
      console.warn('Account strength: could not record the contact ask', err)
    }
  }, [])

  const nudgeDue = phoneNudgeDue({ strength, facts, lastNudgeAt: account.accountNudgeAt })
  const nextNudgeAt = strength.hasEmail && !strength.hasPhone && strength.african
    ? nextPhoneNudgeAt({ createdAtMs: facts.createdAtMs, lastNudgeAt: account.accountNudgeAt })
    : 0

  return {
    user,
    loading,
    strength,
    facts,
    account,
    nudgeDue,
    nextNudgeAt,
    contactsDue: shouldOfferContacts({
      strength,
      contactsAskedAt: account.contactsAskedAt,
      contactsConsentAt: account.contactsConsentAt,
    }),
    refresh,
    markNudgeSeen,
    markContactsAsked,
  }
}

