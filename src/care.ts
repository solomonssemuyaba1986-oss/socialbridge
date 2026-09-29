/**
 * Customer care — the thing that makes the return policy real.
 *
 * A policy is only as good as the answer you get when it is broken. So this module is built around
 * four promises, and each one is a rule in code:
 *
 *  1. **One tap, and the writing is done for you.** Every issue type carries a prewritten message
 *     built from the actual order ("I ordered 2 × Chair from Kigali Furniture on 12/02. It has not
 *     arrived…"). The buyer may edit it, but they never have to write anything from scratch —
 *     having to explain your problem in a blank box is what makes people give up.
 *  2. **A person, within 24 hours.** `CARE_SLA_HOURS`. The clock is on the ticket from the second
 *     it is sent, and shown to the buyer, so a promise that is missed is *visible* rather than
 *     quietly forgotten.
 *  3. **The seller never sees it.** A ticket is written to `careTickets/`, which only its author can
 *     read, and it is never posted into the buyer↔seller chat — so nobody has to weigh "will this
 *     get me my money back" against "will this make the seller angry".
 *  4. **Nothing is a dead end.** When we miss our own 24 hours, the ticket says so in the buyer's
 *     words, and the order and the seller's record go with it — the complaint is filed whether or
 *     not the buyer keeps chasing.
 *
 * Pure (no Firebase, no React) so every rule above is checked in Node: `_care_check.cjs`. The thin
 * write that actually files a ticket lives in `./careTickets`.
 */

/** The answer a buyer is promised. Missed, it is said out loud rather than excused. */
export const CARE_SLA_HOURS = 24
export const MAX_CARE_NOTE = 500
/** Enough photos to show the problem, few enough to send on a phone. */
export const MAX_CARE_PHOTOS = 3

export interface CareContext {
  orderId?: string
  itemName?: string
  quantity?: number
  shopName?: string
  sellerId?: string
  /** The order's own date, in ms — never "now", so the ticket says the truth about the order. */
  orderedAtMs?: number
  /** Anything the buyer already did (a return request, a chat) is part of the story. */
  returnState?: string
  returnReason?: string
}

export interface CareIssue {
  value: string
  /** The buyer's words for it, not ours. */
  label: string
  icon: string
  /** One line so the right button is obvious. */
  hint: string
  /** Rough buckets used to route and prioritise, and for nothing else. */
  topic: 'delivery' | 'item' | 'money' | 'seller' | 'app'
  /** Does this need an order to make sense? */
  needsOrder: boolean
  /** Would a photo settle it faster? */
  photoHelps: boolean
  /** The subject line a person will read first. */
  subject: string
  /** The prewritten message, before the order's details are filled in. */
  message: string
}

/**
 * Every way in. The list is deliberately short and in the buyer's own language — someone in a bad
 * mood at 9pm should find their sentence in one glance.
 *
 * `message` is what gets sent. `{item}`, `{shop}`, `{order}` and `{date}` are filled from the real
 * order by `careDraft`, so no ticket ever arrives as "hi, my order is not ok".
 */
export const CARE_ISSUES: CareIssue[] = [
  {
    value: 'not_arrived',
    label: 'I bought it and it never came',
    icon: '🚚',
    hint: 'Delivered late, or never delivered at all.',
    topic: 'delivery',
    needsOrder: true,
    photoHelps: false,
    subject: 'Order not delivered',
    message: 'I ordered {item} from {shop} on {date} (order {order}). It has not arrived. Please tell me where it is, or refund it.',
  },
  {
    value: 'seller_silent',
    label: 'The seller stopped answering me',
    icon: '🔇',
    hint: 'Messages in the chat, but no reply.',
    topic: 'seller',
    needsOrder: true,
    photoHelps: false,
    subject: 'A seller is not answering',
    message: 'I have messaged {shop} about {item} (order {order}) and there is no reply. Please step in — I need an answer from someone.',
  },
  {
    value: 'wrong_or_damaged',
    label: 'What I got is wrong or damaged',
    icon: '📦',
    hint: 'Wrong item, wrong size, broken, or parts missing.',
    topic: 'item',
    needsOrder: true,
    photoHelps: true,
    subject: 'Item arrived wrong or damaged',
    message: 'The {item} I ordered from {shop} on {date} (order {order}) arrived wrong or damaged. I want it replaced or refunded.',
  },
  {
    value: 'return_refused',
    label: 'My return was refused',
    icon: '↩️',
    hint: 'The seller said no, and you do not agree with why.',
    topic: 'money',
    needsOrder: true,
    photoHelps: true,
    subject: 'A return was refused',
    message: 'I sent a return for {item} (order {order}) and {shop} refused it. Here is why I think that is wrong, and what I want: ',
  },
  {
    value: 'no_refund',
    label: 'I returned it and no money came back',
    icon: '💸',
    hint: 'The item went back, the refund did not.',
    topic: 'money',
    needsOrder: true,
    photoHelps: false,
    subject: 'Refund not received',
    message: 'I returned {item} to {shop} (order {order}) and the refund has not reached me. Order {order}. Please push this to a refund.',
  },
  {
    value: 'payment_problem',
    label: 'Something is wrong with my payment',
    icon: '📱',
    hint: 'Charged twice, paid and marked unpaid, or the amount is wrong.',
    topic: 'money',
    needsOrder: true,
    photoHelps: true,
    subject: 'A payment problem',
    message: 'There is a payment problem on order {order} with {shop} — the money and the order do not agree. Please check what you received against what I paid.',
  },
  {
    value: 'seller_behaviour',
    label: 'A seller broke the rules',
    icon: '🚩',
    hint: 'Rude, pushy, off-platform payment, fake listing — anything that should cost them their shop.',
    topic: 'seller',
    needsOrder: false,
    photoHelps: false,
    subject: 'A seller broke the rules',
    message: 'I want to report {shop}. Here is what happened, with dates: ',
  },
  {
    value: 'app_problem',
    label: 'Something in the app is broken',
    icon: '🔧',
    hint: 'A button that does nothing, a photo that will not upload, a page that lies.',
    topic: 'app',
    needsOrder: false,
    photoHelps: true,
    subject: 'Something is broken in the app',
    message: 'Something in the app is not working for me. What I was doing, and what happened instead: ',
  },
  {
    value: 'something_else',
    label: 'Something else',
    icon: '💬',
    hint: 'Say it your way — we read every one of these.',
    topic: 'app',
    needsOrder: false,
    photoHelps: false,
    subject: 'A question about my order',
    message: 'I need help with this: ',
  },
]

export function careIssue(value: unknown): CareIssue | null {
  if (typeof value !== 'string') return null
  return CARE_ISSUES.find(issue => issue.value === value) || null
}

/** The date as a person writes it (12/02/2026) — and never "Invalid Date". */
export function careDateWords(ms: unknown): string {
  const n = Number(ms)
  if (!n || !isFinite(n)) return ''
  const d = new Date(n)
  if (isNaN(d.getTime())) return ''
  const day = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  return `${day}/${month}/${d.getFullYear()}`
}

/** "2 × Chair" — the quantity when we have one, the item when we do not, "your order" when we have neither. */
export function careItemWords(context: CareContext = {}): string {
  const name = (context.itemName || '').trim()
  const qty = Number(context.quantity) || 0
  if (name && qty > 1) return `${qty} × ${name}`
  if (name) return name
  return 'an item'
}

/**
 * The prewritten message, with the real order filled in. Anything we do not know is left out
 * entirely rather than rendered as an empty bracket or the word "undefined" — a ticket that reads
 * like a form is a ticket nobody trusts.
 */
export function careDraft(issueValue: unknown, context: CareContext = {}, note?: unknown): string {
  const issue = careIssue(issueValue)
  const base = issue ? issue.message : 'I need help with an order: '
  const date = careDateWords(context.orderedAtMs)
  const filled = base
    .replace(/\{item\}/g, careItemWords(context))
    .replace(/\{shop\}/g, (context.shopName || '').trim() || 'the seller')
    .replace(/\{order\}/g, (context.orderId || '').trim() || 'unknown')
    .replace(/\{date\}/g, date || 'a while ago')
  const typed = typeof note === 'string' ? note.trim().slice(0, MAX_CARE_NOTE) : ''
  // The buyer's own words are added, never replaced — the prewritten line is a floor, not a ceiling.
  return typed && !filled.includes(typed) ? `${filled}\n\n${typed}` : filled
}

// ── the ticket ───────────────────────────────────────────────────────────────

export interface CareTicket {
  issue: string
  topic: CareIssue['topic']
  subject: string
  message: string
  /** What a person needs to open the order without asking a second question. */
  orderId: string
  sellerId: string
  shopName: string
  itemName: string
  /** Links only — the photos live in Cloudinary, as everywhere else in the app. */
  photoUrls: string[]
  /** A return that is already running is part of the story, so it travels with the ticket. */
  returnState: string
  returnReason: string
  /** 'open' until a person closes it. The buyer's copy always says the same thing. */
  status: 'open'
  /** When it was sent, in ms — the clock we are judged against. */
  createdAtMs: number
  slaHours: number
  source: 'care'
}

/**
 * The ticket, built from the issue and the real order. `nowMs` is passed in rather than read from
 * the clock so the whole thing stays testable — and because the caller already knows the time.
 */
export function careTicket(input: {
  issue: unknown
  context?: CareContext
  note?: unknown
  photoUrls?: unknown
  nowMs: number
}): CareTicket {
  const issue = careIssue(input.issue)
  const context = input.context || {}
  const photos = Array.isArray(input.photoUrls)
    ? input.photoUrls
        .filter((url): url is string => typeof url === 'string' && url.trim() !== '')
        .slice(0, MAX_CARE_PHOTOS)
    : []
  return {
    issue: issue ? issue.value : 'something_else',
    topic: issue ? issue.topic : 'app',
    subject: issue ? issue.subject : 'A question about my order',
    message: careDraft(input.issue, context, input.note).slice(0, MAX_CARE_NOTE + 400),
    orderId: (context.orderId || '').trim(),
    sellerId: (context.sellerId || '').trim(),
    shopName: (context.shopName || '').trim(),
    itemName: (context.itemName || '').trim(),
    photoUrls: photos,
    returnState: (context.returnState || '').trim(),
    returnReason: (context.returnReason || '').trim(),
    status: 'open',
    createdAtMs: input.nowMs,
    slaHours: CARE_SLA_HOURS,
    source: 'care',
  }
}

/**
 * The document that actually lands in `careTickets/`. Built here rather than in the writer on
 * purpose: the shape is then checked in Node against `firestore.rules` (`_rules_check.cjs`) instead
 * of being trusted. Anything we do not know is left out rather than written as an empty string, and
 * the message is capped at the very number the rules cap it at, so the app can never build a ticket
 * the rules would refuse.
 */
export function careTicketDoc(ticket: CareTicket, uid: string): Record<string, string | number | string[]> {
  const doc: Record<string, string | number | string[]> = {
    // The rules read the author off the document — this key is the ticket's permission to exist.
    uid,
    issue: ticket.issue,
    topic: ticket.topic,
    subject: ticket.subject,
    message: ticket.message.slice(0, MAX_CARE_NOTE + 400),
    status: ticket.status,
    source: ticket.source,
    createdAtMs: ticket.createdAtMs,
    slaHours: ticket.slaHours,
  }
  const known: [string, string][] = [
    ['orderId', ticket.orderId],
    ['sellerId', ticket.sellerId],
    ['shopName', ticket.shopName],
    ['itemName', ticket.itemName],
    ['returnState', ticket.returnState],
    ['returnReason', ticket.returnReason],
  ]
  known.forEach(([key, value]) => { if (value) doc[key] = value })
  if (ticket.photoUrls.length > 0) doc.photoUrls = ticket.photoUrls.slice(0, MAX_CARE_PHOTOS)
  return doc
}

/** "3 hours ago" — never "in -3 hours", never "Invalid Date". */
export function careAgoWords(ms: number): string {
  const elapsed = Math.max(0, Number(ms) || 0)
  const minutes = Math.round(elapsed / 60000)
  if (minutes < 2) return 'just now'
  if (minutes < 60) return `${minutes} minutes ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

/**
 * Have we broken our own promise? This is the one number in the module that is about *us*, and it
 * is deliberately shown to the buyer — a missed promise that nobody can see is not a promise.
 */
export function careIsOverdue(createdAtMs: number, nowMs: number, slaHours = CARE_SLA_HOURS): boolean {
  if (!createdAtMs) return false
  return nowMs - createdAtMs > slaHours * 60 * 60 * 1000
}

/**
 * The status line on the buyer's own copy of the ticket. It never says "in progress" — it says when
 * it went, what we promised, and the truth once the promise has passed.
 */
export function careTicketLine(
  ticket: { createdAtMs?: number; status?: string; slaHours?: number },
  nowMs: number,
): string {
  const createdAt = Number(ticket?.createdAtMs) || 0
  if (!createdAt) return ''
  const sla = Number(ticket?.slaHours) || CARE_SLA_HOURS
  const ago = careAgoWords(nowMs - createdAt)
  if (ticket?.status === 'closed') return `Closed · sent ${ago}`
  if (careIsOverdue(createdAt, nowMs, sla)) {
    return `Sent ${ago} · past the ${sla} hours we promised, so it is with a person now — leave it with us.`
  }
  const leftMs = createdAt + sla * 60 * 60 * 1000 - nowMs
  const leftHours = Math.max(1, Math.round(leftMs / 3600000))
  return `Sent ${ago} · a person answers within ${leftHours} hour${leftHours === 1 ? '' : 's'} — you do not need to send it again.`
}

/**
 * What to have ready before sending, said *before* the message box rather than after a rejection.
 * At most two lines — this is help, not homework.
 */
export function careChecklist(issueValue: unknown): string[] {
  const issue = careIssue(issueValue)
  if (!issue) return []
  const out: string[] = []
  if (issue.photoHelps) {
    out.push('A photo of what arrived — the box and the item, if you still have both.')
  }
  switch (issue.topic) {
    case 'money':
      out.push('Nothing else: the order number, the amount and the dates are already on the ticket.')
      break
    case 'delivery':
      out.push('Anything the seller said about when it would arrive — a screenshot of the chat is enough.')
      break
    case 'seller':
      out.push('The name of the shop, and roughly when it happened.')
      break
    default:
      break
  }
  return out.slice(0, 2)
}

/**
 * What rachett care is, in the words a worried buyer needs. Shown at the top of the sheet and on
 * `/help`, so the promise is read before the problem is typed.
 */
export const CARE_PROMISE: { icon: string; title: string; body: string }[] = [
  {
    icon: '✍️',
    title: 'The message is already written for you',
    body: 'Pick what happened and the sentence is there, with your order, your item and the date in it. Change it if you like — or send it as it is.',
  },
  {
    icon: '🕐',
    title: `A person answers within ${CARE_SLA_HOURS} hours`,
    body: 'You will see the clock on your own copy of the ticket. If we go past it, the ticket says so out loud instead of going quiet.',
  },
  {
    icon: '🤐',
    title: 'The seller never sees this',
    body: 'Nothing you write here is posted into the chat, and the ticket belongs to you alone — so you never have to choose between being honest and keeping the peace.',
  },
  {
    icon: '📌',
    title: 'It is kept, even if you say nothing else',
    body: 'The order, the seller, your words and the dates are on file. A shop that collects complaints is a shop we look at — you do not have to keep chasing to make it count.',
  },
]
