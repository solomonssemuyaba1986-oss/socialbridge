/**
 * POST /api/otp/lookup — "does this number already belong to an account?"
 *
 * This exists because the phone door has two jobs that used to be one. `verify` finds an account
 * if there is one and *makes* one otherwise, so a person who meant "log me back in" and mistyped a
 * digit was quietly handed an empty second account. The client cannot tell those apart from a
 * token, and it must not be able to: the answer comes from `auth.getUserByPhoneNumber`, which only
 * the server can run.
 *
 * What it deliberately does **not** do:
 *
 *  - **it never signs anybody in.** A number is not proof of anything; it is a hint about which
 *    account to look for. The code is still texted and still typed, and `verify` is still the only
 *    thing that mints a token.
 *  - **it never says who.** No uid, no name, no email, no masked number -- `{ linked, shop }` and
 *    nothing else, so the answer cannot be turned into a directory.
 *  - **it never repeats the number**, in the body or in a log line, exactly like `send`.
 *
 * `shop` is for the case the market actually has: a number used as a shop's WhatsApp contact has
 * no account behind it, so "you are not on rachett" would be a lie. The client turns that into
 * "that number is on a shop, but the shop belongs to whoever owns it -- try Google".
 */
import { adminConfigured } from '../_lib/admin.js'
import { applyCors, fail, field, ok, readJsonBody } from '../_lib/http.js'
import { numberIsLinked, shopUsesNumber } from '../_lib/identity.js'
import { callerKey, lookupConfig, reserveLookup } from '../_lib/lookupGuard.js'
import { otpConfig } from '../_lib/otpStore.js'
import { validateIntl } from '../_lib/phone.js'

const NOT_READY = 'Phone verification is not switched on yet. Please try again a little later.'

/** Said for every refusal of the hourly cap, so the reply never reveals which number was asked about. */
const TOO_MANY = 'Too many checks from this connection. Try again a little later.'

export default async function handler(req, res) {
  applyCors(req, res)
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return }
  if (req.method !== 'POST') return fail(res, 405, 'This endpoint only accepts POST.')

  const body = await readJsonBody(req)
  if (!body) return fail(res, 400, 'Send a JSON body with your phone number.')

  // The same per-country rule the screen and `send` use: a number that could never receive a text
  // is not a number worth answering a question about.
  const check = validateIntl(field(body, 'phone'))
  if (!check.ok) return fail(res, 400, check.message)

  const otp = otpConfig()
  if (!otp.configured || !adminConfigured()) {
    console.error('[otp/lookup] refused: server secrets are not configured')
    return fail(res, 503, NOT_READY)
  }

  const cap = await reserveLookup({
    key: callerKey(req, otp.pepper),
    now: Date.now(),
    hourlyCap: lookupConfig().hourlyCap,
  })
  if (!cap.allow) return fail(res, 429, TOO_MANY, { retryAfterSec: cap.retryAfterSec })

  let linked = false
  let shop = false
  try {
    linked = await numberIsLinked(check.e164)
    // Only worth the read when there is no account: a linked number already answers the question.
    if (!linked) shop = await shopUsesNumber(check.e164)
  } catch (err) {
    // The client treats a failure as "could not check" and sends the code anyway, so a bad minute
    // here costs the check, never the sign-in.
    console.error('[otp/lookup] could not answer:', err && err.message)
    return fail(res, 500, 'We could not check that number just now. Try again in a moment.')
  }

  return ok(res, { linked, shop })
}
