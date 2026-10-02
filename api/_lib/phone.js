/**
 * The server's copy of `src/phone.ts`.
 *
 * The browser and the server must agree on what a number *is*, or the screen accepts a number
 * the server refuses — a dead button nobody can explain. Two copies of one table is how the two
 * drift apart, so `_otp_check.cjs` compiles the TypeScript file and compares these functions to
 * it value-for-value. Change one, and that harness fails until you change the other.
 *
 * The server needs the naming plan, not the hints: `lengthRange` and `lengthHint` live in the
 * browser, where the field and its label are. What is shared — `PHONE_RULES`, `FALLBACK_LENGTHS`,
 * `ruleFor`, `normaliseNational`, `formatFull`, `validatePhone` — is compared to the compiled
 * TypeScript value-for-value and verdict-for-verdict. Change one, and that harness fails until you
 * change the other.
 *
 * Kept deliberately tiny: the numbering plan we serve, a sane range everywhere else, and the
 * trunk-zero / pasted-international habits people actually have.
 */

/** How long the national part is, per dial code. More than one entry where a country varies. */
export const PHONE_RULES = {
  '+256': [9],      // Uganda    — 0771234567 → 771234567
  '+254': [9],      // Kenya
  '+255': [9],      // Tanzania
  '+250': [9],      // Rwanda
  '+257': [8],      // Burundi
  '+211': [9],      // South Sudan
  '+243': [9],      // DR Congo
  '+242': [9],      // Congo
  '+234': [10],     // Nigeria
  '+233': [9],      // Ghana
  '+212': [9],      // Morocco
  '+20': [10],      // Egypt
  '+251': [9],      // Ethiopia
  '+27': [9],       // South Africa
  '+260': [9],      // Zambia
  '+263': [9],      // Zimbabwe
  '+258': [9],      // Mozambique
  '+91': [10],      // India
  '+44': [10],      // United Kingdom
  '+1': [10],       // United States / Canada
  '+971': [9],      // United Arab Emirates
  '+966': [9],      // Saudi Arabia
  '+49': [10, 11],  // Germany
  '+33': [9],       // France
  '+31': [9],       // Netherlands
  '+86': [11],      // China
  '+81': [10],      // Japan
  '+61': [9],       // Australia
}

/** Everything else: 6–15 digits is a plausible national number in *some* country. */
export const FALLBACK_LENGTHS = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15]

/** Longest first, so "+256" is never mistaken for "+2" when reading a pasted number. */
const DIAL_CODES_BY_LENGTH = Object.keys(PHONE_RULES).sort((a, b) => b.length - a.length)

export function ruleFor(dialCode) {
  return PHONE_RULES[String(dialCode || '').trim()] || null
}

/** The two habits that would otherwise fail a length check: the trunk zero, and a pasted number. */
export function normaliseNational(raw, dialCode) {
  let digits = String(raw || '').replace(/\D/g, '')
  const countryCode = String(dialCode || '').replace(/\D/g, '')

  if (countryCode && digits.startsWith(countryCode)) {
    const candidate = digits.slice(countryCode.length)
    const candidateWithoutZero = candidate.startsWith('0') ? candidate.slice(1) : candidate
    const lengths = ruleFor(dialCode) || FALLBACK_LENGTHS
    if (lengths.includes(candidate.length)) digits = candidate
    else if (lengths.includes(candidateWithoutZero.length)) digits = candidateWithoutZero
  }

  return digits.startsWith('0') ? digits.slice(1) : digits
}

export function formatFull(dialCode, digits) {
  return `${dialCode}${digits}`
}

export function validatePhone(dialCode, raw, countryName) {
  const digits = normaliseNational(raw, dialCode)
  const exactLengths = ruleFor(dialCode)
  const lengths = exactLengths || FALLBACK_LENGTHS
  const exact = Boolean(exactLengths)
  const where = countryName ? `${countryName} numbers` : 'Numbers for this country'

  if (!digits) return { ok: false, digits, exact, message: 'Enter your phone number.' }
  if (lengths.includes(digits.length)) return { ok: true, digits, exact }

  const wanted = lengths.length === 1 ? `${lengths[0]} digits` : `${lengths.slice(0, 6).join(' or ')} digits`
  return {
    ok: false,
    digits,
    exact,
    message: exact
      ? `${where} are ${wanted} — you typed ${digits.length}.`
      : `${where} are usually 6–15 digits — you typed ${digits.length}.`,
  }
}

/**
 * The server's own door: one full international number in, `{ ok, e164 }` out.
 *
 * Uses the *same* per-country table, so a length the browser would reject can never be sent to
 * Yoola from here. The country code is read from the front and removed, and the national part is
 * measured against that country's rule — which is exactly the check whose absence sent SMS to
 * eight-digit numbers that could never receive them.
 */
export function validateIntl(raw) {
  const digits = String(raw || '').replace(/\D/g, '')
  if (!digits) return { ok: false, message: 'Enter your phone number.' }

  const dial = DIAL_CODES_BY_LENGTH.find((d) => digits.startsWith(d.slice(1)))
  if (!dial) {
    return { ok: false, message: 'That number is missing its country code — start with + and the country code.' }
  }

  const national = digits.slice(dial.length - 1)
  const lengths = PHONE_RULES[dial]
  if (!lengths.includes(national.length)) {
    const wanted = lengths.length === 1 ? `${lengths[0]} digits` : lengths.join(' or ') + ' digits'
    return { ok: false, message: `${dial} numbers are ${wanted} — you typed ${national.length}.` }
  }

  return { ok: true, e164: `+${digits}`, dial, national }
}
