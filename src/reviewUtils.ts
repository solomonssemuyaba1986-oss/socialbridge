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
/**
 * What the buyer tapped: stars, 1 to 5. A number and not an emoji, because a score is the one
 * rating language everybody already reads — "4 out of 5" needs no explanation, it is the same
 * number every shop card prints, and it can be averaged without a lookup table in the middle.
 */
export type Score = 1 | 2 | 3 | 4 | 5

export const SCORES: readonly Score[] = [1, 2, 3, 4, 5]

/** A score is a whole number from 1 to 5 — never "5", never 4.5, never 0 and never 6. */
export function isScore(value: unknown): value is Score {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5
}

/** What each score is called, in the buyer's own framing. A 1★ answer is displayed calmly. */
export const SCORE_LABELS: ReadonlyArray<{ score: Score; label: string }> = [
  { score: 5, label: 'Loved it' },
  { score: 4, label: 'Good' },
  { score: 3, label: 'It was fine' },
  { score: 2, label: 'Not great' },
  { score: 1, label: 'Not good' },
]

export function scoreLabel(score: unknown): string {
  if (!isScore(score)) return ''
  return SCORE_LABELS.find(s => s.score === score)?.label || ''
}

/** "★★★★☆" — a score as a person reads it, with no image, no icon font and no emoji. */
export function starRow(score: number): string {
  const filled = Math.max(0, Math.min(5, Math.round(Number(score) || 0)))
  return '★'.repeat(filled) + '☆'.repeat(5 - filled)
}

/**
 * Comments written before stars existed carry a tapped reaction instead ('love' · 'fine' · 'bad').
 * They were always worth 5 · 3 · 1 and they still are, so no shop's rating moves because the
 * interface changed. New comments never write this field — it is read-only history.
 */
export function legacyScore(reaction: unknown): Score | null {
  if (reaction === 'love') return 5
  if (reaction === 'fine') return 3
  if (reaction === 'bad') return 1
  return null
}

/**
 * One comment's score, whichever way it was written: the stored `score` when there is one,
 * otherwise the score its old reaction stood for. `null` = nothing readable, which is counted
 * as nothing rather than as a guess.
 */
export function scoreOfReview(review: { score?: unknown; reaction?: unknown } | null | undefined): Score | null {
  if (!review) return null
  if (isScore(review.score)) return review.score
  return legacyScore(review.reaction)
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
  /**
   * 1–5 stars, the whole rating. A comment written before stars existed is read as the score its
   * reaction always meant (5 · 3 · 1 — `legacyScore`), so an old comment keeps the weight it was
   * given and no shop's average moves because the interface changed.
   */
  score: Score
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
  /** How many comments gave each score: `stars[0]` is 1★ … `stars[4]` is 5★. */
  stars: number[]
  /** Sum of the scores — stored on the product, never recomputed from a truncated page of reviews. */
  scoreSum: number
  /** null for a product nobody has commented on: never a flattering 0, never a fake 5. */
  average: number | null
  /** The chips that came up most, most common first. */
  topTags: string[]
}

/** The numbers for the reviews we actually loaded (`summaryFromAggregate` is for the counters). */
export function summaryOf(reviews: Review[], topTagCount = 3): ReviewSummary {
  const stars = [0, 0, 0, 0, 0]
  let scoreSum = 0
  const tagCounts = new Map<string, number>()
  for (const review of reviews) {
    const score = scoreOfReview(review)
    // A comment nobody can score counts toward nothing — one comment fewer is better than a guess.
    if (score === null) continue
    stars[score - 1] += 1
    scoreSum += score
    for (const tag of review.tags) tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1)
  }
  const count = stars.reduce((total, n) => total + n, 0)
  const topTags = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, topTagCount)
    .map(([tag]) => tag)
  return { count, stars, scoreSum, average: averageOf(scoreSum, count), topTags }
}

/**
 * The average of whole stars, rounded to one decimal the way a shop's rating is rounded
 * (`functions/sellerStats.js:ratingFromReviews`) — from `sum * 10 / count`, not from the float
 * quotient. So 87 over 20 comments reads 4.4 here and 4.4 on the shop's own line, rather than 4.3
 * on one and 4.4 on the other: a product and its shop can never print two different averages of the
 * same comments. `null` for nothing to average — never a 0 that would render as "★ 0.0".
 */
function averageOf(scoreSum: number, count: number): number | null {
  return count > 0 ? Math.round((scoreSum * 10) / count) / 10 : null
}

/**
 * A product's counters as they live on its document: how many comments, and what those comments
 * add up to. That is enough for the header without loading a single comment. Tolerates junk and
 * absence — a product nobody has commented on carries no counters, which is not an error.
 */
export function summaryFromAggregate(count: unknown, scoreSum: unknown): ReviewSummary {
  const safeCount = Math.max(0, Math.floor(Number(count) || 0))
  const safeSum = Math.max(0, Math.floor(Number(scoreSum) || 0))
  return {
    count: safeCount,
    stars: [0, 0, 0, 0, 0],
    scoreSum: safeSum,
    average: averageOf(safeSum, safeCount),
    topTags: [],
  }
}

/**
 * The one line a product is allowed to say about itself — honest at every size:
 * "No comments yet" · "★ 5.0 from 1 rating" · "★ 4.7 from 23 ratings".
 */
export function summaryLabel(summary: ReviewSummary): string {
  if (summary.count === 0 || summary.average === null) return 'No comments yet'
  if (summary.count === 1) return `★ ${averageLabel(summary)} from 1 rating`
  return `★ ${averageLabel(summary)} from ${summary.count} ratings`
}

/** "4.7" with one decimal, or '' — never "0.0" for a product nobody has commented on. */
export function averageLabel(summary: ReviewSummary): string {
  return summary.average === null ? '' : summary.average.toFixed(1)
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

/** What a post is checked against: the stars, the order that proves it, and words that fit. */
export interface ReviewDraft {
  score?: unknown
  orderId?: unknown
  text?: unknown
}

/** Enough to post: a star, the order that proves the purchase, and words that fit. */
export function canPost(input: ReviewDraft): boolean {
  if (!isScore(input.score)) return false
  if (typeof input.orderId !== 'string' || input.orderId.trim().length === 0) return false
  // Too long is *rejected*, never quietly cut in half — nobody should find their sentence
  // truncated after they posted it.
  if (typeof input.text === 'string' && input.text.trim().length > 400) return false
  return true
}

/** Why it could not be posted, in the buyer's words — '' when it can. */
export function postBlocker(input: ReviewDraft): string {
  if (!isScore(input.score)) return 'Tap a star first.'
  if (typeof input.orderId !== 'string' || input.orderId.trim().length === 0) {
    return 'This comment has to be attached to the order that proves it — open it from your orders.'
  }
  if (typeof input.text === 'string' && input.text.trim().length > 400) {
    return 'Your comment is a little long — trim it and post again.'
  }
  return ''
}

// ── Asking for a rating ──────────────────────────────────────────────────────────────────────

/** How long a delivery waits before the quiet nudge is allowed. The receipt tap goes first. */
export const RATING_NUDGE_DAYS = 3

export interface RatingAskInput {
  /** The order's status. Only a delivery is worth asking about. */
  orderStatus?: string
  /**
   * When the order last moved — the delivery date, read the same way the returns flow reads it
   * (the rules treat the last write to a fulfilled order as the hand-over).
   */
  deliveredAtMs?: number
  /** Has this buyer already rated this product? Then there is nothing left to ask. */
  hasRated: boolean
  /** We have asked about *this* order before — answered, dismissed, or they tapped through it. */
  alreadyAsked?: boolean
  /** Your own listing: nobody rates their own product. */
  isSeller?: boolean
  now?: number
}

/**
 * The one question every asking surface asks first: is there anything left to ask?
 *
 * Asked in one place so a buyer can never be nagged — not by the delivery bubble, not by the
 * thread nudge, not by the seller's request, not by the three-day fallback. Each of those adds its
 * own condition on top (already in the right place, already a few days old); none of them may
 * loosen these.
 */
export function canAskForRating(input: RatingAskInput): boolean {
  if (input.isSeller) return false
  if (input.orderStatus !== 'fulfilled') return false
  if (input.hasRated) return false
  if (input.alreadyAsked) return false
  return true
}

/**
 * The "Takes 5 seconds." fallback: only a delivery that is already a few days old and still
 * unanswered. This is the *last* ask, so it never fires while a fresher question is on screen —
 * the bubble and the thread have both had their chance by then.
 */
export function shouldNudgeRating(input: RatingAskInput): boolean {
  if (!canAskForRating(input)) return false
  if (!input.deliveredAtMs || !Number.isFinite(input.deliveredAtMs)) return false
  const now = input.now ?? Date.now()
  return now - input.deliveredAtMs >= RATING_NUDGE_DAYS * 24 * 60 * 60 * 1000
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
