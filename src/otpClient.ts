/**
 * One door to the phone-verification API (`api/otp/*`).
 *
 * A phone number is proved by *our* server texting a code and checking it came back — never by
 * asking a third party to sign the browser in. That matters twice over: only the server can write
 * `trust/{uid}` (the record the 🟢 badge reads, and the one a browser may not write), and the code
 * that sent the SMS never leaves the server. So every screen that verifies a number goes through
 * the two functions below, and no screen builds its own request.
 *
 * Two things here are deliberately boring, because they are the two ways this goes wrong:
 *
 *  - the *base URL* is empty in production — the site and the functions share a domain, so the call
 *    is relative (`/api/otp/send`) with no CORS and nothing to configure. On a laptop
 *    `VITE_OTP_SERVER_URL` points at `npm run otp` (`server/dev.js`), and `vite.config.ts` proxies
 *    the same relative path, so dev and production take the same route;
 *  - the code is submitted under the name `/api/otp/verify` actually reads (`code`, not `otp`), and
 *    that request shape lives in exactly one place — see the check in `_trust_check.cjs`.
 *
 * What never happens here: the code is never logged, never stored, never echoed back. The
 * responses are read by the two pure functions below, so a 500 with an HTML body, or a reply that
 * forgets its token, becomes a sentence a person can act on rather than a crash.
 */

/**
 * Where the API lives. Empty means "same domain" — the right answer everywhere except a laptop.
 */
const configured = String(import.meta.env.VITE_OTP_SERVER_URL || '').trim()
export const OTP_BASE = configured.replace(/\/+$/, '')

/** What `/api/otp/send` answers with. `expiresInSec` is the server's own five minutes. */
export type OtpSendResult = { ok: true; expiresInSec: number } | { ok: false; error: string }

/**
 * What `/api/otp/verify` answers with: a custom token to sign in as the account the number belongs
 * to, that account's uid, and the number the server itself proved (never the digits typed).
 */
export type OtpVerifyResult =
  | { ok: true; token: string; uid: string; phone: string; created: boolean }
  | { ok: false; error: string; reason?: string }

const NETWORK_ERROR = 'Network error. Check your connection and try again.'
const SEND_ERROR = 'We could not send that code. Please try again.'
const VERIFY_ERROR = 'We could not verify that code. Please try again.'

/** Pure: what a send response means. Exported so a harness can hand it any status and body. */
export function readSendResponse(status: number, data: unknown): OtpSendResult {
  const body = (data || {}) as { expiresInSec?: unknown; error?: unknown }
  if (status >= 200 && status < 300) {
    const seconds = Number(body.expiresInSec)
    return { ok: true, expiresInSec: Number.isFinite(seconds) && seconds > 0 ? seconds : 300 }
  }
  return { ok: false, error: typeof body.error === 'string' && body.error ? body.error : SEND_ERROR }
}

/** Pure: what a verify response means. A 200 without a token is still a failure, said out loud. */
export function readVerifyResponse(status: number, data: unknown): OtpVerifyResult {
  const body = (data || {}) as {
    token?: unknown; uid?: unknown; phone?: unknown; created?: unknown
    error?: unknown; reason?: unknown
  }
  if (status >= 200 && status < 300) {
    if (typeof body.token !== 'string' || !body.token) return { ok: false, error: VERIFY_ERROR }
    return {
      ok: true,
      token: body.token,
      uid: String(body.uid || ''),
      phone: String(body.phone || ''),
      created: body.created === true,
    }
  }
  return {
    ok: false,
    error: typeof body.error === 'string' && body.error ? body.error : VERIFY_ERROR,
    reason: typeof body.reason === 'string' ? body.reason : undefined,
  }
}

/** A response body, or nothing — a proxy's HTML error page must not become an exception. */
async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json()
  } catch {
    return null
  }
}

/**
 * POST /api/otp/send — "text me a code".
 *
 * No id token, on purpose: asking for a code is not being signed in, and the endpoint must work
 * for someone who has no account yet — that code is how their account gets made.
 */
export async function sendOtp(phone: string): Promise<OtpSendResult> {
  try {
    const res = await fetch(`${OTP_BASE}/api/otp/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone }),
    })
    return readSendResponse(res.status, await readJson(res))
  } catch (err) {
    console.warn('OTP send failed:', err)
    return { ok: false, error: NETWORK_ERROR }
  }
}

/**
 * POST /api/otp/verify — the code, answered with a sign-in token.
 *
 * With an `idToken`, the number is attached to the account already signed in (a social sign-up
 * finishing the wizard); without one, the number finds or makes its own account. Either way the
 * server writes `trust/{uid}` before it answers, so a success here means the badge is earned.
 */
export async function verifyOtp(
  phone: string,
  code: string,
  opts: { idToken?: string } = {},
): Promise<OtpVerifyResult> {
  try {
    const res = await fetch(`${OTP_BASE}/api/otp/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(opts.idToken ? { Authorization: `Bearer ${opts.idToken}` } : {}),
      },
      // `code` is the name `/api/otp/verify` reads (`field(body, 'code')`) — not `otp`, which is a
      // 400 every time and only shows up when a real person is waiting for a real text message.
      body: JSON.stringify({ phone, code }),
    })
    return readVerifyResponse(res.status, await readJson(res))
  } catch (err) {
    console.warn('OTP verify failed:', err)
    return { ok: false, error: NETWORK_ERROR }
  }
}
