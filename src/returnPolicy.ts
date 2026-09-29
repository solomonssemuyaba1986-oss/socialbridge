/**
 * The return policy, as code — one source of truth for the window, who pays, what can come back,
 * and how long a seller has to answer.
 *
 * The complaints this is written against:
 *
 *  1. **"Returns are fine print."** Every rule here is said out loud in plain words, on the order
 *     itself, at the moment the buyer needs it (`RETURN_PROMISE`, rendered at `/returns`).
 *  2. **"86 days from what?"** The clock starts when the order was marked delivered
 *     (`deliveredAt`), which is a date the seller wrote and the buyer can see — not a guess. The
 *     day it closes is printed as a calendar date (`returnWindowClosesOnWords`), so nobody has to
 *     do arithmetic on a promise.
 *  3. **"They refused because it was underwear."** Hygiene items and perishables genuinely cannot be
 *     resold — so a change of mind on them is refused, and said so up front. But a **wrong,
 *     damaged, missing or undelivered** item is always returnable, whatever it is. That is the
 *     difference between a rule and an excuse.
 *  4. **"Nobody ever answered."** A request opens a 48-hour clock (`SELLER_ANSWER_HOURS`). When it
 *     runs out, the buyer has one tap straight to rachett care, with the whole story attached.
 *
 * The state machine is small on purpose, and split by who may write it:
 *   buyer  → requested · photos_sent · canceled
 *   seller → photos_needed · approved · declined · refunded · completed
 * The same lists are declared in `firestore.rules`, and the harness pins the two together.
 *
 * Pure (no Firebase, no React) so all of it is checked in Node: `_return_policy_check.cjs`.
 */

/**
 * 86 days — just under three months — counted from the day the seller marked the order delivered.
 *
 * The number is 86 and not 90 on purpose: a window that ends on the same calendar day as the
 * purchase three months later is one nobody can remember, and one a seller can argue about. The
 * exact figure is what the code counts, the plain words are what a buyer reads, and both are shown
 * side by side (`RETURN_PROMISE`) — a promise nobody can check is not a promise.
 */
export const RETURN_WINDOW_DAYS = 86
/** The same window in the words a person would use out loud. */
export const RETURN_WINDOW_PLAIN = 'just under three months'
/** How long a seller has to answer a return request before rachett care can take it over. */
export const SELLER_ANSWER_HOURS = 48
export const RETURN_PAGE = '/returns'
/** Long enough for a real explanation, short enough to read on a phone. */
export const MAX_RETURN_NOTE = 300
export const DAY_MS = 24 * 60 * 60 * 1000

/** Who is at fault. It decides who pays for the trip back — nothing else. */
export type ReturnFault = 'seller' | 'buyer'

export interface ReturnReason {
  value: string
  /** The words on the button — the buyer's own, not ours. */
  label: string
  fault: ReturnFault
  /** Said under the choice, so nobody has to guess whether their case counts. */
  hint: string
}

export const RETURN_REASONS: ReturnReason[] = [
  { value: 'damaged', label: 'It arrived damaged', fault: 'seller', hint: 'A photo in the chat is the fastest way to a refund — send it and the seller can settle today.' },
  { value: 'wrong_item', label: 'It is not what I ordered', fault: 'seller', hint: 'Wrong size, wrong colour, or a different item altogether.' },
  { value: 'not_as_described', label: 'Not as described', fault: 'seller', hint: 'The listing said one thing and the parcel said another.' },
  { value: 'missing_parts', label: 'Parts are missing', fault: 'seller', hint: 'Something the listing promised is not in the box.' },
  { value: 'never_arrived', label: 'It never arrived', fault: 'seller', hint: 'Marked delivered, but nothing reached you. This one starts with a refund, not a return.' },
  { value: 'too_late', label: 'It arrived too late', fault: 'seller', hint: 'Far later than the seller said, and you no longer want it.' },
  { value: 'changed_mind', label: 'I changed my mind', fault: 'buyer', hint: 'Fine on most things, as long as it is in the condition you received it.' },
  { value: 'other', label: 'Something else', fault: 'buyer', hint: 'Say what happened in your own words — the seller reads this first.' },
]

export function returnReason(value: unknown): ReturnReason | null {
  if (typeof value !== 'string') return null
  return RETURN_REASONS.find(r => r.value === value) || null
}

/**
 * Who covers sending it back. The fault decides, and where we honestly cannot tell, it falls on the
 * seller — the side that holds the stock and set the price.
 */
export function whoPaysReturn(reasonValue: unknown): { value: ReturnFault; text: string } {
  const reason = returnReason(reasonValue)
  if (!reason || reason.fault === 'seller') {
    return {
      value: 'seller',
      text: 'The seller covers getting it back to them. If they ask you to pay, get help — that is not the rule.',
    }
  }
  return {
    value: 'buyer',
    text: 'You cover sending it back. The seller refunds the price you paid once it reaches them.',
  }
}

/**
 * Things that genuinely cannot go back on the shelf once opened: hygiene, food, and codes. Only a
 * *change of mind* is blocked by this list — a fault is always covered, and the words below say so.
 */
const NO_CHANGE_OF_MIND = [
  'underwear', 'lingerie', 'innerwear', 'socks', 'swimwear',
  'beauty', 'cosmetic', 'makeup', 'perfume', 'skin', 'hair',
  'food', 'grocery', 'groceries', 'snack', 'beverage', 'drink', 'alcohol',
  'medicine', 'health', 'pharmacy', 'supplement',
  'digital', 'airtime', 'data bundle', 'voucher', 'gift card',
  'perishable', 'fresh', 'frozen',
]

/** Is this item returnable, for this reason? */
export function isReturnable(input: { category?: string; subCategory?: string; reason?: unknown }): {
  ok: boolean
  text: string
} {
  const reason = returnReason(input.reason)
  // A fault is a fault. Whatever the item is, it is covered.
  if (!reason || reason.fault === 'seller') {
    return { ok: true, text: 'Covered — faults are always returnable, whatever the item is.' }
  }
  const haystack = `${input.category || ''} ${input.subCategory || ''}`.toLowerCase()
  const blocked = NO_CHANGE_OF_MIND.some(word => haystack.includes(word))
  if (blocked) {
    return {
      ok: false,
      text: 'A change of mind cannot apply to this kind of item once it is opened (hygiene, food or codes). If it arrived wrong or damaged, it is still covered — pick that reason instead.',
    }
  }
  return { ok: true, text: 'Fine to return it, as long as it is in the condition you received it.' }
}

// ── who may write what ───────────────────────────────────────────────────────

/** The states the **buyer** may set. The same list is in `firestore.rules`. */
export const BUYER_RETURN_STATES = ['requested', 'photos_sent', 'canceled'] as const
/** The states only the **seller** may set — a buyer can never approve their own return. */
export const SELLER_RETURN_STATES = ['photos_needed', 'approved', 'declined', 'refunded', 'completed'] as const

export type BuyerReturnState = (typeof BUYER_RETURN_STATES)[number]
export type SellerReturnState = (typeof SELLER_RETURN_STATES)[number]
export type ReturnState = BuyerReturnState | SellerReturnState

/** Anything that means "a return is live right now". */
export function returnIsOpen(state: unknown): boolean {
  return state === 'requested' || state === 'photos_needed' || state === 'photos_sent' || state === 'approved'
}

export interface ReturnStateWords {
  icon: string
  text: string
  note: string
  tone: 'waiting' | 'good' | 'bad' | 'done'
}

/**
 * What a state means, in the words of the person reading it. The buyer is waiting for a decision;
 * the seller either has a clock running or has just made one. `side` decides which of the two.
 */
export function returnStateWords(state: unknown, side: 'buyer' | 'seller' = 'buyer'): ReturnStateWords | null {
  if (typeof state !== 'string' || !state) return null
  if (side === 'seller') {
    switch (state) {
      case 'requested':
        return { icon: '↩️', text: 'Return requested', note: 'Answer within 48 hours — silence sends this to rachett care.', tone: 'waiting' }
      case 'photos_sent':
        return { icon: '📷', text: 'Buyer sent a photo', note: 'Have a look, then approve or say why not.', tone: 'waiting' }
      case 'photos_needed':
        return { icon: '📷', text: 'You asked for a photo', note: 'Waiting on the buyer now.', tone: 'waiting' }
      case 'approved':
        return { icon: '✓', text: 'You approved the return', note: 'Arrange the pick-up in the chat, then mark it refunded.', tone: 'good' }
      case 'declined':
        return { icon: '✕', text: 'You declined the return', note: 'Your reason was sent to the buyer.', tone: 'bad' }
      case 'refunded':
        return { icon: '💸', text: 'Refunded', note: 'The money is on its way back to the buyer.', tone: 'done' }
      case 'canceled':
        return { icon: '↩️', text: 'Buyer withdrew the return', note: 'Nothing to do — the order stands.', tone: 'done' }
      case 'completed':
        return { icon: '✓', text: 'Return completed', note: 'Item back, money back.', tone: 'done' }
      default:
        return null
    }
  }
  switch (state) {
    case 'requested':
      return { icon: '↩️', text: 'Return sent to the seller', note: 'They have 48 hours to answer. You will see it here, in their words.', tone: 'waiting' }
    case 'photos_needed':
      return { icon: '📷', text: 'The seller asked for a photo', note: 'Send one in the chat — it is usually all it takes.', tone: 'waiting' }
    case 'photos_sent':
      return { icon: '📷', text: 'Photo sent — waiting for the seller', note: 'The 48-hour clock is still running.', tone: 'waiting' }
    case 'approved':
      return { icon: '✓', text: 'Return approved', note: 'Arrange the hand-over in the chat. The refund follows the item.', tone: 'good' }
    case 'declined':
      return { icon: '✕', text: 'Return declined', note: 'Read their reason, then get help — it takes one tap.', tone: 'bad' }
    case 'refunded':
      return { icon: '💸', text: 'Refunded', note: 'The money is back on its way to you.', tone: 'done' }
    case 'canceled':
      return { icon: '↩️', text: 'You withdrew this return', note: `You can start it again while ${returnWindowShortWords()} last.`, tone: 'done' }
    case 'completed':
      return { icon: '✓', text: 'Return completed', note: 'Item back, money back. Thank you.', tone: 'done' }
    default:
      return null
  }
}

// ── the window ───────────────────────────────────────────────────────────────

/** When the 86 days are up: delivery date + the window. */
export function returnWindowEndsAt(deliveredAtMs: number, days = RETURN_WINDOW_DAYS): number {
  if (!deliveredAtMs) return 0
  return deliveredAtMs + days * DAY_MS
}

/** "the 86 days" — how the window is named inside a sentence. */
export function returnWindowShortWords(days = RETURN_WINDOW_DAYS): string {
  return `the ${days} days`
}

/** Month names spelled out by hand: a locale-dependent date cannot be pinned in a Node check. */
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * The day the window closes, written out ("20 May 2026"). A countdown is only true if the buyer
 * trusts our arithmetic; a date they can check against their own calendar is evidence. Empty when
 * we do not know the delivery date — the same honest silence as everywhere else here.
 */
export function returnWindowClosesOnWords(deliveredAtMs: number, days = RETURN_WINDOW_DAYS): string {
  if (!deliveredAtMs) return ''
  const at = new Date(returnWindowEndsAt(deliveredAtMs, days))
  if (Number.isNaN(at.getTime())) return ''
  return `${at.getDate()} ${MONTH_NAMES[at.getMonth()]} ${at.getFullYear()}`
}

/** "2 days", "6 hours", "20 minutes" — never "0 days" or a negative. */
export function durationWords(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60000))
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'}`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'}`
}

/**
 * The window, said out loud. `deliveredAtMs` is the moment the seller confirmed delivery; `0` means
 * we do not know it yet, which is said honestly rather than guessed at.
 */
export function returnWindowWords(
  deliveredAtMs: number,
  nowMs: number,
  days = RETURN_WINDOW_DAYS,
): { open: boolean; daysLeft: number; text: string } {
  if (!deliveredAtMs) {
    return {
      open: false,
      daysLeft: 0,
      text: 'Returns open as soon as the seller marks it delivered.',
    }
  }
  const endsAt = returnWindowEndsAt(deliveredAtMs, days)
  const closesOn = returnWindowClosesOnWords(deliveredAtMs, days)
  const msLeft = endsAt - nowMs
  if (msLeft <= 0) {
    return {
      open: false,
      daysLeft: 0,
      text: `The ${days}-day return window closed on ${closesOn} (${durationWords(-msLeft)} ago) — get help instead and we will look at it.`,
    }
  }
  const daysLeft = Math.max(1, Math.ceil(msLeft / DAY_MS))
  return {
    open: true,
    daysLeft,
    text: `${daysLeft} day${daysLeft === 1 ? '' : 's'} left to return this — open until ${closesOn} (${days} days from delivery).`,
  }
}

// ── starting a return ────────────────────────────────────────────────────────

/** The bits of an order this needs. Nothing else is read, so nothing else can be got wrong. */
export interface ReturnableOrder {
  status?: string
  returnState?: string
  /** When the seller marked it delivered, in ms. 0/undefined means we do not know yet. */
  deliveredAtMs?: number
  category?: string
  subCategory?: string
}

/**
 * May this order be sent back right now? Returns the reason it cannot, in words the buyer can act
 * on — a disabled button is a dead end, an explanation is not.
 */
export function canOpenReturn(order: ReturnableOrder, nowMs: number): { ok: boolean; text: string } {
  if (returnIsOpen(order.returnState)) {
    return { ok: false, text: 'A return is already running on this order — open it to see where it stands.' }
  }
  if (order.returnState === 'declined') {
    return { ok: false, text: 'This return was already decided. Get help and we will look at the seller’s reason with you.' }
  }
  if (order.returnState === 'refunded' || order.returnState === 'completed') {
    return { ok: false, text: 'This order was already returned and refunded.' }
  }
  if (order.status && order.status !== 'fulfilled') {
    return { ok: false, text: 'Returns open the moment the seller marks it delivered. Get help if the order is stuck.' }
  }
  if (!order.deliveredAtMs) {
    return { ok: false, text: 'We do not have the delivery date yet — get help and we will sort out the dates with you.' }
  }
  const { open, text } = returnWindowWords(order.deliveredAtMs, nowMs)
  if (!open) return { ok: false, text }
  return { ok: true, text }
}

/**
 * The exact fields a buyer is allowed to write when starting a return — the same five in
 * `firestore.rules`. No timestamp is written from here on purpose: the client builds these, and a
 * client clock is not evidence. `updatedAt` stays owned by the app's own writers.
 */
export function returnPatch(input: {
  reason: unknown
  note?: unknown
  nowMs: number
}): Record<string, string | number> {
  const reason = returnReason(input.reason)
  const note = typeof input.note === 'string' ? input.note.trim().slice(0, MAX_RETURN_NOTE) : ''
  const patch: Record<string, string | number> = {
    returnState: 'requested',
    returnReason: reason ? reason.value : 'other',
    returnFault: reason ? reason.fault : 'seller',
    returnRequestedAt: input.nowMs,
  }
  // Firestore rejects `undefined`, so the note key only exists when there is something to say.
  if (note) patch.returnNote = note
  return patch
}

/** What the buyer may write after that: photos sent, or the request withdrawn. */
export function buyerReturnPatch(state: BuyerReturnState, nowMs: number, note?: unknown): Record<string, string | number> {
  if (!BUYER_RETURN_STATES.includes(state)) {
    throw new Error(`"${state}" is not the buyer's to set`)
  }
  const patch: Record<string, string | number> = { returnState: state, returnUpdatedAt: nowMs }
  const trimmed = typeof note === 'string' ? note.trim().slice(0, MAX_RETURN_NOTE) : ''
  if (trimmed) patch.returnNote = trimmed
  return patch
}

/** And what the seller may write: a decision, with a reason when they decline. */
export function sellerReturnPatch(
  state: SellerReturnState,
  nowMs: number,
  note?: unknown,
): Record<string, string | number> {
  if (!SELLER_RETURN_STATES.includes(state)) {
    throw new Error(`"${state}" is not the seller's to set`)
  }
  const patch: Record<string, string | number> = { returnState: state, returnDecidedAt: nowMs }
  const trimmed = typeof note === 'string' ? note.trim().slice(0, MAX_RETURN_NOTE) : ''
  // A refusal without a reason is not a decision, it is a wall.
  if (trimmed) patch.returnNote = trimmed
  return patch
}

/** A seller who refuses has to have said why. */
export function sellerDecisionProblem(state: SellerReturnState, note?: unknown): string {
  if (state === 'declined') {
    const trimmed = typeof note === 'string' ? note.trim() : ''
    if (trimmed.length < 10) return 'Say why you are refusing — one honest line, and the buyer can plan.'
  }
  return ''
}

// ── the 48-hour clock ────────────────────────────────────────────────────────

export function sellerAnswerDeadline(requestedAtMs: number, hours = SELLER_ANSWER_HOURS): number {
  if (!requestedAtMs) return 0
  return requestedAtMs + hours * 60 * 60 * 1000
}

/**
 * How long the seller has left, and what to do when they say nothing. Silence is the one answer
 * nobody can act on, so it ends the seller's turn rather than the buyer's patience.
 */
export function sellerAnswerWords(
  requestedAtMs: number,
  nowMs: number,
  hours = SELLER_ANSWER_HOURS,
): { late: boolean; msLeft: number; text: string } {
  if (!requestedAtMs) return { late: false, msLeft: 0, text: '' }
  const deadline = sellerAnswerDeadline(requestedAtMs, hours)
  const msLeft = deadline - nowMs
  if (msLeft <= 0) {
    return {
      late: true,
      msLeft: 0,
      text: `The seller is ${durationWords(-msLeft)} late answering this. It is yours to take over now — one tap.`,
    }
  }
  return {
    late: false,
    msLeft,
    text: `The seller answers within ${hours} hours — about ${durationWords(msLeft)} left.`,
  }
}

// ── the promise, in the words we show ────────────────────────────────────────

export interface PromiseItem {
  icon: string
  title: string
  body: string
}

/**
 * The whole policy, written the way a buyer would say it back to a friend. This is what `/returns`
 * renders, and what the sheet on the order links to — so if a rule changes, it changes in one file.
 */
export const RETURN_PROMISE: PromiseItem[] = [
  {
    icon: '📅',
    title: `${RETURN_WINDOW_DAYS} days (${RETURN_WINDOW_PLAIN}) — counted from the day it arrives`,
    body: `The clock starts when the seller marks your order delivered — a date you can see on the order — not the day you paid. The order also prints the calendar day your window closes ${RETURN_WINDOW_DAYS} days later, so there is no arithmetic to do and no argument about when it began.`,
  },
  {
    icon: '🧾',
    title: 'The long window costs you nothing',
    body: 'It is not an extended warranty, there is no fee to use it and nothing to register. Same policy, same price — just stated for as long as it actually is.',
  },
  {
    icon: '↩️',
    title: 'Wrong, damaged, missing or never delivered? Always returnable.',
    body: 'That is the seller’s fault, whatever the item is, whenever it shows up. No exceptions, no “that category is excluded”, no restocking fee.',
  },
  {
    icon: '💸',
    title: 'The price comes back to you',
    body: 'No restocking fee, no “handling charge”, no store credit you did not ask for. Refund means the money you paid, back to you.',
  },
  {
    icon: '🚚',
    title: 'Who pays for the trip back',
    body: 'If it is the seller’s fault, they cover it. If you simply changed your mind, you cover the trip — the price still comes back. If a seller asks you to pay for their mistake, get help.',
  },
  {
    icon: '⏱️',
    title: `The seller answers in ${SELLER_ANSWER_HOURS} hours`,
    body: 'Every return request starts a clock. Approve, ask for a photo, or refuse with a reason — all three are answers. Silence is not.',
  },
  {
    icon: '🛡️',
    title: 'Rachett care takes over when the clock runs out',
    body: `If nothing happens for ${SELLER_ANSWER_HOURS} hours, one tap sends the whole return to us — the order, your reason, the photo, the dates. You stop chasing.`,
  },
]

/**
 * The honest limits. A policy that claims everything is possible is the kind nobody believes, so
 * these two are on the page in the same size text as everything else.
 */
export const RETURN_LIMITS: PromiseItem[] = [
  {
    icon: '🧼',
    title: 'Opened hygiene items, food and codes',
    body: 'We cannot resell a used toothbrush or an airtime code, so a change of mind cannot apply there. Anything wrong with them is still covered — pick the fault reason and it is returnable like everything else.',
  },
  {
    icon: '🤝',
    title: 'We are not the shop — we are the referee',
    body: 'We cannot take money out of a seller’s pocket. We can suspend a shop, keep a record, and tell you in writing what happened. If your money is gone because a seller ignored the rules, tell us and we will act on the seller, not just the order.',
  },
]

/** One line for the top of the return sheet — the thing a buyer needs to know before the form. */
export function returnOpeningLine(order: ReturnableOrder, nowMs: number): string {
  const { ok, text } = canOpenReturn(order, nowMs)
  if (ok) {
    const closesOn = returnWindowClosesOnWords(order.deliveredAtMs || 0)
    const left = returnWindowWords(order.deliveredAtMs || 0, nowMs).daysLeft
    return `You have ${left} day${left === 1 ? '' : 's'} left — open until ${closesOn}. Pick the reason below, the seller has ${SELLER_ANSWER_HOURS} hours to answer.`
  }
  return text
}

/** A one-line summary for an order row: the state, and the clock if one is running. */
export function returnRowLine(order: ReturnableOrder & { returnRequestedAtMs?: number }, nowMs: number): string {
  const words = returnStateWords(order.returnState, 'buyer')
  if (!words) return ''
  if (returnIsOpen(order.returnState) && order.returnRequestedAtMs) {
    const clock = sellerAnswerWords(order.returnRequestedAtMs, nowMs)
    return clock.late ? `${words.text} · seller is late` : words.text
  }
  return words.text
}
