/**
 * Who a person is: their age band and their gender.
 *
 * Recommendations are the reason this exists. A "you might like this" needs *some* idea of who is
 * asking, and rachett had none — the empty bag could only ever say "Bought near you", because
 * anything narrower would have been inventing a fact about somebody we had never asked
 * (DATA_COLLECTION.md §10). So we ask, once, plainly — at sign-up, on the store setup screen, and
 * one time for anybody already here.
 *
 * Three decisions worth stating out loud:
 *
 *  - **A band, not a birthday.** The band is what a recommender actually uses, it never rots the way
 *    a stored `age: 27` does, and no month or day of anybody's life ends up in a database that has
 *    no use for it. `AGE_OPTIONS` is the only place that would change.
 *  - **Answering is required; agreeing is not.** The ask cannot be walked past — but "Prefer not to
 *    say" is a real answer to both questions. Forcing somebody to pick a gender they do not have,
 *    or an age that is not theirs, produces a false fact, and a false fact is worse than a missing
 *    one: it would quietly aim recommendations at the wrong person. "They were asked and chose not
 *    to say" is honest, and it is recorded as a decision rather than as an empty field.
 *  - **It stays on the person's own document.** Age and gender live on `users/{uid}` and nowhere
 *    else — never on an order, never in a seller's copy of a buyer, never on anything public.
 *
 * Pure on purpose (no React, no Firestore): `_demographics_check.cjs` checks it.
 */

/** What a person told us about their age. `'undisclosed'` is a decision, not a missing answer. */
export type AgeAnswer = 'under-18' | '18-24' | '25-34' | '35-44' | '45-54' | '55+' | 'undisclosed'

/** What a person told us about their gender. `'undisclosed'` is a decision, not a missing answer. */
export type GenderAnswer = 'female' | 'male' | 'other' | 'undisclosed'

/** One of the two questions, by name — used for whatever is still missing. */
export type DemographicsQuestion = 'age' | 'gender'

/** Which surface they answered on (mirrors `nameSource`). */
export type DemographicsSource = 'onboarding' | 'setup' | 'profile' | 'gate' | 'device-adopted' | ''

export interface DemographicsState {
  /** Their band, or '' if they have not answered this yet. */
  ageBand: AgeAnswer | ''
  /** Their answer, or '' if they have not answered this yet. */
  gender: GenderAnswer | ''
  /** When the ask was first put in front of them (ms). Informational — it drives the funnel. */
  askedAt: number
  /** When they answered *both* questions. This is the marker that stops the ask. */
  answeredAt: number
  source: DemographicsSource
}

export interface DemographicOption<T> {
  value: T
  label: string
}

/**
 * The bands, youngest first. `under-18` is deliberately one of them: rachett's terms say nothing
 * about a minimum age, so the honest options are "tell us you are younger" or force a lie. It is
 * also the only way that fact could ever be measured rather than assumed.
 */
export const AGE_OPTIONS: DemographicOption<AgeAnswer>[] = [
  { value: 'under-18', label: 'Under 18' },
  { value: '18-24', label: '18-24' },
  { value: '25-34', label: '25-34' },
  { value: '35-44', label: '35-44' },
  { value: '45-54', label: '45-54' },
  { value: '55+', label: '55 and over' },
  { value: 'undisclosed', label: 'Prefer not to say' },
]

/** Woman / Man / another way / rather not say. Every one of them is a usable answer. */
export const GENDER_OPTIONS: DemographicOption<GenderAnswer>[] = [
  { value: 'female', label: 'Woman' },
  { value: 'male', label: 'Man' },
  { value: 'other', label: 'Another way' },
  { value: 'undisclosed', label: 'Prefer not to say' },
]

const AGE_VALUES: string[] = AGE_OPTIONS.map(option => option.value)
const GENDER_VALUES: string[] = GENDER_OPTIONS.map(option => option.value)

export function emptyDemographics(): DemographicsState {
  return { ageBand: '', gender: '', askedAt: 0, answeredAt: 0, source: '' }
}

/** A stored band read back as an answer — anything we cannot vouch for reads as unanswered. */
export function readAgeAnswer(raw: unknown): AgeAnswer | '' {
  if (typeof raw !== 'string') return ''
  const tidy = raw.trim().toLowerCase()
  return AGE_VALUES.includes(tidy) ? (tidy as AgeAnswer) : ''
}

/** A stored gender read back as an answer — anything we cannot vouch for reads as unanswered. */
export function readGenderAnswer(raw: unknown): GenderAnswer | '' {
  if (typeof raw !== 'string') return ''
  const tidy = raw.trim().toLowerCase()
  return GENDER_VALUES.includes(tidy) ? (tidy as GenderAnswer) : ''
}

/** A whole `users/{uid}` document (or any object) read as our state. */
export function demographicsFrom(data: unknown): DemographicsState {
  const rec = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  const source = typeof rec.demographicsSource === 'string' ? (rec.demographicsSource as DemographicsSource) : ''
  return {
    ageBand: readAgeAnswer(rec.ageBand),
    gender: readGenderAnswer(rec.gender),
    askedAt: Number(rec.demographicsAskedAt) || 0,
    answeredAt: Number(rec.demographicsAt) || 0,
    source,
  }
}


/**
 * Have they answered both questions?
 *
 * Both, not either: half an answer is not a fact about anybody, and a recommender fed "25-34 and
 * nothing else" would be guessing about the other half. Their answer is only spent once both taps
 * are made — which is also what stops the ask.
 */
export function answeredDemographics(state: Partial<DemographicsState> | null | undefined): boolean {
  if (!state) return false
  const age = readAgeAnswer(state.ageBand)
  const gender = readGenderAnswer(state.gender)
  return Number(state.answeredAt) > 0 && age !== '' && gender !== ''
}

/** Should we still put the ask in front of them? */
export function needsDemographicsAsk(state: Partial<DemographicsState> | null | undefined): boolean {
  return !answeredDemographics(state)
}

/** Which of the two questions is still open — so the ask can point at the right one. */
export function missingQuestions(state: Partial<DemographicsState> | null | undefined): DemographicsQuestion[] {
  const missing: DemographicsQuestion[] = []
  if (readAgeAnswer(state?.ageBand) === '') missing.push('age')
  if (readGenderAnswer(state?.gender) === '') missing.push('gender')
  return missing
}

/** "25-34" -> "25-34" · "undisclosed" -> "Prefer not to say" · '' -> '' */
export function ageWords(value: unknown): string {
  const answer = readAgeAnswer(value)
  if (!answer) return ''
  return AGE_OPTIONS.find(option => option.value === answer)?.label || answer
}

/** "female" -> "Woman" · "undisclosed" -> "Prefer not to say" · '' -> '' */
export function genderWords(value: unknown): string {
  const answer = readGenderAnswer(value)
  if (!answer) return ''
  return GENDER_OPTIONS.find(option => option.value === answer)?.label || answer
}

/** "25-34, Woman" — what we hold, in the words they chose. '' when we hold nothing. */
export function demographicsWords(state: Partial<DemographicsState> | null | undefined): string {
  return [ageWords(state?.ageBand), genderWords(state?.gender)].filter(Boolean).join(', ')
}

/**
 * The profile card's line: what we keep, said as a fact with a reason — never as a score. A missing
 * answer says so plainly rather than pretending we do not ask.
 */
export function demographicsSummary(state: Partial<DemographicsState> | null | undefined): string {
  const words = demographicsWords(state)
  if (answeredDemographics(state)) return `${words} — saved on your account, used to pick what to show you.`
  if (words) return `${words} — one of the two is still missing.`
  return 'Not answered yet — we ask once, so recommendations are not a guess.'
}

/** What is still missing, in the words the ask uses. '' when nothing is. */
export function askPrompt(state: Partial<DemographicsState> | null | undefined): string {
  const missing = missingQuestions(state)
  if (missing.length === 0) return ''
  if (missing.length === 2) return 'Pick your age group and how you identify to carry on.'
  return missing[0] === 'age'
    ? 'Pick your age group to carry on.'
    : 'Pick how you identify to carry on.'
}

/**
 * The Firestore patch for an answer — the exact five fields, in one place, so what we store cannot
 * drift from what `demographicsFrom` reads back.
 */
export function demographicsPatch(state: DemographicsState): Record<string, unknown> {
  return {
    ageBand: state.ageBand,
    gender: state.gender,
    demographicsAskedAt: Number(state.askedAt) || 0,
    demographicsAt: Number(state.answeredAt) || 0,
    demographicsSource: state.source,
  }
}

/**
 * The recommendation seam.
 *
 * A recommender asks "who is this for?" and gets either an audience or nothing at all — never a
 * guess. `null` means we know nothing about this person (or they chose not to say), and the caller
 * must fall back to what it can honestly say ("Bought near you") rather than assume.
 */
export function recommendationAudience(
  state: Partial<DemographicsState> | null | undefined,
): { ageBand: AgeAnswer; gender: GenderAnswer } | null {
  const ageBand = readAgeAnswer(state?.ageBand)
  const gender = readGenderAnswer(state?.gender)
  if (ageBand === '' || gender === '') return null
  // "Prefer not to say" is an answer, but it is not an audience: there is nothing to aim at.
  if (ageBand === 'undisclosed' || gender === 'undisclosed') return null
  return { ageBand, gender }
}

// ── the device copy, for somebody with no account yet ────────────────────────────────────────
// The same shape of record as `buyerNameDevice.ts`, for the same reason: the onboarding ask happens
// for people who are still "just looking", and a visitor who then signs in must not be asked the
// same two questions again. It is written before an account exists, read back on the next visit,
// and adopted by the account on their first sign-in.

export interface DeviceDemographics {
  ageBand: AgeAnswer | ''
  gender: GenderAnswer | ''
  /** When they answered (ms). */
  at: number
}

/** Read whatever is in device storage as a record. Junk, or a half answer, is simply forgotten. */
export function parseDeviceDemographics(raw: unknown): DeviceDemographics | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null

  const rec = parsed as Partial<DeviceDemographics>
  const ageBand = readAgeAnswer(rec.ageBand)
  const gender = readGenderAnswer(rec.gender)
  // The same gate a fresh answer passes: half an answer is not a record, so it is not kept.
  if (ageBand === '' || gender === '') return null

  const at = Number(rec.at)
  return { ageBand, gender, at: Number.isFinite(at) && at > 0 ? at : Date.now() }
}

/** What to write back. Always a whole answer — never half of one. */
export function serializeDeviceDemographics(rec: DeviceDemographics): string {
  const at = Number(rec.at)
  return JSON.stringify({
    ageBand: readAgeAnswer(rec.ageBand),
    gender: readGenderAnswer(rec.gender),
    at: Number.isFinite(at) && at > 0 ? at : Date.now(),
  })
}

/** A device record read as account-shaped state, so everything downstream behaves the same. */
export function deviceDemographicsToState(rec: DeviceDemographics | null): DemographicsState {
  if (!rec) return emptyDemographics()
  const ageBand = readAgeAnswer(rec.ageBand)
  const gender = readGenderAnswer(rec.gender)
  const whole = ageBand !== '' && gender !== ''
  return {
    ageBand,
    gender,
    askedAt: whole ? rec.at : 0,
    answeredAt: whole ? rec.at : 0,
    source: 'device-adopted',
  }
}
