/**
 * Turning a *proved* number into an account the client can sign in as.
 *
 * This is the piece that makes the 🟢 badge honest. Before, the browser asked Firebase to send
 * the SMS and then wrote `phoneVerified: true` onto its own seller document — a value anyone
 * could write by hand. Now the only code that ever sets a user's `phoneNumber`, the only code that
 * ever mints a sign-in token, and the only code that ever writes `trust/{uid}` runs *here*, on a
 * machine the seller does not control, and only after a code that was texted to the number came
 * back correct.
 *
 * Two collections, both closed to the browser:
 *
 *   phones/{phoneKey}  { uid, verifiedAt } — the ledger that keeps one number to one account.
 *                      The key is an HMAC of the number, so this holds no readable number.
 *   trust/{uid}        { phoneProven, phoneProvenAt, method } — read by the badge, and by anyone
 *                      (a store page is public), which is exactly why it must hold no number.
 *
 * Firebase Auth is the real authority on uniqueness — every branch below leans on it rather than
 * on our own bookkeeping, and the ledger is the cheap second guard that never needs an auth scan.
 */
import { FieldValue, adminAuth, adminDb } from './admin.js'
import { phoneKey } from './otp.js'

export const PHONES = 'phones'
export const TRUST = 'trust'

/** `auth/...` error codes, the only part of an admin error worth branching on. */
function codeOf(err) {
  return String((err && err.code) || '')
}

/**
 * The uid behind a browser ID token, or '' when there is none or it is not ours.
 */
export async function uidFromIdToken(idToken) {
  if (!idToken) return ''
  try {
    const decoded = await adminAuth().verifyIdToken(idToken)
    return String(decoded.uid || '')
  } catch {
    // Expired, forged, or for another project. Whoever they are, they sign in fresh below.
    return ''
  }
}

/**
 * Claims the number for an account, creating that account when there is nobody to attach it to.
 *
 *  - Signed in (a social account finishing the wizard): the number is attached to *that* account,
 *    so the shop stays under the account they chose. If it already belongs to someone else, the
 *    request is refused rather than quietly switching who they are.
 *  - Signed out: the number finds its account if one exists, or a new account is made for it.
 *    Either way they proved the number by receiving the code, so signing in as its owner is the
 *    whole point of the flow — not a shortcut past it.
 *
 * A brand-new account is rolled back if the ledger then disagrees, so a race can never leave an
 * orphaned account sitting on a number.
 */
export async function claimNumber({ e164, uid: signedInUid = '', now = Date.now(), pepper }) {
  const auth = adminAuth()
  let uid = String(signedInUid || '')
  let created = false

  if (uid) {
    const user = await auth.getUser(uid)
    const current = String(user.phoneNumber || '')
    if (current && current !== e164) return { ok: false, reason: 'different-number' }
    if (current !== e164) {
      try {
        await auth.updateUser(uid, { phoneNumber: e164 })
      } catch (err) {
        return { ok: false, reason: codeOf(err) === 'auth/phone-number-already-exists' ? 'taken' : 'auth-failed' }
      }
    }
  } else {
    const existing = await auth.getUserByPhoneNumber(e164).catch((err) => {
      if (codeOf(err) === 'auth/user-not-found') return null
      throw err
    })
    if (existing) {
      uid = existing.uid
    } else {
      try {
        const user = await auth.createUser({ phoneNumber: e164 })
        uid = user.uid
        created = true
      } catch (err) {
        return { ok: false, reason: codeOf(err) === 'auth/phone-number-already-exists' ? 'taken' : 'auth-failed' }
      }
    }
  }

  const ref = adminDb().collection(PHONES).doc(phoneKey(e164, pepper))
  const conflict = await adminDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    const holder = snap.exists ? String(snap.data().uid || '') : ''
    if (holder && holder !== uid) return true
    tx.set(ref, { uid, verifiedAt: now, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    return false
  })

  if (conflict) {
    if (created) {
      try { await auth.deleteUser(uid) } catch { /* the orphan is inert without the ledger */ }
    }
    return { ok: false, reason: 'taken' }
  }

  // What the badge reads. Note what is *not* here: no number, ever — this document is public.
  await adminDb().collection(TRUST).doc(uid).set({
    phoneProven: true,
    phoneProvenAt: now,
    method: signedInUid ? 'social-link' : 'phone-signup',
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })

  return { ok: true, uid, created }
}

/** The token the browser exchanges for a session. After this, `currentUser.phoneNumber` is set. */
export function customTokenFor(uid) {
  return adminAuth().createCustomToken(uid)
}
