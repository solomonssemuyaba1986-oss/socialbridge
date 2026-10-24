/**
 * The number a buyer pays from — read, normalised and described the same way everywhere.
 *
 * Two numbers that look different can be the same phone: `0771 234 567`, `+256771234567` and
 * `256771234567` are one wallet. Two that look similar can be different people. So this module
 * never guesses: it normalises, compares normalised values, and tells the screen whether the typed
 * number is the account's verified one, a number we saved earlier, or a new number that has not
 * been proven yet.
 *
 * Pure on purpose (no React, no Firestore): `_payment_phone_check.cjs` checks it.
 */

/** The national trunk prefix buyers type; pawaPay wants the country code instead. */
const DEFAULT_DIAL = '256'

/** Where this phone remembers the last number, when there is no account to keep it on. */
export const PAYMENT_PHONE_KEY = 'rachett_payment_phone'

export interface PaymentPhoneCheck {
  /** The number as pawaPay wants it: digits, country code, no trunk zero. */
  number: string
  /** Long enough to be a real mobile number (10–15 digits after normalising). */
  valid: boolean
  /** This is the number Firebase verified for the signed-in account. */
  matchesVerified: boolean
  /** This is the number this person used successfully before. */
  matchesSaved: boolean
  /** A saved number exists and the typed one is different. */
  changedFromSaved: boolean
  /** A verified number exists and the typed one is different. */
  changedFromVerified: boolean
}

/** Another number's country code, without symbols. Uganda unless the shop says otherwise. */
export function dialDigits(dial?: string | null): string {
  const digits = String(dial || '').replace(/\D/g, '')
  return digits || DEFAULT_DIAL
}

/**
 * "0771 234 567" / "+256 771 234 567" / "771234567" → "256771234567".
 *
 * A leading zero is the buyer's national trunk prefix and is removed. A number already carrying
 * its country code is left alone. A number with neither gets the shop's country code, which is the
 * only sensible reading of "0771…" at a Ugandan checkout.
 */
export function normalizePhone(input: unknown, dial?: string | null): string {
  const digits = String(input === null || input === undefined ? '' : input).replace(/\D/g, '')
  if (!digits) return ''
  const country = dialDigits(dial)
  if (digits.startsWith(country)) return digits
  if (digits.startsWith('0')) return `${country}${digits.replace(/^0+/, '')}`
  if (digits.length <= 10) return `${country}${digits}`
  return digits
}

/** The same number with a `+`, for wire requests and readable labels. */
export function internationalPhone(input: unknown, dial?: string | null): string {
  const number = normalizePhone(input, dial)
  return number ? `+${number}` : ''
}

/** "+256 771 234 567" — spaced for a person, never used as an identifier. */
export function displayPhone(input: unknown, dial?: string | null): string {
  const number = normalizePhone(input, dial)
  if (!number) return ''
  const country = dialDigits(dial)
  const rest = number.startsWith(country) ? number.slice(country.length) : number.slice(3)
  return `+${country} ${rest.replace(/(\d{3})(?=\d)/g, '$1 ')}`.trim()
}

/**
 * The same number with its middle hidden: "+256 771 *** 567". Enough for the buyer to recognise
 * their own wallet; not enough to become a contact list if a screenshot leaves the phone.
 */
export function maskPhone(input: unknown, dial?: string | null): string {
  const number = normalizePhone(input, dial)
  if (!number) return ''
  const country = dialDigits(dial)
  const visibleStart = `${country}${number.startsWith(country) ? number.slice(country.length, country.length + 3) : number.slice(3, 6)}`
  const visibleEnd = number.slice(-3)
  const hidden = '*'.repeat(Math.max(3, number.length - visibleStart.length - visibleEnd.length))
  return `+${visibleStart} ${hidden} ${visibleEnd}`.trim()
}

export function phonesMatch(left: unknown, right: unknown, dial?: string | null): boolean {
  const a = normalizePhone(left, dial)
  const b = normalizePhone(right, dial)
  return Boolean(a && b && a === b)
}

/** Everything the payment screen needs to be honest about the number in the box. */
export function comparePaymentPhone(
  typed: unknown,
  verifiedPhone: unknown,
  savedPhone: unknown,
  dial?: string | null,
): PaymentPhoneCheck {
  const number = normalizePhone(typed, dial)
  const verified = normalizePhone(verifiedPhone, dial)
  const saved = normalizePhone(savedPhone, dial)
  return {
    number,
    valid: /^\d{10,15}$/.test(number),
    matchesVerified: Boolean(number && verified && number === verified),
    matchesSaved: Boolean(number && saved && number === saved),
    changedFromSaved: Boolean(number && saved && number !== saved),
    changedFromVerified: Boolean(number && verified && number !== verified),
  }
}

/**
 * What to say under the number box. The wording never claims a number is verified when it is not:
 * an account phone is proven, a saved number was accepted once by the network, and a new number is
 * simply new.
 */
export function paymentPhoneHint(check: PaymentPhoneCheck, dial?: string | null): string {
  const dialWords = dialDigits(dial) === DEFAULT_DIAL ? '+256' : `+${dialDigits(dial)}`
  if (!check.number) {
    return `Type the number that will pay. We add ${dialWords} for you.`
  }
  if (!check.valid) {
    return 'That number looks short. Type it with a leading 0, or with the country code.'
  }
  if (check.matchesVerified) {
    return 'Verified with your account — this is the number your network knows.'
  }
  if (check.matchesSaved) {
    return 'Saved for next time. Change it if you are paying from another number.'
  }
  if (check.changedFromVerified) {
    return 'This is not your verified account number. We will try it, and save it once your network accepts the prompt.'
  }
  if (check.changedFromSaved) {
    return 'This is a different number from the one saved. We will save it after your network accepts the prompt.'
  }
  return 'We will save this number for next time only after your network accepts the prompt.'
}

export interface DevicePaymentPhone {
  phone: string
  at: number
}

/** A device record read from storage. Junk is forgotten, never passed on. */
export function parseDevicePaymentPhone(raw: unknown): DevicePaymentPhone | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const record = parsed as Partial<DevicePaymentPhone>
  const phone = normalizePhone(record.phone)
  if (!/^\d{10,15}$/.test(phone)) return null
  const at = Number(record.at)
  return { phone, at: Number.isFinite(at) && at > 0 ? at : Date.now() }
}

export function serializeDevicePaymentPhone(phone: unknown, at = Date.now()): string {
  const normalized = normalizePhone(phone)
  return JSON.stringify({
    phone: normalized,
    at: Number.isFinite(at) && at > 0 ? at : Date.now(),
  })
}
