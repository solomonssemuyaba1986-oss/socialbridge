/**
 * The one place an SMS leaves rachett.
 *
 * Two rails, chosen by the destination's dial code:
 *
 *   - Yoola (`yoolasms.com`) for Uganda, Kenya, Tanzania, Rwanda, Malawi and Zambia;
 *   - eSMS Africa (`sms.esmsafrica.io`) for every other country — all 54 African countries,
 *     plus the rest of the world once eSMS has enabled that destination for the account.
 *
 * The providers disagree about almost everything. Yoola takes
 * `{ api_key, phone, message }` with the number bare ("256704487563"). eSMS takes
 * `{ to, text, sender_id? }` with E.164 ("+256704487563") and a Bearer key. The request builders
 * below keep that disagreement here, so callers only ever say "send this code to this number".
 *
 * Two rules this file exists to keep:
 *
 *  1. The verification code appears in exactly one place in the whole system: the text handed to
 *     the provider. It is never logged, never returned in a response, never re-worded for a debug
 *     build. There is no `debugOtp` here, and `_otp_check.cjs` asserts the word does not occur
 *     anywhere under `api/`.
 *  2. A failure is reported as a failure. If the key is missing, the request times out, or the
 *     provider answers with an error, the caller hears it — because a code that was never sent
 *     must never look like one that was. (That is the bug being fixed: the old dev server faked
 *     success and printed the code to the console.)
 */
import { randomUUID } from 'node:crypto'

export const YOOLA_API_URL = 'https://yoolasms.com/api/v1/send_sms'
export const ESMS_API_URL = 'https://sms.esmsafrica.io/api/messages/send'
export const SMS_TIMEOUT_MS = 15_000

/**
 * The six countries Yoola carries. Everything else goes to eSMS Africa, whose routes auto-detect
 * the destination from the E.164 number.
 *
 * Dial codes, not country names: `validateIntl` already resolved the longest matching code, and a
 * second name-to-code table is just another thing that can disagree with the first.
 */
export const YOOLA_DIALS = ['+256', '+254', '+255', '+250', '+265', '+260']
const YOOLA_SET = new Set(YOOLA_DIALS)

/**
 * Which rail carries this number. `dial` is the value `validateIntl` already worked out, so this
 * file never re-parses a phone number or invents a second country table.
 */
export function providerForDial(dial) {
  return YOOLA_SET.has(String(dial || '').trim()) ? 'yoola' : 'esms'
}

/** What lands on the phone. Short, one idea, and clear that we will never ask for it back. */
export function buildSmsText(code) {
  return `Your rachett code is ${code}. It expires in 5 minutes — do not share it with anyone.`
}

/** Yoola wants the number bare: "+256704487563" → "256704487563". */
export function yoolaPhone(e164) {
  return String(e164 || '').replace(/\D/g, '')
}

/** eSMS wants E.164: the plus is part of the contract, not decoration. */
export function esmsPhone(e164) {
  const digits = String(e164 || '').replace(/\D/g, '')
  return digits ? `+${digits}` : ''
}

/** Reads the secrets Yoola needs, and says plainly which are absent. */
export function yoolaConfig(env = process.env) {
  const apiKey = String(env.YOOLA_API_KEY || '').trim()
  const apiUrl = String(env.YOOLA_API_URL || YOOLA_API_URL).trim() || YOOLA_API_URL
  const senderId = String(env.YOOLA_SENDER_ID || '').trim()
  const missing = []
  if (!apiKey) missing.push('YOOLA_API_KEY')
  return { configured: missing.length === 0, missing, apiKey, apiUrl, senderId }
}

/** Reads the secrets eSMS Africa needs, and says plainly which are absent. */
export function esmsConfig(env = process.env) {
  const apiKey = String(env.ESMS_API_KEY || '').trim()
  const apiUrl = String(env.ESMS_API_URL || ESMS_API_URL).trim() || ESMS_API_URL
  const senderId = String(env.ESMS_SENDER_ID || '').trim()
  const missing = []
  if (!apiKey) missing.push('ESMS_API_KEY')
  return { configured: missing.length === 0, missing, apiKey, apiUrl, senderId }
}

/**
 * Both rails in one object.
 *
 * `configured` means *at least one* rail is usable. The per-number decision is `smsForDial`,
 * because a missing eSMS key must not stop a Ugandan code (or the reverse). The send handler
 * asks the chosen rail, not this summary, whether it is ready.
 */
export function smsConfig(env = process.env) {
  const yoola = yoolaConfig(env)
  const esms = esmsConfig(env)
  const missing = []
  if (!yoola.configured) missing.push(...yoola.missing)
  if (!esms.configured) missing.push(...esms.missing)
  return { configured: yoola.configured || esms.configured, missing, yoola, esms }
}

/** The rail and the secrets it needs for one destination. */
export function smsForDial(dial, sms = smsConfig()) {
  const provider = providerForDial(dial)
  return {
    provider,
    config: sms[provider] || {
      configured: false,
      missing: [provider === 'yoola' ? 'YOOLA_API_KEY' : 'ESMS_API_KEY'],
    },
  }
}

/**
 * Reads either provider's answer without trusting it to be the shape we expect.
 *
 * Providers differ on whether success is `{"status":"success"}`, `{"id":…,"status":"submitted"}`,
 * or simply a 200 with anything; and on whether failure is an HTTP error or a polite 200. So both
 * are read: an HTTP status outside 2xx is a failure, and so is a 2xx whose body says so. An empty
 * 2xx body is treated as success — the SMS went; refusing it would cost the person another send.
 *
 * eSMS's error envelope is nested (`{ error: { code, message } }`); Yoola's is flat
 * (`{ error: "…" }`). Both are unwrapped here so a person never sees `[object Object]`.
 */
export function interpretSend(status, rawBody) {
  const text = typeof rawBody === 'string' ? rawBody : ''
  let body = null
  try { body = text ? JSON.parse(text) : null } catch { body = null }

  // Only strings survive this. A nested object must never become "[object Object]" in a message a
  // person reads (or in a log line).
  const firstText = (...values) => {
    for (const value of values) {
      if (typeof value === 'string' && value.trim()) return value.trim()
    }
    return ''
  }

  const error = body && typeof body === 'object' ? body.error : null
  const nestedError = error && typeof error === 'object' ? firstText(error.message, error.code) : ''
  const directError = error && typeof error === 'string' ? error.trim() : ''

  const saidError = Boolean(body) && typeof body === 'object' && (
    body.success === false
    || body.status === 'error' || body.status === 'failed' || body.status === 'fail'
    || directError !== ''
    || nestedError !== ''
  )

  if (status >= 200 && status < 300 && !saidError) return { ok: true, status }

  const detail = body && typeof body === 'object' ? body.detail : null
  const detailMessage = detail && typeof detail === 'object'
    ? firstText(detail.message, detail.code)
    : typeof detail === 'string' ? detail.trim() : ''
  const said = nestedError || directError || detailMessage
    || (body && typeof body === 'object' ? firstText(body.message, body.reason, body.code) : '')
  const message = String(said || text.slice(0, 180) || '').trim()
  return { ok: false, status, message: message || `The SMS provider returned HTTP ${status}.` }
}

/** The exact request Yoola's send endpoint expects. */
export function buildYoolaRequest({ e164, code, config }) {
  const payload = { api_key: config.apiKey, phone: yoolaPhone(e164), message: buildSmsText(code) }
  if (config.senderId) payload.sender_id = config.senderId
  return {
    url: config.apiUrl,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  }
}

/**
 * The exact request eSMS Africa's send endpoint expects.
 *
 * `Idempotency-Key` is the provider's own guard against a retried POST charging twice. It is
 * generated here, and only here, because this is the only place a send is attempted.
 */
export function buildEsmsRequest({ e164, code, config, idempotencyKey = randomUUID() }) {
  const payload = { to: esmsPhone(e164), text: buildSmsText(code) }
  if (config.senderId) payload.sender_id = config.senderId
  return {
    url: config.apiUrl,
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(payload),
  }
}

/**
 * Provider chatter must never become a second copy of the code.
 *
 * A validation error is allowed to quote the request, and the request is the SMS text. If any
 * provider ever does, the code is replaced before the caller can log it or return it.
 */
function withoutCode(message, code) {
  const text = String(message || '')
  return code ? text.split(String(code)).join('[code]') : text
}

/**
 * Sends the code down the rail that carries this dial code. Returns `{ ok: true, provider }`, or
 * `{ ok: false, provider, failure, message }` where `failure` is a stable slug the caller can act
 * on (`not-configured` is refused *before* a request is made).
 *
 * Note the field is called `failure`, not `code`: in this file `code` means the verification code,
 * and the two must never be confusable at a glance. Nothing in any failure below carries the code —
 * every branch builds its text from constants and provider chatter only.
 */
export async function sendSms({
  e164,
  dial,
  code,
  config = smsConfig(),
  fetchImpl = fetch,
  timeoutMs = SMS_TIMEOUT_MS,
  idempotencyKey,
}) {
  const provider = providerForDial(dial)
  const chosen = config[provider]

  if (!chosen || !chosen.configured) {
    return {
      ok: false,
      provider,
      failure: 'not-configured',
      message: `SMS is not switched on for this country yet (missing ${chosen?.missing?.join(', ') || 'SMS provider'}).`,
    }
  }

  const request = provider === 'yoola'
    ? buildYoolaRequest({ e164, code, config: chosen })
    : buildEsmsRequest({ e164, code, config: chosen, idempotencyKey })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetchImpl(request.url, {
      method: 'POST',
      headers: request.headers,
      body: request.body,
      signal: controller.signal,
    })
    const text = await res.text().catch(() => '')
    const read = interpretSend(res.status, text)
    return read.ok
      ? { ok: true, provider }
      : { ok: false, provider, failure: 'provider', message: withoutCode(read.message, code) }
  } catch (err) {
    const timedOut = Boolean(err) && err.name === 'AbortError'
    return {
      ok: false,
      provider,
      failure: timedOut ? 'timeout' : 'network',
      message: timedOut
        ? 'The SMS provider did not answer in time. Please try again.'
        : 'Could not reach the SMS provider. Check your connection and try again.',
    }
  } finally {
    clearTimeout(timer)
  }
}
