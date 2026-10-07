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
 * The second copy is `DIAL_CODES`: `src/countryCodes.ts` is the list the picker shows, so the server
 * must be able to *read* every dial code on it. One it cannot recognise is a seller whose own
 * number comes back as "missing its country code" — the screen accepted it, the send endpoint
 * refused it, and the button is dead. `_otp_check.cjs` compares the two lists and the two verdicts,
 * so neither can drift.
 *
 * Kept deliberately tiny: the numbering plan we serve, every code the picker can offer, a sane range
 * everywhere else, and the trunk-zero / pasted-international habits people actually have.
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

/**
 * Every dial code the picker can offer — the server's copy of `src/countryCodes.ts`, reduced to the
 * digits a number starts with (`'+1-684'` is `'+1684'`).
 *
 * `PHONE_RULES` above is where we have a length to insist on. This is the far longer list of
 * countries we must still be able to *read*: a number from a country with no rule is measured with
 * `FALLBACK_LENGTHS` — the same generous range the browser uses — and Yoola has the final word on
 * whether it can be texted. Refusing a code the picker offers is the one outcome that cannot be
 * right, because the screen has already told the seller their number is fine.
 */
export const DIAL_CODES = [
  '+1', '+7', '+20', '+27', '+30', '+31', '+32', '+33',
  '+34', '+36', '+39', '+40', '+41', '+43', '+44', '+45',
  '+46', '+47', '+48', '+49', '+51', '+52', '+53', '+54',
  '+55', '+56', '+57', '+58', '+60', '+61', '+62', '+63',
  '+64', '+65', '+66', '+81', '+82', '+84', '+86', '+90',
  '+91', '+92', '+93', '+94', '+95', '+98', '+211', '+212',
  '+213', '+216', '+218', '+220', '+221', '+222', '+223', '+224',
  '+225', '+226', '+227', '+228', '+229', '+230', '+231', '+232',
  '+233', '+234', '+235', '+236', '+237', '+238', '+240', '+241',
  '+242', '+243', '+244', '+245', '+248', '+249', '+250', '+251',
  '+252', '+253', '+254', '+255', '+256', '+257', '+258', '+260',
  '+261', '+263', '+264', '+265', '+266', '+267', '+268', '+269',
  '+291', '+297', '+351', '+352', '+353', '+354', '+355', '+356',
  '+357', '+358', '+359', '+370', '+371', '+372', '+373', '+374',
  '+375', '+376', '+377', '+380', '+381', '+382', '+385', '+386',
  '+387', '+389', '+420', '+421', '+423', '+501', '+502', '+503',
  '+504', '+505', '+506', '+507', '+509', '+591', '+592', '+593',
  '+595', '+597', '+598', '+673', '+675', '+679', '+850', '+855',
  '+856', '+880', '+886', '+960', '+961', '+962', '+963', '+964',
  '+965', '+966', '+967', '+968', '+970', '+971', '+972', '+973',
  '+974', '+975', '+976', '+977', '+992', '+993', '+994', '+995',
  '+996', '+998', '+1242', '+1246', '+1264', '+1268', '+1345', '+1441',
  '+1473', '+1684', '+1767', '+1809', '+1868', '+1876',
]

/** Longest first, so "+256" is never mistaken for "+2" when reading a pasted number. */
const DIAL_CODES_BY_LENGTH = [...DIAL_CODES].sort((a, b) => b.length - a.length)

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
 *
 * Two details decide whether a real seller gets an SMS:
 *
 *  - the country code is the *longest* match, so a Grenadian `+1 473 …` is read as Grenada and not
 *    as a twelve-digit American number;
 *  - a country we have no length rule for is measured with `FALLBACK_LENGTHS` rather than refused.
 *    The picker offers those countries, so refusing one is a button that can never work — the
 *    screen said yes and this said no. A number that matches no dial code at all still gets the
 *    honest answer, because that is the case a person can actually fix.
 */
export function validateIntl(raw) {
  const digits = String(raw || '').replace(/\D/g, '')
  if (!digits) return { ok: false, message: 'Enter your phone number.' }

  const dial = DIAL_CODES_BY_LENGTH.find((d) => digits.startsWith(d.slice(1)))
  if (!dial) {
    return { ok: false, message: 'That number is missing its country code — start with + and the country code.' }
  }

  const national = digits.slice(dial.length - 1)
  const exactLengths = PHONE_RULES[dial]
  const lengths = exactLengths || FALLBACK_LENGTHS
  if (!lengths.includes(national.length)) {
    const wanted = lengths.length === 1 ? `${lengths[0]} digits` : lengths.join(' or ') + ' digits'
    return {
      ok: false,
      message: exactLengths
        ? `${dial} numbers are ${wanted} — you typed ${national.length}.`
        : `${dial} numbers are usually ${FALLBACK_LENGTHS[0]}–${FALLBACK_LENGTHS[FALLBACK_LENGTHS.length - 1]} digits — you typed ${national.length}.`,
    }
  }

  return { ok: true, e164: `+${digits}`, dial, national }
}
