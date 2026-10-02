/**
 * POST /api/otp/send — "text me a code".
 *
 * The order of the checks is the whole design: validate the number, then refuse outright if the
 * server is not properly configured, then book the send against the counters, and only *then*
 * talk to the SMS provider. Nothing here ever returns, logs, or stores the code in the clear —
 * see `_lib/sms.js` for why that is worth stating twice.
 *
 * The old dev server's worst line lived exactly here: when the key was missing it returned
 * `{ success: true, debugOtp: "123456" }` and printed the code to the console
 * (`server/index.js:99-104`). This handler refuses instead, so a misconfigured deployment is
 * loudly broken rather than quietly forgeable.
 */
import { adminConfigured } from '../_lib/admin.js'
import { applyCors, fail, field, ok, readJsonBody } from '../_lib/http.js'
import { validateIntl } from '../_lib/phone.js'
import { CODE_TTL_MS, SEND_MESSAGES, generateCode } from '../_lib/otp.js'
import { otpConfig, releaseGlobal, releaseStamp, reserveAndStamp, reserveGlobal } from '../_lib/otpStore.js'
import { sendSms, smsConfig } from '../_lib/sms.js'

/** What a person sees when we simply are not switched on. Deliberately uninformative. */
const NOT_READY = 'Phone verification is not switched on yet. Please try again a little later.'

export default async function handler(req, res) {
  applyCors(req, res)
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return }
  if (req.method !== 'POST') return fail(res, 405, 'This endpoint only accepts POST.')

  const body = await readJsonBody(req)
  if (!body) return fail(res, 400, 'Send a JSON body with your phone number.')

  // The same per-country rule the screen used, so a number that could never receive an SMS is
  // stopped before it costs a credit. Never echo the number back in an error.
  const check = validateIntl(field(body, 'phone'))
  if (!check.ok) return fail(res, 400, check.message)

  const sms = smsConfig()
  const otp = otpConfig()
  const ready = sms.configured && otp.configured && adminConfigured()
  if (!ready) {
    console.error(
      '[otp/send] refused: not configured —',
      'sms:', sms.missing.join(',') || 'ok',
      '| otp:', otp.missing.join(',') || 'ok',
      '| firebase:', adminConfigured() ? 'ok' : 'missing service account',
    )
    return fail(res, 503, NOT_READY)
  }

  const now = Date.now()

  // The deployment-wide ceiling first, so a busy day cannot be spent entirely by one number.
  const daily = await reserveGlobal({ now, cap: otp.dailyCap })
  if (!daily.allow) return fail(res, 429, SEND_MESSAGES.global, { retryAfterSec: daily.retryAfterSec })

  const code = generateCode()
  const booking = await reserveAndStamp({ e164: check.e164, code, now, pepper: otp.pepper })
  if (!booking.allow) {
    // We took a slot from the day but will not spend it.
    await releaseGlobal()
    return fail(res, 429, SEND_MESSAGES[booking.reason] || SEND_MESSAGES.hourly, {
      retryAfterSec: booking.retryAfterSec,
    })
  }

  const sent = await sendSms({ e164: check.e164, code, config: sms })
  if (!sent.ok) {
    // Hand the booking back: a provider outage must not spend the person's allowance.
    await releaseStamp({ e164: check.e164, now: Date.now(), pepper: otp.pepper })
    await releaseGlobal()
    console.error('[otp/send] provider failure:', sent.failure, '-', sent.message)
    return fail(res, sent.failure === 'not-configured' ? 503 : 502, sent.message)
  }

  return ok(res, { sent: true, expiresInSec: Math.round(CODE_TTL_MS / 1000) })
}
