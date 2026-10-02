/**
 * The one place an SMS leaves rachett.
 *
 * Yoola's send endpoint takes JSON — `{ api_key, phone, message }` — where `phone` is the number
 * in international form *without* the leading `+` ("256704487563"), which is the shape the
 * account's own working sample uses. `sender_id` is added only when one is configured.
 *
 * Two rules this file exists to keep:
 *
 *  1. The verification code appears in exactly one place in the whole system: the `message`
 *     string handed to `sendSms`. It is never logged, never returned in a response, never
 *     re-worded for a debug build. There is no `debugOtp` here, and `_otp_check.cjs` asserts the
 *     word does not occur anywhere under `api/`.
 *  2. A failure is reported as a failure. If the key is missing, the request times out, or Yoola
 *     answers with an error, the caller hears it — because a code that was never sent must never
 *     look like one that was. (That is the bug being fixed: the old dev server faked success and
 *     printed the code to the console.)
 */
export const DEFAULT_API_URL = 'https://yoolasms.com/api/v1/send_sms'
export const SMS_TIMEOUT_MS = 15_000

/** What lands on the phone. Short, one idea, and clear that we will never ask for it back. */
export function buildSmsText(code) {
  return `Your rachett code is ${code}. It expires in 5 minutes — do not share it with anyone.`
}

/** Yoola wants the number bare: "+256704487563" → "256704487563". */
export function yoolaPhone(e164) {
  return String(e164 || '').replace(/\D/g, '')
}

/** Reads the three secrets the sender needs, and says plainly which are absent. */
export function smsConfig(env = process.env) {
  const apiKey = String(env.YOOLA_API_KEY || '').trim()
  const apiUrl = String(env.YOOLA_API_URL || DEFAULT_API_URL).trim() || DEFAULT_API_URL
  const senderId = String(env.YOOLA_SENDER_ID || '').trim()
  const missing = []
  if (!apiKey) missing.push('YOOLA_API_KEY')
  return { configured: missing.length === 0, missing, apiKey, apiUrl, senderId }
}

/**
 * Reads Yoola's answer without trusting it to be the shape we expect.
 *
 * Providers differ on whether success is `{"status":"success"}`, `{"success":true}`, or simply a
 * 200 with anything; and on whether failure is an HTTP error or a polite 200. So both are read:
 * an HTTP status outside 2xx is a failure, and so is a 2xx whose body says so. An empty 2xx body
 * is treated as success — the SMS went; refusing it would cost the person another send.
 */
export function interpretSend(status, rawBody) {
  const text = typeof rawBody === 'string' ? rawBody : ''
  let body = null
  try { body = text ? JSON.parse(text) : null } catch { body = null }

  const saidError = Boolean(body) && typeof body === 'object' && (
    body.success === false
    || body.status === 'error' || body.status === 'failed' || body.status === 'fail'
    || (typeof body.error === 'string' && body.error.trim() !== '')
  )

  if (status >= 200 && status < 300 && !saidError) return { ok: true, status }

  const said = body && typeof body === 'object'
    ? body.error || body.message || body.detail || body.reason
    : ''
  const message = String(said || text.slice(0, 180) || '').trim()
  return { ok: false, status, message: message || `The SMS provider returned HTTP ${status}.` }
}

/**
 * Sends the code. Returns `{ ok: true }`, or `{ ok: false, failure, message }` where `failure` is a
 * stable slug the caller can act on (`not-configured` is refused *before* a request is made).
 *
 * Note the field is called `failure`, not `code`: in this file `code` means the verification code,
 * and the two must never be confusable at a glance. Nothing in any failure below carries the code —
 * every branch builds its text from constants and provider chatter only.
 */
export async function sendSms({ e164, code, config = smsConfig(), fetchImpl = fetch, timeoutMs = SMS_TIMEOUT_MS }) {
  if (!config.configured) {
    return {
      ok: false,
      failure: 'not-configured',
      message: `SMS is not switched on yet (missing ${config.missing.join(', ')}).`,
    }
  }

  const payload = { api_key: config.apiKey, phone: yoolaPhone(e164), message: buildSmsText(code) }
  if (config.senderId) payload.sender_id = config.senderId

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetchImpl(config.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    const text = await res.text().catch(() => '')
    const read = interpretSend(res.status, text)
    return read.ok ? { ok: true } : { ok: false, failure: 'provider', message: read.message }
  } catch (err) {
    const timedOut = Boolean(err) && err.name === 'AbortError'
    return {
      ok: false,
      failure: timedOut ? 'timeout' : 'network',
      message: timedOut
        ? 'The SMS provider did not answer in time. Please try again.'
        : 'Could not reach the SMS provider. Check your connection and try again.',
    }
  } finally {
    clearTimeout(timer)
  }
}
