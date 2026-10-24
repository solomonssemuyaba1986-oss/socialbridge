/**
 * The Firestore side of a contact lookup.
 *
 * `contactLookups/{uid}` is closed to every browser. It holds the per-account counters only —
 * no numbers, no names, no results. The consent marker is written onto the person's own
 * `users/{uid}` document after a successful check, because that is where the app already reads
 * its account facts and where the person can see them.
 */
import { FieldValue, adminDb } from './admin.js'
import { CONTACT_LIMITS, decideContactLookup } from './contacts.js'

export const CONTACT_LOOKUPS = 'contactLookups'

/** Books one lookup against the account's rails. Decisions come from `decideContactLookup`. */
export async function reserveContactLookup({ uid, now = Date.now(), limits = CONTACT_LIMITS }) {
  const ref = adminDb().collection(CONTACT_LOOKUPS).doc(uid)
  return adminDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    const decision = decideContactLookup(snap.exists ? snap.data() : null, now, limits)
    if (!decision.allow) {
      return { allow: false, reason: decision.reason, retryAfterSec: decision.retryAfterSec }
    }
    tx.set(ref, {
      ...decision.next,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    return { allow: true, reason: 'ok', retryAfterSec: 0 }
  })
}

/** Records that the person chose to share contacts, and how many friends were found. */
export async function recordContactConsent({ uid, matched, version, now = Date.now() }) {
  await adminDb().collection('users').doc(uid).set({
    contactsConsentAt: now,
    contactsConsentVersion: version,
    contactsMatchedAt: now,
    contactsMatchedCount: Math.max(0, Math.trunc(Number(matched) || 0)),
    contactsAskedAt: now,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })
}
