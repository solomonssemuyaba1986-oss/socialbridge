/**
 * The buyer's side of a mobile money payment — the only place the app is allowed to talk about one.
 *
 * Everything that *decides* anything happens in `functions/index.js`: the amount comes from the
 * order document, the network comes from pawaPay's own answer, and the status comes from pawaPay —
 * never from this file and never from a browser. This wrapper only carries a phone number up and
 * plain words back down.
 *
 * It is deliberately thin, and deliberately not optimistic: a status here is what the server last
 * learned from pawaPay, and `pending: true` means "still moving", not "probably fine".
 */
import { httpsCallable } from 'firebase/functions'
import { functions } from './firebase'
import { paymentErrorMessage, PAYMENT_NOT_CONFIGURED_MESSAGE } from './pesapalUtils'

// The words for a failure are shared with the card flow on purpose: a buyer should not be able to
// tell which processor was involved by the phrasing of a problem. (The filename is now a little
// narrow for what it holds — worth renaming to `paymentError.ts` one day.)
export { PAYMENT_NOT_CONFIGURED_MESSAGE, paymentErrorMessage } from './pesapalUtils'

export type PawapayOutcome = 'initiated' | 'completed' | 'failed' | 'unknown' | 'none'

export interface PawapayStart {
  depositId: string
  provider: string
  amount: number
  currency: string
  message: string
}

export interface PawapayCheck {
  status: PawapayOutcome
  paid: boolean
  /** Still moving: the prompt is on their phone and nobody has decided yet. */
  pending: boolean
  method: string
  /** Plain words for the status. */
  label: string
  /** Whatever the server wanted to say — e.g. "paid with a network this seller had not listed". */
  note: string
  amount: number | null
  currency: string
  orderStatus: string | null
}

interface StartRequest {
  sellerId: string
  orderId: string
  phoneNumber: string
}

interface CheckRequest {
  depositId?: string
  sellerId?: string
  orderId?: string
}

const startCall = httpsCallable<StartRequest, PawapayStart>(functions, 'pawapayStartDeposit')
const checkCall = httpsCallable<CheckRequest, PawapayCheck>(functions, 'pawapayPaymentStatus')

/** Never a code, never a `_`: the same vocabulary the card flow uses. */
const WORDS: Record<string, string> = {
  initiated: 'Waiting for you to pay',
  completed: 'Paid',
  failed: 'Payment failed',
  unknown: 'We are checking this payment',
  none: 'No payment yet',
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function pawapayStatusLabel(status?: string | null): string {
  const key = text(status)
  return WORDS[key] || WORDS.unknown
}

/**
 * Ask a buyer's wallet for the money.
 *
 * `phoneNumber` may be typed however they type it — `+256 771 234 567`, `0771 234 567` — because
 * the server normalises it and pawaPay itself hands back the properly formatted number. What comes
 * back is the deposit id to watch; the prompt is already on its way.
 */
export async function startPawapayDeposit(
  sellerId: string,
  orderId: string,
  phoneNumber: string,
): Promise<PawapayStart> {
  const result = await startCall({ sellerId, orderId, phoneNumber })
  const data = result.data || ({} as PawapayStart)
  return {
    depositId: text(data.depositId),
    provider: text(data.provider),
    amount: Number(data.amount) || 0,
    currency: text(data.currency) || 'UGX',
    message: text(data.message) || 'Check your phone and approve the payment.',
  }
}

/**
 * Ask what happened. Safe to call repeatedly — which is the point, because this is what the screen
 * polls while the buyer approves the prompt. Repeats change nothing on the server.
 */
export async function checkPawapayPayment(where: CheckRequest): Promise<PawapayCheck> {
  const result = await checkCall(where)
  return normaliseCheck(result.data)
}

/** Shape the server's answer into something a screen can render without guessing. */
export function normaliseCheck(raw?: Partial<PawapayCheck> | null): PawapayCheck {
  const data = raw || {}
  const status = text(data.status) || 'none'
  const known: PawapayOutcome[] = ['initiated', 'completed', 'failed', 'unknown', 'none']
  const resolved = known.includes(status as PawapayOutcome) ? (status as PawapayOutcome) : 'unknown'
  return {
    status: resolved,
    paid: Boolean(data.paid),
    pending: Boolean(data.pending),
    method: text(data.method),
    label: pawapayStatusLabel(resolved),
    note: text(data.note),
    amount: typeof data.amount === 'number' ? data.amount : null,
    currency: text(data.currency),
    orderStatus: data.orderStatus ? text(data.orderStatus) : null,
  }
}
