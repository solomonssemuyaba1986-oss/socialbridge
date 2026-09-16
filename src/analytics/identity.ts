/**
 * Who is doing the thing: a session, a device and — for the first page they ever
 * landed on — the channel that brought them.
 *
 * The stored shape is deliberately boring and storage-injectable, so the same
 * functions run in the browser (localStorage/sessionStorage) and in a Node
 * harness with fake stores (see the M1 verification script).
 *
 * Why a device id at all: signed-out visitors used to collapse into one literal
 * `'guest'` value, which made any funnel impossible. `anonymousId` stays the
 * same across sessions on that device, while `sessionId` rolls over after
 * 30 minutes of silence.
 */
export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export const ANON_ID_KEY = 'rachett_analytics_anon_id'
export const SESSION_KEY = 'rachett_analytics_session'
export const FIRST_TOUCH_KEY = 'rachett_analytics_first_touch'
export const OPTOUT_KEY = 'rachett_analytics_off'
export const SESSION_IDLE_MS = 30 * 60 * 1000

export interface FirstTouch {
  /** Channel that produced the very first visit on this device. */
  source: string
  referrer: string
  landing: string
  at: number
}

export interface SessionState {
  id: string
  startedAt: number
  lastAt: number
}

/** Base36 id — short enough for a Firestore field, long enough to never collide. */
export function randomId(size = 18): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let out = ''
  const cryptoObj = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined
  if (cryptoObj?.getRandomValues) {
    const bytes = new Uint8Array(size)
    cryptoObj.getRandomValues(bytes)
    for (let i = 0; i < size; i++) out += alphabet[bytes[i] % alphabet.length]
    return out
  }
  for (let i = 0; i < size; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)]
  return out
}

function readJson<T>(store: StorageLike, key: string): T | null {
  try {
    const raw = store.getItem(key)
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function writeJson(store: StorageLike, key: string, value: unknown): void {
  try {
    store.setItem(key, JSON.stringify(value))
  } catch {
    // storage full / blocked (private mode) — tracking must never break the app
  }
}

/** Stable per-device id, created on first use. */
export function getAnonymousId(store: StorageLike): string {
  const existing = (() => {
    try {
      return store.getItem(ANON_ID_KEY)
    } catch {
      return null
    }
  })()
  if (existing) return existing
  const fresh = `anon_${randomId()}`
  try {
    store.setItem(ANON_ID_KEY, fresh)
  } catch {
    // ignore — an unsaved id just means this visit is unattributable
  }
  return fresh
}

/**
 * Session id + rollover. Returns `isNew` so the caller can record `session_start`
 * exactly once per session (not once per page load).
 */
export function touchSession(store: StorageLike, now: number, entry: string): { session: SessionState; isNew: boolean } {
  const previous = readJson<SessionState>(store, SESSION_KEY)
  const expired = !previous || !previous.id || now - (previous.lastAt || 0) > SESSION_IDLE_MS
  const session: SessionState = expired
    ? { id: `s_${randomId()}`, startedAt: now, lastAt: now }
    : { id: previous.id, startedAt: previous.startedAt || now, lastAt: now }
  writeJson(store, SESSION_KEY, session)
  if (expired) writeJson(store, SESSION_KEY + '_entry', { entry, at: now })
  return { session, isNew: expired }
}

/** The channel recorded for the current session (what `session_start` reports). */
export function readSessionEntry(store: StorageLike): string | null {
  const raw = readJson<{ entry?: string }>(store, SESSION_KEY + '_entry')
  return raw?.entry || null
}

/**
 * First touch is written once and never overwritten — that's what makes
 * "acquisition source" honest even if the person browses for an hour before
 * ordering. `isNew` tells the caller whether to record `first_touch_captured`.
 */
export function captureFirstTouch(
  store: StorageLike,
  now: number,
  source: string,
  referrer: string,
  landing: string,
): { firstTouch: FirstTouch; isNew: boolean } {
  const existing = readJson<FirstTouch>(store, FIRST_TOUCH_KEY)
  if (existing?.source) return { firstTouch: existing, isNew: false }
  const firstTouch: FirstTouch = { source, referrer: referrer.slice(0, 300), landing: landing.slice(0, 300), at: now }
  writeJson(store, FIRST_TOUCH_KEY, firstTouch)
  return { firstTouch, isNew: true }
}

export function isOptedOut(store: StorageLike): boolean {
  try {
    return store.getItem(OPTOUT_KEY) === '1'
  } catch {
    return false
  }
}

export function writeOptOut(store: StorageLike, off: boolean): void {
  try {
    if (off) store.setItem(OPTOUT_KEY, '1')
    else store.removeItem(OPTOUT_KEY)
  } catch {
    // ignore
  }
}

/** In-memory store — used when a browser denies storage, and by tests. */
export function memoryStorage(seed: Record<string, string> = {}): StorageLike {
  const map = new Map<string, string>(Object.entries(seed))
  return {
    getItem: key => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key, value) => { map.set(key, value) },
    removeItem: key => { map.delete(key) },
  }
}
