/**
 * The Firestore side of a one-time code: the counters, the deadline, and the single use.
 *
 * Everything here is a transaction, and every decision inside it comes from `otp.js` — this file
 * owns only the *atomicity*. That split matters: because the counters live on the same document
 * as the code, one transaction both decides a send and records it, so two taps a second apart
 * cannot both pass the cooldown.
 *
 * Two collections, both closed to the browser entirely (`firestore.rules`):
 *
 *   otpCodes/{phoneKey}  the hashed code, its salt, its expiry, and the send counters
 *   meta/otpSends        one document counting today's sends — the ceiling on the whole bill
 *
 * Neither holds a plain phone number: the key is an HMAC of one (`phoneKey`), so a dump of this
 * collection is a list of opaque strings.
 */
import { FieldValue, adminDb } from './admin.js'
import {
  DAY_MS,
  decideSend,
  decideVerify,
  hashCode,
  newSalt,
  phoneKey,
  secondsUntil,
  stampCode,
} from './otp.js'

export const OTP_CODES = 'otpCodes'
export const META = 'meta'

/** A day's ceiling for the whole deployment — the rail that stops one bad actor and a bill. */
export const DEFAULT_DAILY_CAP = 500

/** The secrets and limits this flow needs, read once and described honestly. */
export function otpConfig(env = process.env) {
  const pepper = String(env.OTP_PEPPER || '').trim()
  const cap = Number.parseInt(env.OTP_DAILY_CAP || '', 10)
  return {
    pepper,
    configured: Boolean(pepper),
    missing: pepper ? [] : ['OTP_PEPPER'],
    dailyCap: Number.isFinite(cap) && cap > 0 ? cap : DEFAULT_DAILY_CAP,
  }
}

const records = () => adminDb().collection(OTP_CODES)

/**
 * Books a send *before* it happens: checks the three per-number rails and, if it passes, stamps
 * the hashed code and the new counters in the same transaction that read them.
 *
 * Returns `{ allow }`. A refusal carries `reason` and `retryAfterSec` for the screen; the code
 * itself exists only as a local variable the caller already holds.
 */
export async function reserveAndStamp({ e164, code, now = Date.now(), pepper, limits }) {
  const ref = records().doc(phoneKey(e164, pepper))
  return adminDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    const decision = decideSend(snap.exists ? snap.data() : null, now, limits)
    if (!decision.allow) {
      return { allow: false, reason: decision.reason, retryAfterSec: decision.retryAfterSec }
    }

    const salt = newSalt()
    const record = stampCode(decision.next, { codeHash: hashCode(code, salt, pepper), codeSalt: salt, now })
    const previous = snap.exists ? snap.data() : null
    tx.set(ref, {
      ...record,
      createdAt: previous && previous.createdAt ? previous.createdAt : now,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    return { allow: true, reason: 'ok', retryAfterSec: 0 }
  })
}

/**
 * Gives a booking back when the SMS never left.
 *
 * Without this, a provider outage would spend the person's hourly allowance on codes that never
 * arrived — punishing them for our bad minute. Best-effort: a failure here is logged and nothing
 * more, because the send already failed and the person is owed a retry either way.
 */
export async function releaseStamp({ e164, now = Date.now(), pepper }) {
  const ref = records().doc(phoneKey(e164, pepper))
  try {
    await adminDb().runTransaction(async (tx) => {
      const snap = await tx.get(ref)
      if (!snap.exists) return
      const data = snap.data()
      tx.set(ref, {
        codeHash: '',
        codeSalt: '',
        expiresAt: 0,
        attempts: 0,
        sentAt: 0,
        hourCount: Math.max(0, (Number(data.hourCount) || 0) - 1),
        dayCount: Math.max(0, (Number(data.dayCount) || 0) - 1),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
    })
  } catch (err) {
    console.error('[otp] could not release a booking:', err && err.message)
  }
}

/**
 * Checks a submitted code and, on a match, destroys it. `decideVerify` also counts the attempt
 * *before* answering and tells us to `burn` — either because it matched, or because it ran out of
 * tries. Burning is a delete, so a code can never be replayed and a dead one cannot be brute
 * forced afterwards.
 */
export async function consume({ e164, submitted, now = Date.now(), pepper, maxAttempts }) {
  const ref = records().doc(phoneKey(e164, pepper))
  return adminDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    const decision = decideVerify(snap.exists ? snap.data() : null, submitted, { now, pepper, maxAttempts })
    if (decision.burn) tx.delete(ref)
    else if (snap.exists && decision.reason === 'mismatch') tx.set(ref, { attempts: decision.attempts }, { merge: true })
    return { ok: decision.ok, reason: decision.reason }
  })
}

/** Counts today's sends across the whole deployment. Its own tiny transaction, its own day. */
export async function reserveGlobal({ now = Date.now(), cap = DEFAULT_DAILY_CAP }) {
  const ref = adminDb().collection(META).doc('otpSends')
  return adminDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    const data = snap.exists ? snap.data() : null
    let dayStart = Number(data && data.dayStart) || 0
    let dayCount = Number.isInteger(data && data.dayCount) ? data.dayCount : 0
    if (!dayStart || now - dayStart >= DAY_MS) { dayStart = now; dayCount = 0 }

    if (dayCount >= cap) {
      return { allow: false, reason: 'global', retryAfterSec: secondsUntil(dayStart + DAY_MS, now) }
    }
    tx.set(ref, { dayStart, dayCount: dayCount + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    return { allow: true, reason: 'ok', retryAfterSec: 0 }
  })
}

/** The other half of `releaseStamp`, for the deployment-wide counter. */
export async function releaseGlobal() {
  const ref = adminDb().collection(META).doc('otpSends')
  try {
    await adminDb().runTransaction(async (tx) => {
      const snap = await tx.get(ref)
      if (!snap.exists) return
      const data = snap.data()
      tx.set(ref, {
        dayCount: Math.max(0, (Number(data.dayCount) || 0) - 1),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
    })
  } catch (err) {
    console.error('[otp] could not release the daily counter:', err && err.message)
  }
}
