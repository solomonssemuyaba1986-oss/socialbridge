/**
 * POST /api/payout/methods — the only writer of a seller's verified payout numbers.
 *
 * Two actions, both requiring the seller's own Firebase ID token:
 *
 *   { action: 'verify', method, phone, code }
 *       Checks the code that `/api/otp/send` texted to that number, then saves it to
 *       `payoutAccounts/{uid}` (owner-read, server-write) and turns the rail on. The public
 *       `sellers/{uid}` document gets `enabled/verified` only — never the number.
 *
 *   { action: 'save', mtn, airtel }
 *       Saves which verified rails are switched on. A rail with no proved number cannot be
 *       turned on: the refusal names it, and nothing reaches Firestore.
 *
 * Why a separate endpoint instead of `/api/otp/verify`: that endpoint's job is to attach a
 * number to a *sign-in account* and mint a token. A payout number is not necessarily the
 * account's phone (a second wallet, a shop's till), should not change how anybody signs in, and
 * must never be claimed away from whoever already owns it. So this endpoint consumes the same
 * one-time code (`consume`) but deliberately stops there — no `claimNumber`, no custom token.
 *
 * The code is checked and destroyed in one transaction by `consume`. The two writes that follow
 * are one transaction of their own, so a seller can never end up with a rail marked verified on
 * the public document while the private ledger disagrees.
 */
import { FieldValue, adminConfigured, adminDb } from '../_lib/admin.js'
import { applyCors, fail, field, ok, readJsonBody } from '../_lib/http.js'
import { uidFromIdToken } from '../_lib/identity.js'
import { VERIFY_MESSAGES, isCodeFormat, readCode } from '../_lib/otp.js'
import { consume, otpConfig } from '../_lib/otpStore.js'
import {
  flagsFrom,
  isPayoutMethod,
  methodsMissingProof,
  missingProofMessage,
  publicRailPatch,
  verifiedEntry,
} from '../_lib/payout.js'
import { validateIntl } from '../_lib/phone.js'

const NOT_READY = 'Payout verification is not switched on yet. Please try again a little later.'
const NOT_SELLER = 'Finish setting up your shop before adding a payout number.'
const SIGN_IN_AGAIN = 'Sign in again to verify a payout number.'

const PAYOUTS = 'payoutAccounts'

/** The caller's own ID token. Payout numbers belong to an account, so this is never optional. */
function bearerToken(req) {
  const header = String(req.headers?.authorization || '')
  const match = header.match(/^Bearer\s+(.+)$/i)
  return match ? match[1].trim() : ''
}

/** The public flags for a seller document, preserving old fields but never keeping a number. */
function nextRailState(existing, updates) {
  const methods = existing && typeof existing === 'object' ? { ...existing } : {}
  for (const [method, patch] of Object.entries(updates)) {
    methods[method] = { ...(methods[method] || {}), ...patch }
  }
  // An old browser-era copy may still carry numbers here. They are not proof and they are PII,
  // so the next server write removes every one of them, not only the rail being changed.
  for (const method of ['mtn', 'airtel', 'card']) {
    if (methods[method] && typeof methods[method] === 'object') delete methods[method].number
  }
  return methods
}

async function saveFlags(res, sellerRef, uid, body) {
  const flags = flagsFrom(body)
  const accountRef = adminDb().collection(PAYOUTS).doc(uid)

  const outcome = await adminDb().runTransaction(async (tx) => {
    const sellerSnap = await tx.get(sellerRef)
    if (!sellerSnap.exists) return { reason: 'not-seller' }

    const accountSnap = await tx.get(accountRef)
    const missing = methodsMissingProof(flags, accountSnap.exists ? accountSnap.data() : null)
    if (missing.length) return { reason: 'unverified', missing }

    const existing = sellerSnap.data()?.paymentMethods
    const next = nextRailState(existing, {
      mtn: { enabled: flags.mtn },
      airtel: { enabled: flags.airtel },
      card: { enabled: false },
    })
    tx.set(sellerRef, {
      paymentMethods: next,
      paymentMethodsUpdatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    return { ok: true }
  })

  if (outcome.reason === 'not-seller') return fail(res, 403, NOT_SELLER)
  if (outcome.reason === 'unverified') {
    return fail(res, 409, missingProofMessage(outcome.missing), {
      reason: 'unverified',
      methods: outcome.missing,
    })
  }
  return ok(res, { enabled: flags })
}

async function verifyAndSave(res, sellerRef, uid, body) {
  const method = field(body, 'method')
  if (!isPayoutMethod(method)) {
    return fail(res, 400, 'Choose MTN MoMo or Airtel Money before sending a code.')
  }

  const check = validateIntl(field(body, 'phone'))
  if (!check.ok) return fail(res, 400, check.message)

  const raw = field(body, 'code')
  if (!isCodeFormat(raw)) return fail(res, 400, 'Enter the 6-digit code from your text message.')

  const otp = otpConfig()
  if (!otp.configured) {
    console.error('[payout/verify] refused: OTP_PEPPER is not configured')
    return fail(res, 503, NOT_READY)
  }

  // One code, one use — the same transaction that decides also destroys it. The number is not
  // attached to a sign-in account here; it is only proved to belong to whoever can read its SMS.
  const result = await consume({
    e164: check.e164,
    submitted: readCode(raw),
    now: Date.now(),
    pepper: otp.pepper,
  })
  if (!result.ok) {
    return fail(res, 400, VERIFY_MESSAGES[result.reason] || VERIFY_MESSAGES.mismatch, {
      reason: result.reason,
    })
  }

  const now = Date.now()
  const accountRef = adminDb().collection(PAYOUTS).doc(uid)
  const outcome = await adminDb().runTransaction(async (tx) => {
    const sellerSnap = await tx.get(sellerRef)
    if (!sellerSnap.exists) return { reason: 'not-seller' }

    const existing = sellerSnap.data()?.paymentMethods
    const next = nextRailState(existing, { [method]: publicRailPatch(now) })
    tx.set(accountRef, {
      [method]: verifiedEntry(check.e164, now),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    tx.set(sellerRef, {
      paymentMethods: next,
      paymentMethodsUpdatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    return { ok: true }
  })

  if (outcome.reason === 'not-seller') return fail(res, 403, NOT_SELLER)
  return ok(res, { method, phone: check.e164, verifiedAt: now })
}

export default async function handler(req, res) {
  applyCors(req, res)
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return }
  if (req.method !== 'POST') return fail(res, 405, 'This endpoint only accepts POST.')

  if (!adminConfigured()) {
    console.error('[payout/methods] refused: Firebase service account is not configured')
    return fail(res, 503, NOT_READY)
  }

  const body = await readJsonBody(req)
  if (!body) return fail(res, 400, 'Send a JSON body with the action and its details.')

  const uid = await uidFromIdToken(bearerToken(req))
  if (!uid) return fail(res, 401, SIGN_IN_AGAIN)

  const sellerRef = adminDb().collection('sellers').doc(uid)
  try {
    // Checked before a code is consumed: an account with no shop has nothing to pay out.
    const sellerSnap = await sellerRef.get()
    if (!sellerSnap.exists) return fail(res, 403, NOT_SELLER)

    const action = field(body, 'action')
    if (action === 'verify') return await verifyAndSave(res, sellerRef, uid, body)
    if (action === 'save') return await saveFlags(res, sellerRef, uid, body)
    return fail(res, 400, 'Choose whether to verify a number or save your payout settings.')
  } catch (err) {
    // Never log the body: it can hold a phone number and a live code.
    console.error('[payout/methods] failed:', err && err.message)
    return fail(res, 500, 'We could not save your payout number. Please try again.')
  }
}
