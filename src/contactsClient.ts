/**
 * Contacts, on the person's terms.
 *
 * The browser's Contact Picker is the only web API that can read a phone's address book, and it
 * only works after a tap — never in the background. That is the right shape for this: the person
 * opens the picker, chooses what to share, and can close it without sharing anything.
 *
 * What we send: the selected numbers, once, to `/api/contacts/match`.
 * What we keep: a consent timestamp and a count. Not the address book, and not the numbers.
 *
 * This file is the browser side only. The server turns each number into the same one-way key the
 * phone ledger uses before it looks anything up (`api/_lib/contacts.js`).
 */
import { OTP_BASE } from './otpClient'
import { COUNTRY_CODES } from './countryCodes'

export const MAX_CONTACT_PHONES = 5000

export type ContactMatch = {
  uid: string
  name: string
  businessName: string
  slug: string
}

export type ContactLookupResult =
  | { ok: true; matched: ContactMatch[]; checked: number }
  | { ok: false; error: string }

export type PickResult =
  | { ok: true; phones: string[] }
  | { ok: false; error: string; cancelled: boolean }

type ContactsManager = {
  select: (
    properties: string[],
    options?: { multiple?: boolean },
  ) => Promise<Array<Record<string, string[]>>>
}

function contactsManager(): ContactsManager | null {
  if (typeof navigator === 'undefined') return null
  const manager = (navigator as Navigator & { contacts?: ContactsManager }).contacts
  return manager && typeof manager.select === 'function' ? manager : null
}

/** Can this browser open the phone's address book? Android Chrome can; most desktops cannot. */
export function contactPickerAvailable(): boolean {
  return contactsManager() !== null
}

/**
 * Open the picker. A closed picker is **not** an error to apologise for — it is somebody
 * choosing not to share, so it comes back as `cancelled` and the screen says nothing was sent.
 */
export async function pickContactPhones(): Promise<PickResult> {
  const manager = contactsManager()
  if (!manager) {
    return {
      ok: false,
      cancelled: false,
      error: 'This browser cannot open your phone book. On Android Chrome, try again from there — or invite a friend with your link.',
    }
  }

  try {
    const rows = await manager.select(['tel'], { multiple: true })
    const seen = new Set<string>()
    for (const row of rows) {
      const numbers = Array.isArray(row?.tel) ? row.tel : []
      for (const raw of numbers) {
        const number = String(raw || '').trim()
        if (number) seen.add(number)
        if (seen.size >= MAX_CONTACT_PHONES) break
      }
      if (seen.size >= MAX_CONTACT_PHONES) break
    }
    return { ok: true, phones: [...seen] }
  } catch (err) {
    const name = err && typeof err === 'object' && 'name' in err ? String((err as { name?: string }).name) : ''
    if (name === 'AbortError' || name === 'NotAllowedError') {
      return {
        ok: false,
        cancelled: true,
        error: name === 'NotAllowedError'
          ? 'Contacts were not allowed. You can try again here, or change the permission in your phone settings.'
          : 'Nothing was shared.',
      }
    }
    return {
      ok: false,
      cancelled: false,
      error: 'We could not open your phone book. Try again, or invite a friend with your link.',
    }
  }
}

/**
 * The dial code of a full phone number, longest match first — `+256771…` must be Uganda, not a
 * shorter code that merely shares its first digits. Empty when the number carries no plus.
 */
export function defaultDialFor(phone: string | null | undefined): string {
  const digits = String(phone || '').replace(/\D/g, '')
  if (!digits) return ''
  let found = ''
  for (const country of COUNTRY_CODES) {
    const dial = country.dialCode.replace(/\D/g, '')
    if (dial && digits.startsWith(dial) && dial.length > found.replace(/\D/g, '').length) {
      found = country.dialCode
    }
  }
  return found
}

const CONTACT_ERROR = 'We could not check those contacts just now. Please try again.'
const SIGNED_OUT = 'Please sign in again to find your friends.'

function stringOf(value: unknown, max = 80): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

/** Pure: turn a response from the contact endpoint into something a screen can render. */
export function readContactMatchResponse(status: number, data: unknown): ContactLookupResult {
  const body = (data || {}) as {
    matched?: unknown
    checked?: unknown
    error?: unknown
  }
  if (status >= 200 && status < 300) {
    const rows = Array.isArray(body.matched) ? body.matched : []
    const matched: ContactMatch[] = []
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue
      const entry = row as Record<string, unknown>
      const uid = stringOf(entry.uid, 128)
      if (!uid) continue
      matched.push({
        uid,
        name: stringOf(entry.name, 60) || 'On rachett',
        businessName: stringOf(entry.businessName, 80),
        slug: stringOf(entry.slug, 80),
      })
    }
    return {
      ok: true,
      matched,
      checked: Math.max(0, Number(body.checked) || 0),
    }
  }
  return {
    ok: false,
    error: typeof body.error === 'string' && body.error ? body.error : CONTACT_ERROR,
  }
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json()
  } catch {
    return null
  }
}

/**
 * POST the selected numbers to the server for a one-time match. Requires a signed-in account
 * that has proved a phone number — the endpoint refuses anyone else.
 */
export async function findContacts(
  phones: string[],
  defaultDial: string,
  idToken: string,
): Promise<ContactLookupResult> {
  if (!idToken) return { ok: false, error: SIGNED_OUT }
  if (!Array.isArray(phones) || phones.length === 0) {
    return { ok: false, error: 'No contacts were shared.' }
  }
  if (phones.length > MAX_CONTACT_PHONES) {
    return { ok: false, error: `Share up to ${MAX_CONTACT_PHONES.toLocaleString('en-US')} contacts at once.` }
  }

  try {
    const res = await fetch(`${OTP_BASE}/api/contacts/match`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ phones, defaultDial }),
    })
    return readContactMatchResponse(res.status, await readJson(res))
  } catch {
    return { ok: false, error: CONTACT_ERROR }
  }
}

