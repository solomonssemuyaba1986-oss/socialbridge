/**
 * What we call a buyer.
 *
 * A seller must never read the word "Buyer" as somebody's name. Today that is exactly what a
 * phone-signup buyer shows as — the app never asks them, and only social sign-ins arrive with a
 * name at all. This module decides the *suggestion* (so nobody has to invent one), what a name is
 * allowed to be, and whether we should still be asking.
 *
 * Pure on purpose (no React, no Firestore): `_name_check.cjs` checks it. Same house rules as the
 * rest of rachett — a name is a label, the uid stays the identity, and the public form of a name
 * is the shortened one (`Aisha N.`), never a full name a stranger did not agree to publish.
 */
import { displayName } from './reviewUtils'

/** How long a name may be. Long enough for real names, short enough for a chat header. */
export const NAME_MAX = 24

export type NameSource = 'google' | 'email' | 'self' | ''

export interface NameSuggestion {
  /** Ready to show and ready to keep — '' when we genuinely have nothing to offer. */
  name: string
  source: NameSource
}

/** What we know about a buyer's name, as it lives on `users/{uid}`. */
export interface BuyerNameState {
  /** What we call them (the form they confirmed). */
  name: string
  source: NameSource
  /** When the one-time ask was first put in front of them. */
  askedAt: number
  /** When they answered it — accepted our suggestion or typed their own. Stops the asking. */
  confirmedAt: number
  /** They tapped "Later". We stop asking; the line in the Inbox header stays available. */
  skipped: boolean
}

export function emptyNameState(): BuyerNameState {
  return { name: '', source: '', askedAt: 0, confirmedAt: 0, skipped: false }
}

/** "john paul" → "John Paul" · "AISHA" → "Aisha" · "McDonald" stays "McDonald". */
export function titleCase(raw: string): string {
  return raw
    .split(' ')
    .map(word => {
      if (word.length <= 1) return word
      const rest = word.slice(1)
      // Flatten a word that is SHOUTING, but keep an inner capital (McDonald, DeSantis).
      const restOut = rest === rest.toUpperCase() ? rest.toLowerCase() : rest
      return word.charAt(0).toUpperCase() + restOut
    })
    .join(' ')
}

/**
 * Is this a name we can put in front of a seller? Tidied, human, and not a place to put a link or
 * a handle. Returns '' when it is not — the caller asks again rather than storing junk.
 */
export function cleanBuyerName(raw: unknown): string {
  if (typeof raw !== 'string') return ''

  // Invisible junk out, one line in. A name is not a paragraph.
  const withoutJunk = Array.from(raw.replace(/[\r\n\t]+/g, ' '), ch => {
    const code = ch.codePointAt(0) || 0
    return code < 32 || code === 127 ? ' ' : ch
  }).join('')

  const tidy = withoutJunk.replace(/\s+/g, ' ').trim()
  if (tidy.length === 0) return ''

  // Reject rather than silently cut: nobody should find their name shortened after saving it.
  if (Array.from(tidy).length > NAME_MAX) return ''
  // A name is not a contact or an advert.
  if (tidy.includes('@') || /https?:|www\.|\.com|\+\d{6,}/i.test(tidy)) return ''
  // It has to contain a letter ("12345" and "😀😀" are not names).
  if (!/\p{L}/u.test(tidy)) return ''
  // At least two characters: a single stray letter is almost always a slip.
  if (tidy.length < 2) return ''

  // "AISHA NABUKEERA" → "Aisha Nabukeera". Shouting is not a name choice.
  const letters = tidy.replace(/[^\p{L}]/gu, '')
  if (letters.length > 1 && letters === letters.toUpperCase() && letters !== letters.toLowerCase()) {
    return titleCase(tidy)
  }
  return tidy
}

/**
 * A name to put in front of them — never one we invented from a phone number.
 *
 * A social sign-in usually carries a full legal name, so we suggest the *shortened* form: that is
 * how they will appear publicly, and it is what they see in the strip, so accepting it is not a
 * surprise later. With only an email, the local part is the clue. With only a phone number, we
 * offer nothing and simply ask.
 */
export function suggestName(input: { displayName?: unknown; email?: unknown }): NameSuggestion {
  const fromAccount = cleanBuyerName(input.displayName)
  // Our suggestion is well-cased even when the account name is not ("john paul otim" is an
  // artefact of the sign-up, not a style choice) — and they can still overtype it.
  if (fromAccount) return { name: publicName(titleCase(fromAccount)), source: 'google' }

  if (typeof input.email === 'string') {
    const local = input.email.split('@')[0] || ''
    // aisha.nabukeera92 → aisha ; j_mwangi → j → rejected below if too short
    const parts = local.split(/[._\-+0-9]+/).filter(Boolean)
    const candidate = parts.find(part => /\p{L}{2,}/u.test(part)) || ''
    const tidy = cleanBuyerName(candidate ? candidate.charAt(0).toUpperCase() + candidate.slice(1) : '')
    if (tidy) return { name: tidy, source: 'email' }
  }

  return { name: '', source: '' }
}

/**
 * The name as strangers may see it: "Aisha N." — and "Verified buyer" when there is none.
 *
 * It runs the same gate as a *new* name (`cleanBuyerName`) first, so a stray "A", a handle or a
 * link stored by something older can never be shown as somebody's name.
 */
export function publicName(raw: unknown): string {
  const clean = cleanBuyerName(raw)
  if (!clean) return 'Verified buyer'
  return displayName(clean, 'Verified buyer')
}

/**
 * The label in front of a name wherever a person is shown. It never returns the bare word
 * "Buyer": that reads like something failed to load, and it tells a seller nothing about who is
 * asking for a delivery.
 */
export function nameLabel(raw: unknown): string {
  return publicName(raw)
}

/**
 * Should we still ask? Once they have answered — or tapped Later — never again. That is the whole
 * "one time thing": a marker on the account, not on this phone.
 */
export function needsNameAsk(state: Partial<BuyerNameState> | null | undefined): boolean {
  if (!state) return true
  if (Number(state.confirmedAt) > 0) return false
  if (state.skipped) return false
  return true
}

/** Have they told us (or accepted) a name? Drives "You appear as …" versus the ask. */
export function hasConfirmedName(state: Partial<BuyerNameState> | null | undefined): boolean {
  return Number(state?.confirmedAt) > 0 && cleanBuyerName(state?.name) !== ''
}

/** What to pre-fill the checkout form with: their confirmed name, else our suggestion. */
export function checkoutPrefill(
  state: Partial<BuyerNameState> | null | undefined,
  account: { displayName?: unknown; email?: unknown },
): NameSuggestion {
  const confirmed = cleanBuyerName(state?.name)
  if (confirmed) return { name: confirmed, source: (state?.source as NameSource) || 'self' }
  return suggestName(account)
}
