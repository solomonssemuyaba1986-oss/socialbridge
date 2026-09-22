/**
 * Reviews — the rules of the feature, in one pure place.
 *
 * A review is a buyer's experience, written **after delivery** by someone the order itself proves
 * bought it. Everything here is free of React, Firestore and the DOM so Node can check it
 * (`_review_check.cjs`): what counts as a valid review, who may write one, what a product is
 * allowed to claim about itself, and which words must never leak a buyer's identity.
 *
 * Same house rules as the rest of rachett: one review per buyer per product (the document ID is
 * the buyer's uid — a second review is structurally impossible), and no number that can be faked
 * for a product nobody has commented on.
 */

/**
 * What the buyer tapped. Three taps is the whole form on a phone — typing is the friction, so the
 * reaction is required and the words are optional.
 */
export type Reaction = 'love' | 'fine' | 'bad'

export const REACTIONS: ReadonlyArray<{ key: Reaction; emoji: string; label: string }> = [
  { key: 'love', emoji: '♥', label: 'Loved it' },
  { key: 'fine', emoji: '🙂', label: 'It was fine' },
  { key: 'bad', emoji: '👎', label: 'Not good' },
]

export function isReaction(value: unknown): value is Reaction {
  return value === 'love' || value === 'fine' || value === 'bad'
}

/**
 * The reaction as a number, so the data can still become a 5-star average later without asking
 * anyone to write a review twice. love = 5, fine = 3, bad = 1 — a middle that isn't a shrug.
 */
export function scoreOf(reaction: Reaction): number {
  if (reaction === 'love') return 5
  if (reaction === 'fine') return 3
  return 1
}

/** What stood out — tappable, so most reviews need no typing at all. */
export const REVIEW_TAGS = [
  'Exactly as shown',
  'Fast delivery',
  'Good quality',
  'Fair price',
  'Packed well',
  'Helpful seller',
] as const

export type ReviewTag = (typeof REVIEW_TAGS)[number]

/** Only tags we actually offer, de-duplicated, capped — never free text posing as a tag. */
export function cleanTags(raw: unknown, limit = 4): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const value of raw) {
    if (typeof value !== 'string') continue
    const tag = REVIEW_TAGS.find(t => t.toLowerCase() === value.trim().toLowerCase())
    if (!tag || out.includes(tag)) continue
    out.push(tag)
    if (out.length >= limit) break
  }
  return out
}

/**
 * The optional words: whitespace tidied, length capped (a comment is not an essay), invisible
 * control characters stripped. Line breaks are *kept* — the comment is displayed with `pre-wrap`,
 * so someone who wrote two paragraphs gets two paragraphs. Absent stays absent — never "undefined".
 */
export function cleanReviewText(raw: unknown, max = 400): string {
  if (typeof raw !== 'string') return ''
  // Character by character rather than a control-character regex (which linters rightly distrust):
  // keep the line breaks a person typed, turn every other invisible code point into a space.
  const withoutJunk = Array.from(raw, ch => {
    const code = ch.codePointAt(0) || 0
    if (code === 10) return '\n'
    if (code < 32 || code === 127) return ' '
    return ch
  }).join('')
  const tidy = withoutJunk
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (tidy.length <= max) return tidy
  return tidy.slice(0, max).trimEnd()
}

/**
 * What a buyer is shown as. A full name is not needed to trust a comment, and nobody agreed to
 * have their name published — a first name plus an initial is enough for a human to read.
 */
export function displayName(raw: unknown, fallback = 'Verified buyer'): string {
  if (typeof raw !== 'string') return fallback
  const parts = raw.trim().split(/\s+/).filter(Boolean)
  // The name has to be made of letters or digits to be a name — "😀" is not one, and showing it
  // as somebody's name would be nonsense.
  const first = parts.find(part => /[\p{L}\p{N}]/u.test(part))
  if (!first) return fallback
  const name = first.slice(0, 24)
  if (parts.length === 1) return name
  const initial = parts[parts.length - 1].charAt(0).toUpperCase()
  return /[\p{L}\p{N}]/u.test(initial) ? `${name} ${initial}.` : name
}


/** One review, as stored and as read back. */
export interface Review {
  /** The buyer's uid — also the document ID, which is what makes a second review impossible. */
  buyerUid: string
  reaction: Reaction
  tags: string[]
  text: string
  photoUrl?: string
  /**
   * The **document id** of the delivered order that proves the purchase. The security rules look
   * this order up (`get()`), which is why it must be the id, not the pretty reference below.
   */
  orderId: string
  /** The reference a human reads — "RT-AB12CD". Display only; the rules ignore it. */
  orderRef?: string
  /** What they bought (from the details sheet), when they had chosen one. */
  variant?: string
  buyerName?: string
  createdAt?: number
}

export interface ReviewSummary {
  count: number
  loved: number
  fine: number
  bad: number
  /** Sum of `scoreOf` — stored on the product, never recomputed from a truncated page of reviews. */
  scoreSum: number
  /** null for a product nobody has commented on: never a flattering 0, never a fake 5. */
  average: number | null
  /** The chips that came up most, most common first. */
  topTags: string[]
}

/** The numbers for the reviews we actually loaded (`summaryFromAggregate` is for the counters). */
export function summaryOf(reviews: Review[], topTagCount = 3): ReviewSummary {
  let loved = 0
  let fine = 0
  let bad = 0
  let scoreSum = 0
  const tagCounts = new Map<string, number>()
  for (const review of reviews) {
    if (review.reaction === 'love') loved++
    else if (review.reaction === 'fine') fine++
    else bad++
    scoreSum += scoreOf(review.reaction)
    for (const tag of review.tags) tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1)
  }
  const count = reviews.length
  const topTags = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, topTagCount)
    .map(([tag]) => tag)
  return { count, loved, fine, bad, scoreSum, average: count > 0 ? scoreSum / count : null, topTags }
}

/** A product's counters as they live on its document. Tolerates junk and absent fields. */
export function summaryFromAggregate(count: unknown, scoreSum: unknown, loved: unknown): ReviewSummary {
  const safeCount = Math.max(0, Math.floor(Number(count) || 0))
  const safeSum = Math.max(0, Math.floor(Number(scoreSum) || 0))
  const safeLoved = Math.max(0, Math.min(safeCount, Math.floor(Number(loved) || 0)))
  return {
    count: safeCount,
    loved: safeLoved,
    fine: 0,
    bad: 0,
    scoreSum: safeSum,
    average: safeCount > 0 ? safeSum / safeCount : null,
    topTags: [],
  }
}

/**
 * The one line a product is allowed to say about itself — honest at every size:
 * "No comments yet" · "♥ Loved it" · "19 of 23 loved it".
 */
export function summaryLabel(summary: ReviewSummary): string {
  if (summary.count === 0) return 'No comments yet'
  if (summary.count === 1) return summary.loved === 1 ? '♥ Loved it' : '1 comment'
  return `${summary.loved} of ${summary.count} loved it`
}

/** "4.7" with one decimal, or '' — never "0.0" for a product nobody has commented on. */
export function averageLabel(summary: ReviewSummary): string {
  return summary.average === null ? '' : summary.average.toFixed(1)
}

/** The words for a reaction, in the buyer's own framing. A "bad" answer is displayed calmly. */
export function reactionLabel(reaction: Reaction): string {
  return REACTIONS.find(r => r.key === reaction)?.label || 'It was fine'
}

export function reactionEmoji(reaction: Reaction): string {
  return REACTIONS.find(r => r.key === reaction)?.emoji || '🙂'
}

// ── Who may write one ────────────────────────────────────────────────────────────────────────

export interface EligibilityInput {
  /** The order's status: only a delivered order counts. */
  orderStatus?: string
  /** Has this buyer already had their say about this product? */
  alreadyReviewed: boolean
  /** Your own listing — nobody comments on their own product. */
  isSeller?: boolean
}

export type Eligibility = { ok: true } | { ok: false; reason: string }

/**
 * Delivery is the gate — not "ordered", not "paid". Before delivery there is nothing honest to
 * say about it, and an order the seller marked out of stock was never a delivery at all.
 */
export function canReview(input: EligibilityInput): Eligibility {
  if (input.isSeller) return { ok: false, reason: 'This is your own product.' }
  if (input.alreadyReviewed) return { ok: false, reason: 'You already had your say on this one — thank you.' }
  if (input.orderStatus !== 'fulfilled') {
    return {
      ok: false,
      reason: input.orderStatus === 'out_of_stock'
        ? 'This order could not be delivered, so there is nothing to comment on.'
        : 'You can comment on this once the seller marks it delivered.',
    }
  }
  return { ok: true }
}

// ── Editing, and what may be posted ──────────────────────────────────────────────────────────

export const EDIT_WINDOW_HOURS = 24

/** A typo is worth fixing; a rewrite after the seller calls is not. One day to edit, then it stands. */
export function canEdit(createdAt: number | undefined, now = Date.now()): boolean {
  if (!createdAt || !Number.isFinite(createdAt)) return false
  return now - createdAt <= EDIT_WINDOW_HOURS * 60 * 60 * 1000
}

/** Enough to post: a reaction, the order that proves the purchase, and words that fit. */
export function canPost(input: { reaction?: unknown; orderId?: unknown; text?: unknown }): boolean {
  if (!isReaction(input.reaction)) return false
  if (typeof input.orderId !== 'string' || input.orderId.trim().length === 0) return false
  // Too long is *rejected*, never quietly cut in half — nobody should find their sentence
  // truncated after they posted it.
  if (typeof input.text === 'string' && input.text.trim().length > 400) return false
  return true
}

/** Why it could not be posted, in the buyer's words — '' when it can. */
export function postBlocker(input: { reaction?: unknown; orderId?: unknown; text?: unknown }): string {
  if (!isReaction(input.reaction)) return 'Tap how it was first.'
  if (typeof input.orderId !== 'string' || input.orderId.trim().length === 0) {
    return 'This comment has to be attached to the order that proves it — open it from your orders.'
  }
  if (typeof input.text === 'string' && input.text.trim().length > 400) {
    return 'Your comment is a little long — trim it and post again.'
  }
  return ''
}

/** Firestore Timestamp | Date | number → milliseconds. Reviews are written with a Timestamp. */
export function toMillis(value: unknown): number | undefined {
  if (value && typeof value === 'object' && typeof (value as { toMillis?: () => number }).toMillis === 'function') {
    return (value as { toMillis: () => number }).toMillis()
  }
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number') return value
  return undefined
}

/** "3 weeks ago" for a comment — enough to judge freshness, never a timestamp nobody reads. */
export function timeAgo(createdAt: number | undefined, now = Date.now()): string {
  if (!createdAt) return ''
  const seconds = Math.max(0, Math.floor((now - createdAt) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return days === 1 ? 'yesterday' : `${days} days ago`
  const weeks = Math.floor(days / 7)
  if (weeks < 5) return weeks === 1 ? 'last week' : `${weeks} weeks ago`
  const months = Math.floor(days / 30)
  if (months < 12) return months <= 1 ? 'last month' : `${months} months ago`
  const years = Math.floor(days / 365)
  return years <= 1 ? 'last year' : `${years} years ago`
}
