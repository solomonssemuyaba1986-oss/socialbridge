/**
 * POST /api/contacts/match — "who in my phone book is already on rachett?"
 *
 * The request carries the numbers the person explicitly selected in their phone's contact picker.
 * The response carries only matched **public profiles**; the numbers are never stored, returned
 * or logged. The ledger they are checked against (`phones/{phoneKey}`) is already HMAC-keyed, so
 * this endpoint computes the same opaque key rather than keeping a second list of numbers.
 *
 * Three lines of defence sit in front of the lookup:
 *   1. a valid Firebase ID token, for an account that has proved a phone number;
 *   2. a per-account cooldown and daily ceiling (`contactLookups/{uid}`, closed to browsers);
 *   3. an upper bound on the batch, so one request cannot sweep the ledger.
 */
import { adminAuth, adminConfigured, adminDb } from '../_lib/admin.js'
import { applyCors, fail, field, ok, readJsonBody } from '../_lib/http.js'
import { uidFromIdToken } from '../_lib/identity.js'
import { otpConfig } from '../_lib/otpStore.js'
import {
  CONTACT_CONSENT_VERSION,
  CONTACT_LOOKUP_MESSAGES,
  MAX_CONTACTS,
  MAX_MATCHES,
  contactKeys,
  publicContactProfile,
} from '../_lib/contacts.js'
import { recordContactConsent, reserveContactLookup } from '../_lib/contactStore.js'

const NOT_READY = 'Friend discovery is not switched on yet. Please try again a little later.'
const PHONE_FIRST = 'Add and verify your phone number before finding friends.'
const LOOKUP_FAILED = 'We could not check those contacts just now. Please try again.'
const NO_AUTH = 'Please sign in again to find your friends.'

function bearerToken(req) {
  const header = String(req.headers?.authorization || '')
  const match = header.match(/^Bearer\s+(.+)$/i)
  return match ? match[1].trim() : ''
}

/** Reads documents in batches; 5,000 refs in one `getAll` is not a request worth making. */
async function snapshotsFor(collection, ids) {
  const db = adminDb()
  const out = []
  for (let i = 0; i < ids.length; i += 100) {
    const refs = ids.slice(i, i + 100).map(id => db.collection(collection).doc(id))
    if (!refs.length) continue
    const snaps = await db.getAll(...refs)
    for (const snap of snaps) out.push(snap)
  }
  return out
}

export default async function handler(req, res) {
  applyCors(req, res)
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return }
  if (req.method !== 'POST') return fail(res, 405, 'This endpoint only accepts POST.')

  const body = await readJsonBody(req)
  if (!body || !Array.isArray(body.phones)) {
    return fail(res, 400, 'Send a JSON body with a "phones" list.')
  }
  if (body.phones.length === 0) return fail(res, 400, 'No contacts were shared.')
  if (body.phones.length > MAX_CONTACTS) {
    return fail(res, 400, `Share up to ${MAX_CONTACTS.toLocaleString('en-US')} contacts at once.`)
  }

  const otp = otpConfig()
  if (!otp.configured || !adminConfigured()) {
    console.error('[contacts/match] refused: server secrets are not configured')
    return fail(res, 503, NOT_READY)
  }

  const uid = await uidFromIdToken(bearerToken(req))
  if (!uid) return fail(res, 401, NO_AUTH)

  // Contact discovery rests on a proved number. A Google-only account is asked to add one first,
  // which is also the account-strength step the product is built around.
  try {
    const caller = await adminAuth().getUser(uid)
    if (!caller.phoneNumber) return fail(res, 403, PHONE_FIRST)
  } catch {
    return fail(res, 401, NO_AUTH)
  }

  const contacts = contactKeys(body.phones, field(body, 'defaultDial'), otp.pepper)
  if (contacts.checked === 0) {
    return fail(res, 400, 'None of those contacts looked like phone numbers we can check.')
  }

  const booking = await reserveContactLookup({ uid })
  if (!booking.allow) {
    return fail(res, 429, CONTACT_LOOKUP_MESSAGES[booking.reason] || CONTACT_LOOKUP_MESSAGES.hourly, {
      retryAfterSec: booking.retryAfterSec,
    })
  }

  try {
    const ledger = await snapshotsFor('phones', contacts.keys)
    const holderUids = [...new Set(
      ledger
        .filter(snap => snap.exists)
        .map(snap => String(snap.data().uid || ''))
        .filter(matchedUid => matchedUid && matchedUid !== uid),
    )].slice(0, MAX_MATCHES)

    if (holderUids.length === 0) {
      await recordContactConsent({ uid, matched: 0, version: CONTACT_CONSENT_VERSION })
      return ok(res, { matched: [], checked: contacts.checked })
    }

    const [users, sellers] = await Promise.all([
      snapshotsFor('users', holderUids),
      snapshotsFor('sellers', holderUids),
    ])
    const userById = new Map(users.filter(snap => snap.exists).map(snap => [snap.id, snap.data()]))
    const sellerById = new Map(sellers.filter(snap => snap.exists).map(snap => [snap.id, snap.data()]))

    const matched = holderUids
      .map(matchedUid => publicContactProfile(matchedUid, userById.get(matchedUid), sellerById.get(matchedUid)))
      .sort((a, b) => {
        if (Boolean(a.slug) !== Boolean(b.slug)) return a.slug ? -1 : 1
        return a.name.localeCompare(b.name)
      })

    await recordContactConsent({ uid, matched: matched.length, version: CONTACT_CONSENT_VERSION })
    return ok(res, { matched, checked: contacts.checked })
  } catch (err) {
    console.error('[contacts/match] lookup failed:', err && err.message)
    return fail(res, 502, LOOKUP_FAILED)
  }
}
