/**
 * Phone numbers, the honest way.
 *
 * The app fills in the country code for you, so the person only types the national part — which
 * means we must know how long a national number is **per country**. Without that, "+256" + 8
 * digits sails through and the seller only discovers the mistake when no code ever arrives
 * (which is exactly what happened in setup).
 *
 * Pure (no React, no Firebase) so the rules are verified in Node by `_phone_check.cjs`.
 * Coverage is deliberately honest: exact lengths for the markets we serve, and a sane range
 * everywhere else — never block a country because we lack a rule. The SMS code stays the real
 * authority; a wrong number simply never receives it.
 */

/** How long the national part is, per dial code. More than one entry where a country varies. */
const PHONE_RULES: Record<string, number[]> = {
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

export interface PhoneCheck {
  ok: boolean
  /** The national digits as they should be stored (dial code NOT included). */
  digits: string
  /** Why it is wrong — in words a person can act on. */
  message?: string
  /** True when an exact country rule was used (rather than the fallback range). */
  exact: boolean
}

export function ruleFor(dialCode: string): number[] | null {
  return PHONE_RULES[String(dialCode || '').trim()] || null
}

/**
 * Strip spaces, dashes, dots and brackets — then undo the two habits that would otherwise fail
 * a length check: the **trunk zero** ("0771234567" is how everyone types it, but with +256
 * already there it must be "771234567"), and a **pasted international number**
 * ("+256 771…" or "256771…"), which we accept rather than scold.
 *
 * The country code is only removed when what's left looks plausible for that country, so a
 * national number that merely begins with the same digits is never damaged.
 */
export function normaliseNational(raw: string, dialCode?: string): string {
  let digits = String(raw || '').replace(/\D/g, '')
  const countryCode = String(dialCode || '').replace(/\D/g, '')

  if (countryCode && digits.startsWith(countryCode)) {
    const candidate = digits.slice(countryCode.length)
    const candidateWithoutZero = candidate.startsWith('0') ? candidate.slice(1) : candidate
    const lengths = ruleFor(String(dialCode)) || FALLBACK_LENGTHS
    if (lengths.includes(candidate.length)) digits = candidate
    else if (lengths.includes(candidateWithoutZero.length)) digits = candidateWithoutZero
  }

  // Then the trunk zero: "0771234567" is how everyone types it, but with +256 already in
  // place it has to become "771234567".
  return digits.startsWith('0') ? digits.slice(1) : digits
}

/** "+256771234567" — the number as the world dials it. */
export function formatFull(dialCode: string, digits: string): string {
  return `${dialCode}${digits}`
}

function wanted(lengths: number[]): string {
  const shown = lengths.length === 1 ? `${lengths[0]} digits` : `${lengths.slice(0, 6).join(' or ')} digits`
  return shown
}

/**
 * The check that was missing: a number that is the right length *for its country*.
 * The message names the country, the expected length, and what was actually typed.
 */
export function validatePhone(dialCode: string, raw: string, countryName?: string): PhoneCheck {
  const digits = normaliseNational(raw, dialCode)
  const exactLengths = ruleFor(dialCode)
  const lengths = exactLengths || FALLBACK_LENGTHS
  const exact = Boolean(exactLengths)
  const where = countryName ? `${countryName} numbers` : 'Numbers for this country'

  if (!digits) return { ok: false, digits, exact, message: 'Enter your phone number.' }
  if (lengths.includes(digits.length)) return { ok: true, digits, exact }

  return {
    ok: false,
    digits,
    exact,
    message: exact
      ? `${where} are ${wanted(lengths)} — you typed ${digits.length}.`
      : `${where} are usually 6–15 digits — you typed ${digits.length}.`,
  }
}

/** The shortest and longest a national number may be here — drives placeholders and hints. */
export function lengthRange(dialCode: string): { min: number; max: number } {
  const lengths = ruleFor(dialCode) || FALLBACK_LENGTHS
  return { min: Math.min(...lengths), max: Math.max(...lengths) }
}

/** The quiet line under the field, so the rule is known *before* it's broken. */
export function lengthHint(dialCode: string, countryName?: string): string {
  const lengths = ruleFor(dialCode)
  if (!lengths) return 'Type your number — we add the country code for you.'
  const where = countryName ? `${countryName} numbers are` : 'Numbers here are'
  return `${where} ${wanted(lengths)} — type it without the leading 0.`
}
