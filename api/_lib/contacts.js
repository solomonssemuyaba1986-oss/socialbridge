/**
 * Contact discovery without a contact list.
 *
 * The only thing this file lets leave a request is a match: "one of the numbers you have is
 * attached to this account". The numbers themselves are not returned, stored, or logged. That is
 * possible because the `phones/{phoneKey}` ledger is already keyed by an HMAC of the number
 * (`phoneKey` in `otp.js`), and the same key is computed here for each selected contact.
 *
 * Three guards make the endpoint boringly safe to operate:
 *   - only a signed-in account with a proved phone may call it;
 *   - a per-account cooldown and daily ceiling, so it cannot be used to sweep phone numbers;
 *   - a hard cap on how many contacts one request may carry.
 *
 * Pure decisions live here so `_account_strength_check.cjs` can prove them without a database.
 */
import { validateIntl } from './phone.js'
import { phoneKey } from './otp.js'

export const MAX_CONTACTS = 5000
export const MAX_MATCHES = 200
export const CONTACT_CONSENT_VERSION = '2026-10-24'

export const CONTACT_LIMITS = {
  cooldownMs: 20 * 1000,
  hourMs: 60 * 60 * 1000,
  dayMs: 24 * 60 * 60 * 1000,
  hourMax: 3,
  dayMax: 3,
}

export const CONTACT_LOOKUP_MESSAGES = {
  cooldown: 'A contact check just finished — give it a moment, then try again.',
  hourly: 'That is three contact checks this hour. Try again a little later.',
  daily: 'You have checked your contacts three times today. Try again tomorrow.',
}

function digitsOf(value) {
  return String(value || '').replace(/\D/g, '')
}

/**
 * One contact number, reduced to E.164 — or '' when it is not a number we can look up.
 *
 * A full international number is read as itself. A number without a country code (the way many
 * phone books store local entries) is read against `defaultDial`, which is the caller's own
 * verified country. Trunk zeros are removed first, the same habit `src/phone.ts` handles.
 */
export function normaliseContact(raw, defaultDial = '') {
  const text = String(raw || '').trim()
  if (!text) return ''

  const direct = validateIntl(text)
  if (direct.ok) return direct.e164

  // The international prefix as many people still type it: 00256…
  const spaced = digitsOf(text)
  if (spaced.startsWith('00')) {
    const prefixed = validateIntl(`+${spaced.slice(2)}`)
    if (prefixed.ok) return prefixed.e164
  }

  const dialDigits = digitsOf(defaultDial)
  if (!dialDigits) return ''

  let national = digitsOf(text)
  if (!national) return ''
  if (national.startsWith(dialDigits) && national.length > dialDigits.length) {
    national = national.slice(dialDigits.length)
  }
  if (national.startsWith('0')) national = national.slice(1)
  if (!national) return ''

  const combined = validateIntl(`+${dialDigits}${national}`)
  return combined.ok ? combined.e164 : ''
}

/**
 * Deduplicated ledger keys for a batch of contacts. `checked` is the number of distinct valid
 * numbers, which is also the only number the endpoint may report back.
 */
export function contactKeys(phones, defaultDial, pepper) {
  const seen = new Set()
  for (const raw of Array.isArray(phones) ? phones.slice(0, MAX_CONTACTS) : []) {
    const e164 = normaliseContact(raw, defaultDial)
    if (e164) seen.add(e164)
    if (seen.size >= MAX_CONTACTS) break
  }
  return {
    checked: seen.size,
    keys: [...seen].map(e164 => phoneKey(e164, pepper)),
  }
}

/**
 * The per-account rails. Counts live on the same document as the last timestamp, and one
 * transaction decides and records them, so two taps a second apart cannot both pass.
 */
export function decideContactLookup(record, now = Date.now(), limits = CONTACT_LIMITS) {
  const current = record || {}
  const lastAt = Number(current.lastAt) || 0
  if (lastAt && now - lastAt < limits.cooldownMs) {
    return {
      allow: false,
      reason: 'cooldown',
      retryAfterSec: Math.max(1, Math.ceil((lastAt + limits.cooldownMs - now) / 1000)),
    }
  }

  let hourStart = Number(current.hourStart) || 0
  let hourCount = Number.isInteger(current.hourCount) ? current.hourCount : 0
  if (!hourStart || now - hourStart >= limits.hourMs) { hourStart = now; hourCount = 0 }

  let dayStart = Number(current.dayStart) || 0
  let dayCount = Number.isInteger(current.dayCount) ? current.dayCount : 0
  if (!dayStart || now - dayStart >= limits.dayMs) { dayStart = now; dayCount = 0 }

  if (hourCount >= limits.hourMax) {
    return {
      allow: false,
      reason: 'hourly',
      retryAfterSec: Math.max(1, Math.ceil((hourStart + limits.hourMs - now) / 1000)),
    }
  }
  if (dayCount >= limits.dayMax) {
    return {
      allow: false,
      reason: 'daily',
      retryAfterSec: Math.max(1, Math.ceil((dayStart + limits.dayMs - now) / 1000)),
    }
  }

  return {
    allow: true,
    reason: 'ok',
    retryAfterSec: 0,
    next: {
      lastAt: now,
      hourStart,
      hourCount: hourCount + 1,
      dayStart,
      dayCount: dayCount + 1,
    },
  }
}

/**
 * A public label that cannot smuggle a phone number, email or advert into the result. A display
 * name that is itself a number is not a name we should echo to somebody whose address book
 * happened to contain that number.
 */
export function safeProfileName(value, max = 60) {
  const text = typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, max)
    : ''
  if (!text) return ''
  if (text.includes('@')) return ''
  if (/https?:|www\.|\.com\b/i.test(text)) return ''
  if (/\d{6,}/.test(text)) return ''
  return text
}

function safeSlug(value) {
  const slug = typeof value === 'string' ? value.trim() : ''
  return /^[a-z0-9][a-z0-9-]{1,63}$/i.test(slug) ? slug : ''
}

/**
 * What a matched account may reveal to somebody who already has its number: a label, a shop link
 * if it has a public shop, and nothing else. No phone, no email, no buyer history.
 */
export function publicContactProfile(uid, user, seller) {
  const displayName = safeProfileName(user && user.displayName)
  const businessName = safeProfileName(seller && seller.businessName, 80)
  const slug = safeSlug(seller && seller.slug)
  return {
    uid: String(uid || ''),
    name: displayName || businessName || 'On rachett',
    businessName,
    slug,
  }
}

