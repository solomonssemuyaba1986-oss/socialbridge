/**
 * What a buyer is into — the categories they pick once, so the market can be aimed at them.
 *
 * This is deliberately a *category* list, not a taste profile: it uses the same shelf names a
 * seller chooses from (`categories.ts`), so what a buyer says here can be matched to what shops
 * actually sell without inventing a private vocabulary. The choices are optional, limited to
 * `MAX_INTERESTS`, and stored on the person's own `users/{uid}` document.
 *
 * The rules that matter:
 *  - **At most seven.** A long list stops being a signal and starts being a second catalogue.
 *  - **Only shelves that exist.** An unknown string is dropped on read and on write, so a renamed
 *    category can never become a phantom interest.
 *  - **Skipping is an answer.** `interestsAt` is written when they pick or skip, which is what stops
 *    the ask coming back. An empty list with a timestamp means "asked, chose none" — not "unanswered".
 *  - **No account, no problem.** The onboarding ask can happen before sign-in; the device copy is
 *    adopted onto `users/{uid}` at the first sign-in, exactly like the name and the age ask.
 *
 * Pure on purpose (no React, no Firestore): `_interests_check.cjs` checks it in Node.
 */
import { canonicalCategory, getMainCategories } from './categories'

/** Seven is enough to describe a shopper, and few enough to stay a signal. */
export const MAX_INTERESTS = 7

/** Which surface they picked on (mirrors `nameSource` / `demographicsSource`). */
export type InterestSource = 'onboarding' | 'profile' | 'device-adopted' | ''

export interface InterestsState {
  /** Canonical category names, in catalogue order, never more than `MAX_INTERESTS`. */
  interests: string[]
  /** When the ask was first put in front of them (ms). Informational — it drives the funnel. */
  askedAt: number
  /** When they answered or skipped. This is the marker that stops the ask. */
  answeredAt: number
  /** True when they deliberately chose none. Kept separately so "none" cannot read as "unasked". */
  skipped: boolean
  source: InterestSource
}

export interface InterestOption {
  /** The category name we store. It is the same string products carry. */
  value: string
  /** What a person reads. Kept separate so a display tweak never rewrites stored data. */
  label: string
  /** A quick visual handle; never stored. */
  emoji: string
}

/** A small, familiar handle per shelf. Unknown shelves simply get the generic tag. */
const INTEREST_EMOJI: Record<string, string> = {
  'rachett essentials': '🧺',
  'Fashion & Clothing': '👗',
  Youths: '🧢',
  'Beauty & Cosmetics': '💄',
  Perfume: '🌸',
  Jewelry: '💍',
  'Electronics & Gadgets': '📱',
  'Digital Products & Services': '💻',
  'Job & Work': '💼',
  Services: '🤝',
  'Home & Living': '🛋️',
  'Health & Wellness': '🌿',
  'Food & Beverages': '🍫',
  'Baby & Maternity': '🍼',
  'Sports & Outdoors': '⚽',
  Automotive: '🚗',
  'Industrial & Commercial': '🏭',
  'Second Hand / Used': '♻️',
  'Books & Stationery': '📚',
  'Pets & Pet Supplies': '🐾',
}

/** The shelves a buyer can pick from — the same object every seller picker reads. */
export const INTEREST_OPTIONS: InterestOption[] = getMainCategories().map(value => ({
  value,
  label: value,
  emoji: INTEREST_EMOJI[value] || '🏷️',
}))

const INTEREST_SET = new Set(INTEREST_OPTIONS.map(option => option.value))

/** A stored timestamp only counts when it is a real, positive number. */
function readAt(value: unknown): number {
  const at = Number(value)
  return Number.isFinite(at) && at > 0 ? at : 0
}

/** What a source field may say. Anything else means we do not know where it came from. */
function readSource(value: unknown): InterestSource {
  return value === 'onboarding' || value === 'profile' || value === 'device-adopted' ? value : ''
}

/**
 * Turn anything into the list we are willing to store: known shelves only, no duplicates, no more
 * than seven, in the catalogue's own order (so two identical picks always read back identically).
 */
export function readInterests(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const picked = new Set<string>()
  for (const raw of value) {
    if (typeof raw !== 'string') continue
    const name = canonicalCategory(raw.trim())
    if (INTEREST_SET.has(name)) picked.add(name)
  }
  return INTEREST_OPTIONS
    .filter(option => picked.has(option.value))
    .slice(0, MAX_INTERESTS)
    .map(option => option.value)
}

/** The blank state: asked nothing, answered nothing. */
export function emptyInterests(): InterestsState {
  return { interests: [], askedAt: 0, answeredAt: 0, skipped: false, source: '' }
}

/**
 * Read a `users/{uid}` document as an interests record.
 *
 * A document with no `interestsAt` is unanswered. A timestamp makes it answered even when the list
 * is empty, because "none of these" is a decision the person is allowed to make.
 */
export function interestsFrom(data: unknown): InterestsState {
  if (!data || typeof data !== 'object') return emptyInterests()
  const rec = data as Record<string, unknown>
  const interests = readInterests(rec.interests)
  const answeredAt = readAt(rec.interestsAt)
  if (!answeredAt) return emptyInterests()
  return {
    interests,
    askedAt: readAt(rec.interestsAskedAt),
    answeredAt,
    // A skip is only a skip when the list is actually empty. A stale `true` beside real picks would
    // otherwise say the opposite of what the person chose.
    skipped: interests.length === 0 && rec.interestsSkipped === true,
    source: readSource(rec.interestsSource),
  }
}

/** Has this person answered — with shelves, or with a deliberate skip? */
export function answeredInterests(state: InterestsState | null | undefined): boolean {
  return Number(state?.answeredAt) > 0
}

/** The ask is still owed. Optional does not mean forgotten, so it is asked once. */
export function needsInterestsAsk(state: InterestsState | null | undefined): boolean {
  return !answeredInterests(state)
}

/** The Firestore fields. Kept in one place so what we write and what we read cannot drift. */
export function interestsPatch(state: InterestsState): Record<string, unknown> {
  return {
    interests: state.interests,
    interestsAskedAt: Number(state.askedAt) || 0,
    interestsAt: Number(state.answeredAt) || 0,
    interestsSkipped: state.skipped,
    interestsSource: state.source,
  }
}

/** Add or remove one shelf, refusing an eighth without throwing away the first seven. */
export function toggleInterest(current: string[], value: string): string[] {
  const list = readInterests(current)
  if (list.includes(value)) return list.filter(item => item !== value)
  if (list.length >= MAX_INTERESTS) return list
  return readInterests([...list, value])
}

/** Where a person is in the picker: "3 of 7 picked", said in words. */
export function interestsCountLabel(count: number): string {
  const picked = Math.max(0, Math.min(MAX_INTERESTS, Math.floor(Number(count) || 0)))
  return `${picked} of ${MAX_INTERESTS} picked`
}

/** Read the choices back to the person in their own words. */
export function interestsSummary(state: InterestsState | null | undefined): string {
  const list = readInterests(state?.interests)
  if (list.length > 0) return `You picked ${list.join(', ')}.`
  if (answeredInterests(state) || state?.skipped) {
    return 'You skipped this. Pick a few shelves any time and your market will follow them.'
  }
  return 'No interests picked yet. Pick up to seven and we will aim the market at them.'
}

// ── the device copy, for somebody with no account yet ────────────────────────────────────────
// The same shape of record as `buyerNameDevice.ts` and `demographicsDevice.ts`: onboarding can
// happen before sign-in, and a visitor who then signs in must not be asked the same question again.

export interface DeviceInterests {
  interests: string[]
  /** True when they tapped Skip rather than picking none one by one. */
  skipped: boolean
  /** When they answered (ms). */
  at: number
}

/** Read whatever is in device storage as a record. Junk, or no answer, is simply forgotten. */
export function parseDeviceInterests(raw: unknown): DeviceInterests | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null

  const rec = parsed as Partial<DeviceInterests>
  const interests = readInterests(rec.interests)
  const at = readAt(rec.at)
  if (!at) return null
  // An empty list is only a record when it was a deliberate skip; otherwise there is no answer.
  if (interests.length === 0 && rec.skipped !== true) return null
  return { interests, skipped: interests.length === 0, at }
}

/** What to write back. Always a complete answer — seven picks, fewer, or a deliberate skip. */
export function serializeDeviceInterests(rec: DeviceInterests): string {
  const interests = readInterests(rec.interests)
  return JSON.stringify({
    interests,
    skipped: interests.length === 0 && rec.skipped === true,
    at: readAt(rec.at) || Date.now(),
  })
}

/** A device record read as account-shaped state, so everything downstream behaves the same. */
export function deviceInterestsToState(rec: DeviceInterests | null): InterestsState {
  if (!rec) return emptyInterests()
  const interests = readInterests(rec.interests)
  return {
    interests,
    askedAt: rec.at,
    answeredAt: rec.at,
    skipped: interests.length === 0,
    source: 'device-adopted',
  }
}

