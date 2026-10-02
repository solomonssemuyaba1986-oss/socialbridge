/**
 * POST /api/otp/verify — "here is the code", answered with a sign-in token.
 *
 * This is the end of the line for the forgeable badge. The code is checked and destroyed in one
 * transaction, and only then does `identity.js` attach the number to an account and mint a custom
 * token. Because the number is set by the *server*, `auth.currentUser.phoneNumber` can no longer
 * be a lie the browser told about itself — and it is that value the wizard's gate already trusts.
 *
 * An optional `Authorization: Bearer <Firebase ID token>` decides the one branch that matters:
 * with it, the number is attached to the account already signed in (a social sign-up finishing the
 * wizard); without it, the number finds or makes its own account.
 */
import { adminConfigured } from '../_lib/admin.js'
import { applyCors, fail, field, ok, readJsonBody } from '../_lib/http.js'
import { VERIFY_MESSAGES, isCodeFormat, readCode } from '../_lib/otp.js'
import { consume, otpConfig } from '../_lib/otpStore.js'
import { claimNumber, customTokenFor, uidFromIdToken } from '../_lib/identity.js'
import { validateIntl } from '../_lib/phone.js'

const NOT_READY = 'Phone verification is not switched on yet. Please try again a little later.'

/** Why the number could not be attached — in words a person can act on. */
const CLAIM_ERRORS = {
  taken: {
    status: 409,
    error: 'That number already belongs to a rachett account. Sign in with it instead, or verify a different number.',
  },
  'different-number': {
    status: 409,
    error: 'This account is already verified with a different number. Keep that one, or use a different account.',
  },
  'auth-failed': {
    status: 500,
    error: 'We could not finish verifying that number. Please try again.',
  },
}

/** The caller's own ID token, when they are already signed in and linking a number. */
function bearerToken(req) {
  const header = String(req.headers?.authorization || '')
  const match = header.match(/^Bearer\s+(.+)$/i)
  return match ? match[1].trim() : ''
}

export default async function handler(req, res) {
  applyCors(req, res)
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return }
  if (req.method !== 'POST') return fail(res, 405, 'This endpoint only accepts POST.')

  const body = await readJsonBody(req)
  if (!body) return fail(res, 400, 'Send a JSON body with your phone number and the code.')

  const check = validateIntl(field(body, 'phone'))
  if (!check.ok) return fail(res, 400, check.message)

  const raw = field(body, 'code')
  if (!isCodeFormat(raw)) return fail(res, 400, 'Enter the 6-digit code from your text message.')

  const otp = otpConfig()
  if (!otp.configured || !adminConfigured()) {
    console.error('[otp/verify] refused: server secrets are not configured')
    return fail(res, 503, NOT_READY)
  }

  // Checked and destroyed together. A wrong code here has already incremented its attempt count;
  // a right one is gone before this line returns, so it can never be replayed.
  const result = await consume({
    e164: check.e164,
    submitted: readCode(raw),
    now: Date.now(),
    pepper: otp.pepper,
  })
  if (!result.ok) {
    return fail(res, 400, VERIFY_MESSAGES[result.reason] || VERIFY_MESSAGES.mismatch, { reason: result.reason })
  }

  const signedInUid = await uidFromIdToken(bearerToken(req))
  const claim = await claimNumber({ e164: check.e164, uid: signedInUid, pepper: otp.pepper })
  if (!claim.ok) {
    const mapped = CLAIM_ERRORS[claim.reason] || CLAIM_ERRORS['auth-failed']
    return fail(res, mapped.status, mapped.error, { reason: claim.reason })
  }

  const token = await customTokenFor(claim.uid)
  return ok(res, { token, uid: claim.uid, phone: check.e164, created: claim.created })
}
