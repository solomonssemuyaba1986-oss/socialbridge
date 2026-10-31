/**
 * The rate limit on "is this number already an account?", which is the one question here whose
 * answer is worth stealing.
 *
 * `otp/send` is careful *not* to say whether a number exists: it texts a code or it refuses, and
 * never repeats the number back. A lookup endpoint cannot have that luxury — the whole point is to
 * say "yes, we know that number" — so it becomes the one place in the API where a stranger can ask
 * about numbers and learn something. Two things keep that from being a sweep:
 *
 *  - **A cap per caller.** A person checking their own number twice is normal; forty an hour is a
 *    script. The counter is per hour because that is the shortest window in which a sweep is
 *    worth doing.
 *  - **No raw address on disk.** The counter document is keyed by an HMAC of the caller's address
 *    with the same pepper that keys phone numbers, so `lookupChecks/` holds opaque strings and no
 *    IP address ever survives a dump.
 *
 * Deliberately *not* per number: counting per number would mean the document key is derived from
 * the number, and refusing after N checks would tell the caller they have been probing a single
 * number — a second, quieter oracle. The cost of the missing counter is that one caller can learn
 * about many numbers slowly, which is why the cap below is small and the copy in `lookup.js` is
 * silent about which limit was hit.
 */
import crypto from 'node:crypto'
import { FieldValue, adminDb } from './admin.js'
import { HOUR_MS, secondsUntil } from './otp.js'

export const LOOKUP_CHECKS = 'lookupChecks'

/** How many checks one caller may make in an hour. Enough to try the numbers a person owns. */
export const DEFAULT_HOURLY_CAP = 12

/** The cap, read from the environment so it can be tightened without a deploy of this file. */
export function lookupConfig(env = process.env) {
  const cap = Number.parseInt(env.LOOKUP_HOURLY_CAP || '', 10)
  return { hourlyCap: Number.isFinite(cap) && cap > 0 ? cap : DEFAULT_HOURLY_CAP }
}

/**
 * Who is asking, as something storable.
 *
 * Vercel puts the client address in `x-forwarded-for` (first entry is the client, the rest are
 * proxies). Anything missing becomes `local`, so a laptop or a health check shares one bucket
 * rather than crashing — and a caller who can strip the header is a caller who is already inside
 * our network edge, where the cap is not the only thing standing between them and the data.
 */
export function callerKey(req, pepper) {
  if (!pepper) throw new Error('OTP_PEPPER is not set — refusing to key a caller without it')
  const forwarded = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim()
  const address = forwarded || String(req.socket?.remoteAddress || 'local')
  return crypto.createHmac('sha256', pepper).update(`caller:${address}`).digest('hex').slice(0, 32)
}

/**
 * Takes one check from the caller's hourly allowance.
 *
 * A transaction, for the same reason the send counters are: two requests in the same instant must
 * not both read "one left" and both pass.
 */
export async function reserveLookup({ key, now = Date.now(), hourlyCap = DEFAULT_HOURLY_CAP }) {
  const ref = adminDb().collection(LOOKUP_CHECKS).doc(key)
  return adminDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    const data = snap.exists ? snap.data() : null
    let hourStart = Number(data && data.hourStart) || 0
    let hourCount = Number.isInteger(data && data.hourCount) ? data.hourCount : 0
    if (!hourStart || now - hourStart >= HOUR_MS) {
      hourStart = now
      hourCount = 0
    }
    if (hourCount >= hourlyCap) {
      return { allow: false, retryAfterSec: secondsUntil(hourStart + HOUR_MS, now) }
    }
    tx.set(ref, {
      hourStart,
      hourCount: hourCount + 1,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    return { allow: true, retryAfterSec: 0 }
  })
}
