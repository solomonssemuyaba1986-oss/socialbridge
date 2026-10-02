/**
 * One-time codes, the honest way.
 *
 * A phone number is proved by *receiving* a code, so the only thing that must never happen is
 * that code being readable anywhere the sender did not put it: not in the database, not in a
 * response body, not in a log line, not in a debug field. Everything in this file exists to make
 * that true by construction rather than by remembering:
 *
 *  - the code is generated with a CSPRNG (`crypto.randomInt`), never `Math.random`;
 *  - what is stored is an HMAC of the code, keyed with a server-only pepper, so someone who can
 *    read the database but not the environment has nothing they can use;
 *  - the compare is constant-time, so a wrong guess cannot be narrowed by timing the answer;
 *  - expiry, attempt limits and the resend windows are *decisions* — pure functions of a record
 *    and a timestamp — so `_otp_check.cjs` can prove them with no network and no database.
 *
 * Pure on purpose: no Firebase, no `fetch`, and `process.env` is never read here. The store and
 * the SMS sender live beside this file and are the only things that reach outside the process.
 *
 * The old dev server kept codes in an in-memory `Map` and handed one back as `debugOtp` whenever
 * the key was missing (`server/index.js:99-104`). There is no equivalent here: the missing-key
 * path refuses instead, and nothing in this flow ever returns a code to the caller.
 */
import crypto from 'node:crypto'

/** Six digits, five minutes, one a minute — and a hard stop well before it becomes a bill. */
export const CODE_LENGTH = 6
export const CODE_TTL_MS = 5 * 60 * 1000
export const RESEND_COOLDOWN_MS = 60 * 1000
export const MAX_PER_HOUR = 3
export const MAX_PER_DAY = 10
export const MAX_ATTEMPTS = 5
export const MINUTE_MS = 60 * 1000
export const HOUR_MS = 60 * MINUTE_MS
export const DAY_MS = 24 * HOUR_MS

/** A fresh code. Uniform over 000000–999999, left-padded so leading zeros survive. */
export function generateCode(randomInt = crypto.randomInt) {
  return String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, '0')
}

export function newSalt(randomBytes = crypto.randomBytes) {
  return randomBytes(16).toString('hex')
}

/** The only form of a code that is ever written down. */
export function hashCode(code, salt, pepper) {
  if (!pepper) throw new Error('OTP_PEPPER is not set — refusing to hash a code without it')
  return crypto.createHmac('sha256', pepper).update(`${salt}:${String(code)}`).digest('hex')
}

/** Constant-time, and false for anything that is not a full-length digest. */
export function codeMatches(code, storedHash, salt, pepper) {
  const a = Buffer.from(hashCode(code, salt, pepper), 'utf8')
  const b = Buffer.from(String(storedHash || ''), 'utf8')
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

export function isCodeFormat(raw) {
  return typeof raw === 'string' && /^\d{6}$/.test(raw.trim())
}

/** What a person typed, reduced to the digits that will be compared. */
export function readCode(raw) {
  return typeof raw === 'string' ? raw.replace(/\D/g, '').slice(0, CODE_LENGTH) : ''
}

/**
 * The document key for a number in `otpCodes` / `phones`.
 *
 * Keyed by the pepper, so those collections hold no raw phone number at all: a leaked dump of
 * `otpCodes` is a list of opaque keys, not a list of who tried to sign up. `phones/` uses the
 * same key, so the uniqueness check and the rate-limit counters agree on what "this number" is.
 */
export function phoneKey(e164, pepper) {
  if (!pepper) throw new Error('OTP_PEPPER is not set — refusing to key a number without it')
  return crypto.createHmac('sha256', pepper).update(`phone:${e164}`).digest('hex').slice(0, 32)
}

/** A blank record. The counters share the document with the code, so one write decides both. */
export function emptyRecord(now) {
  return {
    codeHash: '',
    codeSalt: '',
    expiresAt: 0,
    attempts: 0,
    sentAt: 0,
    hourStart: now || 0,
    hourCount: 0,
    dayStart: now || 0,
    dayCount: 0,
  }
}

export function secondsUntil(at, now) {
  return Math.max(1, Math.ceil((at - now) / 1000))
}

/**
 * May we send another code to this number, right now?
 *
 * Three rails, met in the order a person meets them: the minute (so a double-tap sends one SMS,
 * not two), the hour (a mistyped number is not a way to drain the account), then the day. The
 * answer carries `retryAfterSec`, so the screen can say "try again in 42 seconds" instead of a
 * shrug — and `next`, the counters to commit if the caller goes ahead.
 *
 * `now` is passed in and never read from the clock here, which is what lets the harness test a
 * cooldown without waiting a minute for it.
 */
export function decideSend(record, now, limits = {}) {
  const cooldownMs = limits.cooldownMs ?? RESEND_COOLDOWN_MS
  const maxPerHour = limits.maxPerHour ?? MAX_PER_HOUR
  const maxPerDay = limits.maxPerDay ?? MAX_PER_DAY
  const current = { ...emptyRecord(now), ...(record || {}) }

  if (current.sentAt && now - current.sentAt < cooldownMs) {
    return {
      allow: false,
      reason: 'cooldown',
      retryAfterSec: secondsUntil(current.sentAt + cooldownMs, now),
      next: current,
    }
  }

  let hourStart = current.hourStart || 0
  let hourCount = Number.isInteger(current.hourCount) ? current.hourCount : 0
  if (!hourStart || now - hourStart >= HOUR_MS) { hourStart = now; hourCount = 0 }

  let dayStart = current.dayStart || 0
  let dayCount = Number.isInteger(current.dayCount) ? current.dayCount : 0
  if (!dayStart || now - dayStart >= DAY_MS) { dayStart = now; dayCount = 0 }

  if (hourCount >= maxPerHour) {
    return {
      allow: false,
      reason: 'hourly',
      retryAfterSec: secondsUntil(hourStart + HOUR_MS, now),
      next: { ...current, hourStart, hourCount, dayStart, dayCount },
    }
  }
  if (dayCount >= maxPerDay) {
    return {
      allow: false,
      reason: 'daily',
      retryAfterSec: secondsUntil(dayStart + DAY_MS, now),
      next: { ...current, hourStart, hourCount, dayStart, dayCount },
    }
  }

  return {
    allow: true,
    reason: 'ok',
    retryAfterSec: 0,
    next: { ...current, hourStart, hourCount: hourCount + 1, dayStart, dayCount: dayCount + 1 },
  }
}

/** Puts a fresh code on a record: hashed, stamped, expiring, attempts reset. */
export function stampCode(record, { codeHash, codeSalt, now, ttlMs = CODE_TTL_MS }) {
  return { ...record, codeHash, codeSalt, expiresAt: now + ttlMs, attempts: 0, sentAt: now }
}

/**
 * Three questions, in the order that gives the least away: is anything live here, has it
 * expired, does it match — with the attempt count moving *before* the answer, so a code cannot
 * be guessed at leisure. `burn` is the caller's instruction to delete the whole record: a
 * matched code is single-use, and a code out of attempts is dead too.
 */
export function decideVerify(record, submitted, { now, pepper, maxAttempts = MAX_ATTEMPTS } = {}) {
  if (!record || !record.codeHash) return { ok: false, reason: 'none', attempts: 0, burn: false }
  if (!record.expiresAt || now > record.expiresAt) return { ok: false, reason: 'expired', attempts: 0, burn: true }

  const attempts = (Number.isInteger(record.attempts) ? record.attempts : 0) + 1
  const matched = codeMatches(submitted, record.codeHash, record.codeSalt, pepper)

  if (matched) return { ok: true, reason: 'match', attempts, burn: true }
  if (attempts >= maxAttempts) return { ok: false, reason: 'attempts', attempts, burn: true }
  return { ok: false, reason: 'mismatch', attempts, burn: false }
}

/** What a person is told for each refusal — words they can act on, never a hint at the code. */
export const VERIFY_MESSAGES = {
  none: 'That code has already been used or expired — request a new one.',
  expired: 'That code has expired — request a new one.',
  mismatch: 'That code is not right. Check the six digits and try again.',
  attempts: 'Too many wrong codes — request a new one.',
}

export const SEND_MESSAGES = {
  cooldown: 'A code was just sent — give it a moment, then ask again.',
  hourly: 'That is the third code in an hour. Try again a little later.',
  daily: 'Too many codes sent to this number today. Try again tomorrow.',
  global: 'We have sent all the codes we can today. Please try again tomorrow.',
}

