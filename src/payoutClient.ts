/**
 * The payout-number client — the one place the Payouts page talks to `/api/payout/methods`.
 *
 * Sending the code goes through `src/otpClient.ts` (`sendOtp`), because it is the same SMS rail,
 * the same counters and the same five-minute code as every other phone proof in the app. This
 * file only wraps the two *payout* actions, which need the signed-in seller's ID token:
 *
 *   verifyPayoutNumber(...) → { action: 'verify', method, phone, code }
 *   savePayoutMethods(...)  → { action: 'save', mtn, airtel }
 *   activatePayoutNumber(...) → { action: 'activate', method, numberId }
 *
 * A rail holds up to two proved numbers (a shop till and a personal wallet). The endpoint derives
 * each number's id from the rail and the number, so `verify` needs no new field: proving a number
 * is all it ever was, and the second one simply joins the first. Which of the two is live is
 * chosen with `activate`.
 *
 * The response readers are pure, so a 500 with an HTML body — or a reply that forgets to say
 * what it saved — becomes a sentence a seller can act on rather than a crash. No number or code
 * is ever logged here.
 */
import { OTP_BASE } from './otpClient'

export type PayoutMethod = 'mtn' | 'airtel'

export type PayoutVerifyResult =
  | { ok: true; phone: string; method: PayoutMethod; verifiedAt: number }
  | { ok: false; error: string; reason?: string }

export type PayoutSaveResult =
  | { ok: true; enabled: Record<PayoutMethod, boolean> }
  | { ok: false; error: string; reason?: string }

const NETWORK_ERROR = 'Network error. Check your connection and try again.'
const VERIFY_ERROR = 'We could not verify that payout number. Please try again.'
const SAVE_ERROR = 'We could not save your payout settings. Please try again.'
const ACTIVATE_ERROR = 'We could not make that number live. Please try again.'

/** One proved number, as the private ledger holds it. */
export type PayoutNumber = {
  id: string
  method: PayoutMethod
  number: string
  verifiedAt: number
}

export type PayoutLedger = {
  numbers: PayoutNumber[]
  active: Partial<Record<PayoutMethod, string>>
}

export type PayoutActivateResult =
  | { ok: true; method: PayoutMethod; activeId: string; phone: string }
  | { ok: false; error: string; reason?: string }

/**
 * Pure: the private ledger, in the shape a screen wants.
 *
 * The document is server-written, so this only tidies: the `numbers` map becomes a list (oldest
 * proof first) and `active` keeps the ids that still point at one of them. A document from the
 * one-number era has no `numbers` map at all; its `mtn`/`airtel` entries are folded in, so a
 * seller who verified before today sees their number rather than an empty page.
 */
export function readPayoutLedger(data: unknown): PayoutLedger {
  const doc = (data || {}) as {
    numbers?: Record<string, { method?: unknown; number?: unknown; verifiedAt?: unknown }>
    active?: Record<string, unknown>
    mtn?: { number?: unknown; verifiedAt?: unknown }
    airtel?: { number?: unknown; verifiedAt?: unknown }
  }
  const numbers: PayoutNumber[] = []
  const seen = new Set<string>()
  const push = (id: string, method: PayoutMethod, number: string, at: number) => {
    if (!id || seen.has(id) || !/^\+[1-9]\d{7,14}$/.test(number) || !(at > 0)) return
    seen.add(id)
    numbers.push({ id, method, number, verifiedAt: at })
  }
  if (doc.numbers && typeof doc.numbers === 'object') {
    for (const [id, entry] of Object.entries(doc.numbers)) {
      const method = entry?.method
      if (method !== 'mtn' && method !== 'airtel') continue
      push(id, method, String(entry?.number || '').trim(), Number(entry?.verifiedAt))
    }
  }
  for (const method of ['mtn', 'airtel'] as PayoutMethod[]) {
    const entry = doc[method]
    if (!entry) continue
    const number = String(entry.number || '').trim()
    if (!/^\+[1-9]\d{7,14}$/.test(number)) continue
    push(`${method}-${number.slice(1)}`, method, number, Number(entry.verifiedAt))
  }
  numbers.sort((a, b) => a.verifiedAt - b.verifiedAt)

  const active: Partial<Record<PayoutMethod, string>> = {}
  for (const method of ['mtn', 'airtel'] as PayoutMethod[]) {
    const claimed = doc.active?.[method]
    const first = numbers.find(entry => entry.method === method)
    const id = typeof claimed === 'string' && seen.has(claimed) ? claimed : first?.id
    if (id) active[method] = id
  }
  return { numbers, active }
}

/** Pure: what a verify response means. A 200 without the number is still a failure, said aloud. */
export function readPayoutVerifyResponse(status: number, data: unknown): PayoutVerifyResult {
  const body = (data || {}) as {
    phone?: unknown; method?: unknown; verifiedAt?: unknown; error?: unknown; reason?: unknown
  }
  if (status >= 200 && status < 300) {
    if (typeof body.phone !== 'string' || !body.phone) return { ok: false, error: VERIFY_ERROR }
    if (body.method !== 'mtn' && body.method !== 'airtel') return { ok: false, error: VERIFY_ERROR }
    const method = body.method
    const at = Number(body.verifiedAt)
    return {
      ok: true,
      phone: body.phone,
      method,
      verifiedAt: Number.isFinite(at) && at > 0 ? at : Date.now(),
    }
  }
  return {
    ok: false,
    error: typeof body.error === 'string' && body.error ? body.error : VERIFY_ERROR,
    reason: typeof body.reason === 'string' ? body.reason : undefined,
  }
}

/** Pure: what a save response means. The endpoint echoes the flags it wrote. */
export function readPayoutSaveResponse(status: number, data: unknown): PayoutSaveResult {
  const body = (data || {}) as {
    enabled?: { mtn?: unknown; airtel?: unknown }; error?: unknown; reason?: unknown
  }
  if (status >= 200 && status < 300) {
    // A 200 that forgets to say what it wrote is not a save we can show. The endpoint echoes
    // both booleans on purpose; anything else is a broken response, not a quiet success.
    if (typeof body.enabled?.mtn !== 'boolean' || typeof body.enabled?.airtel !== 'boolean') {
      return { ok: false, error: SAVE_ERROR }
    }
    return {
      ok: true,
      enabled: { mtn: body.enabled.mtn, airtel: body.enabled.airtel },
    }
  }
  return {
    ok: false,
    error: typeof body.error === 'string' && body.error ? body.error : SAVE_ERROR,
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

async function postPayout(body: Record<string, unknown>, idToken: string): Promise<Response> {
  return fetch(`${OTP_BASE}/api/payout/methods`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(body),
  })
}

/** POST `/api/payout/methods` with `action: 'verify'` — prove and save one payout number. */
export async function verifyPayoutNumber(
  phone: string,
  code: string,
  method: PayoutMethod,
  opts: { idToken?: string } = {},
): Promise<PayoutVerifyResult> {
  if (!opts.idToken) {
    return { ok: false, error: 'Sign in again to verify a payout number.' }
  }
  try {
    const res = await postPayout({ action: 'verify', method, phone, code }, opts.idToken)
    return readPayoutVerifyResponse(res.status, await readJson(res))
  } catch (err) {
    console.warn('Payout verify failed:', err)
    return { ok: false, error: NETWORK_ERROR }
  }
}

/** POST `/api/payout/methods` with `action: 'save'` — switch verified rails on or off. */
export async function savePayoutMethods(
  enabled: Record<PayoutMethod, boolean>,
  opts: { idToken?: string } = {},
): Promise<PayoutSaveResult> {
  if (!opts.idToken) {
    return { ok: false, error: 'Sign in again to save your payout settings.' }
  }
  try {
    const res = await postPayout({
      action: 'save',
      mtn: enabled.mtn === true,
      airtel: enabled.airtel === true,
    }, opts.idToken)
    return readPayoutSaveResponse(res.status, await readJson(res))
  } catch (err) {
    console.warn('Payout save failed:', err)
    return { ok: false, error: NETWORK_ERROR }
  }
}

/** Pure: what an activate response means. The endpoint echoes the id that is now live. */
export function readPayoutActivateResponse(
  status: number,
  data: unknown,
): PayoutActivateResult {
  const body = (data || {}) as {
    method?: unknown; activeId?: unknown; phone?: unknown; error?: unknown; reason?: unknown
  }
  if (status >= 200 && status < 300) {
    if (body.method !== 'mtn' && body.method !== 'airtel') return { ok: false, error: ACTIVATE_ERROR }
    if (typeof body.activeId !== 'string' || !body.activeId) {
      return { ok: false, error: ACTIVATE_ERROR }
    }
    return {
      ok: true,
      method: body.method,
      activeId: body.activeId,
      phone: typeof body.phone === 'string' ? body.phone : '',
    }
  }
  return {
    ok: false,
    error: typeof body.error === 'string' && body.error ? body.error : ACTIVATE_ERROR,
    reason: typeof body.reason === 'string' ? body.reason : undefined,
  }
}

/** POST `/api/payout/methods` with `action: 'activate'` — choose which proved number is live. */
export async function activatePayoutNumber(
  method: PayoutMethod,
  numberId: string,
  opts: { idToken?: string } = {},
): Promise<PayoutActivateResult> {
  if (!opts.idToken) {
    return { ok: false, error: 'Sign in again to change your payout number.' }
  }
  try {
    const res = await postPayout({ action: 'activate', method, numberId }, opts.idToken)
    return readPayoutActivateResponse(res.status, await readJson(res))
  } catch (err) {
    console.warn('Payout activate failed:', err)
    return { ok: false, error: NETWORK_ERROR }
  }
}
