/**
 * How strong an account is, in one place.
 *
 * A rachett account is strongest with **two independent ways back in**: a verified phone number
 * and an email identity (Google today). The phone is the one that matters most in the markets we
 * serve — it is the number a code reaches, the number mobile money is attached to, and the proof
 * behind the real-seller badge. Email is the spare key: it gets somebody back in after a SIM swap
 * or a new number, and it makes the account portable to a new phone.
 *
 * This module deliberately says **facts, not a score**. "One way in" is a state with a next step,
 * not a rating of the person. Pure, so `_account_strength_check.cjs` can pin every branch and the
 * nine-day reminder without a browser or a database.
 */
import { isAfricanAccount, isAfricanPhone } from './africa'

export const NUDGE_INTERVAL_MS = 9 * 24 * 60 * 60 * 1000

export type AccountMethod = 'phone' | 'email'

export type AccountFacts = {
  /** Anonymous Firebase accounts are guests. */
  anonymous?: boolean
  /** `auth.currentUser.phoneNumber`, set only by the server after an OTP came back correct. */
  phoneNumber?: string | null
  /** `trust/{uid}.phoneProven` — the server-written proof, which can arrive before the client reloads. */
  phoneProven?: boolean
  /** `auth.currentUser.email` — Google accounts carry one; phone-only accounts do not. */
  email?: string | null
  /** `auth.currentUser.providerData.map(p => p.providerId)`. */
  providers?: readonly string[]
  /** `auth.currentUser.metadata.creationTime`, in milliseconds. */
  createdAtMs?: number
  /** The device's IANA time zone — only used when there is no verified number. */
  timeZone?: string | null
  /** `navigator.language` — the fallback region when there is no number and no usable zone. */
  language?: string | null
}

export type AccountStrength = {
  guest: boolean
  hasPhone: boolean
  hasEmail: boolean
  hasGoogle: boolean
  methods: AccountMethod[]
  strong: boolean
  missing: AccountMethod[]
  /** In phone-first territory: a verified African number, or an African device zone/locale. */
  african: boolean
}

function hasGoogleProvider(providers: readonly string[] | undefined): boolean {
  return Array.isArray(providers) && providers.includes('google.com')
}

/** Which ways in this account has, and the one it is missing. */
export function accountStrength(facts: AccountFacts): AccountStrength {
  const guest = facts.anonymous === true
  const hasPhone = !guest && (Boolean(String(facts.phoneNumber || '').trim()) || facts.phoneProven === true)
  const hasGoogle = !guest && hasGoogleProvider(facts.providers)
  const hasEmail = !guest && (Boolean(String(facts.email || '').trim()) || hasGoogle)
  const methods: AccountMethod[] = []
  if (hasPhone) methods.push('phone')
  if (hasEmail) methods.push('email')
  const missing: AccountMethod[] = []
  if (!hasPhone) missing.push('phone')
  if (!hasEmail) missing.push('email')

  return {
    guest,
    hasPhone,
    hasEmail,
    hasGoogle,
    methods,
    strong: hasPhone && hasEmail,
    missing,
    african: !guest && isAfricanAccount({
      phoneNumber: facts.phoneNumber,
      timeZone: facts.timeZone,
      language: facts.language,
    }),
  }
}

/** The two words the account screen uses for its own state. */
export function strengthLabel(strength: AccountStrength): string {
  if (strength.guest) return 'Guest'
  if (strength.strong) return 'Strong account'
  return strength.hasPhone ? 'Phone only' : 'Email only'
}

export function methodsLabel(strength: AccountStrength): string {
  return strength.methods.length ? strength.methods.join('|') : 'none'
}

/**
 * When the next nine-day phone reminder becomes due.
 *
 * The first one is nine days after the account was made, not nine days after we happened to see
 * them. After that it is nine days after the last reminder. `0` means "cannot know" (no creation
 * time), which must produce silence rather than an instant nag.
 */
export function nextPhoneNudgeAt(input: {
  createdAtMs?: number
  lastNudgeAt?: number
  intervalMs?: number
}): number {
  const interval = input.intervalMs ?? NUDGE_INTERVAL_MS
  const last = Number(input.lastNudgeAt) || 0
  if (last > 0) return last + interval
  const created = Number(input.createdAtMs) || 0
  return created > 0 ? created + interval : 0
}

/**
 * Should the account's News & Updates page carry the phone reminder right now?
 *
 * Only email-only accounts in phone-first territory. An account with a phone has nothing to be
 * reminded about, a guest has no account to strengthen, and an email-only account outside Africa
 * is left in peace — exactly the boundary the product asks for.
 */
export function phoneNudgeDue(input: {
  strength: AccountStrength
  facts: AccountFacts
  lastNudgeAt?: number
  now?: number
  intervalMs?: number
}): boolean {
  const { strength, facts } = input
  if (strength.guest || strength.hasPhone || !strength.hasEmail || !strength.african) return false
  const dueAt = nextPhoneNudgeAt({
    createdAtMs: facts.createdAtMs,
    lastNudgeAt: input.lastNudgeAt,
    intervalMs: input.intervalMs,
  })
  if (!dueAt) return false
  return (input.now ?? Date.now()) >= dueAt
}

/** One-time contact discovery: only an account that has proved a phone can use it. */
export function shouldOfferContacts(input: {
  strength: AccountStrength
  contactsAskedAt?: number
  contactsConsentAt?: number
}): boolean {
  return !input.strength.guest
    && input.strength.hasPhone
    && !Number(input.contactsAskedAt)
    && !Number(input.contactsConsentAt)
}

/** True when the phone is African, for copy that says why the number matters here. */
export function africanPhone(phoneNumber: string | null | undefined): boolean {
  return isAfricanPhone(phoneNumber)
}
