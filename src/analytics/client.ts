/**
 * The analytics client: queue → batch → one Firestore write.
 *
 * Everything here is best-effort by design. If storage is blocked, the network is
 * down, or a write fails, the app carries on — events either wait in a small
 * offline buffer or are dropped. Tracking never throws into the UI.
 *
 * Storage: `events` (create-any/read-none per firestore.rules) — the same
 * collection the older single-event writer used, so this ships with no rules
 * deploy. Batches are marked `schemaVersion: 2`; older docs have no such field.
 */
import { addDoc, collection, serverTimestamp, Timestamp } from 'firebase/firestore'
import { auth, db } from '../firebase'
import { getRole } from '../role'
import { currentUrl, detectSource } from './source'
import {
  ANON_ID_KEY,
  captureFirstTouch,
  getAnonymousId,
  isOptedOut,
  memoryStorage,
  readSessionEntry,
  touchSession,
  writeOptOut,
  type FirstTouch,
  type StorageLike,
} from './identity'
import {
  BATCH_MAX_WAIT_MS,
  buildBatch,
  capQueue,
  makeEvent,
  rawExpireAtMs,
  shouldFlush,
  type BatchContext,
  type PlatformInfo,
  type QueuedEvent,
} from './core'
import { isKnownEvent, type EventName, type EventProps } from './taxonomy'

const COLLECTION = 'events'
const QUEUE_KEY = 'rachett_analytics_queue'
const isDev = Boolean(import.meta.env?.DEV)
const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev'

/** Resolved at init. */
let anonymousId: string | null = null
let sessionId: string | null = null
let firstTouch: FirstTouch | null = null
let started = false
let currentRoute = '/'
let queue: QueuedEvent[] = []
let lastFlushAt = 0
let flushTimer: number | null = null
let flushing = false

function localStore(): StorageLike {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.getItem('rachett_analytics_probe')
      return window.localStorage
    }
  } catch {
    // private mode / blocked storage
  }
  return memoryStorage()
}

function sessionStore(): StorageLike {
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) return window.sessionStorage
  } catch {
    // ignore
  }
  return memoryStorage()
}

function platformInfo(): PlatformInfo {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined
  let tz = ''
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''
  } catch {
    // Intl unavailable — leave the timezone empty rather than guessing
  }
  return {
    ua: nav?.userAgent?.slice(0, 300) ?? '',
    lang: nav?.language ?? '',
    tz,
    screen: typeof window !== 'undefined' && window.screen ? `${window.screen.width}x${window.screen.height}` : '',
    standalone: typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(display-mode: standalone)').matches
      : false,
  }
}

function batchContext(): BatchContext {
  return {
    appVersion: APP_VERSION,
    sessionId: sessionId ?? 'unknown',
    anonymousId: anonymousId ?? 'unknown',
    userId: auth.currentUser?.uid ?? null,
    role: getRole(),
    firstTouch,
    platform: platformInfo(),
  }
}

function persistQueue(): void {
  try {
    if (queue.length === 0) localStore().removeItem(QUEUE_KEY)
    else localStore().setItem(QUEUE_KEY, JSON.stringify(queue))
  } catch {
    // ignore
  }
}

function loadQueue(): QueuedEvent[] {
  try {
    const raw = localStore().getItem(QUEUE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as QueuedEvent[]) : []
  } catch {
    return []
  }
}

function cancelTimer(): void {
  if (flushTimer !== null) {
    window.clearTimeout(flushTimer)
    flushTimer = null
  }
}

function scheduleFlush(): void {
  if (flushTimer !== null || typeof window === 'undefined') return
  flushTimer = window.setTimeout(() => {
    flushTimer = null
    void flushAnalytics('timer')
  }, BATCH_MAX_WAIT_MS)
}

function enqueue(event: QueuedEvent): void {
  queue = capQueue([...queue, event])
  if (isDev) console.log(`[analytics] ${event.n}`, event.p)
  if (shouldFlush(queue.length, lastFlushAt, Date.now())) void flushAnalytics('batch-full')
  else scheduleFlush()
}

/** Sends one batch; returns true when something was written. */
async function sendBatch(): Promise<boolean> {
  if (queue.length === 0 || isOptedOut(localStore())) return false
  const now = Date.now()
  const batch = buildBatch(queue, batchContext(), now)
  if (batch.count === 0) return false
  try {
    await addDoc(collection(db, COLLECTION), {
      ...batch,
      sentAt: serverTimestamp(),
      expireAt: Timestamp.fromMillis(rawExpireAtMs(now)),
    })
    queue = queue.slice(batch.count)
    lastFlushAt = now
    persistQueue()
    return true
  } catch (err) {
    // Offline or a rule said no — keep them for the next attempt (bounded).
    if (isDev) console.warn('[analytics] flush failed, keeping events for retry', err)
    persistQueue()
    return false
  }
}

/** Fire-and-forget flush. Safe to call as often as you like. */
export async function flushAnalytics(reason?: string): Promise<void> {
  if (flushing) return
  flushing = true
  cancelTimer()
  try {
    let sent = true
    // Drain in batches while writes keep succeeding.
    while (sent && queue.length > 0) sent = await sendBatch()
    if (queue.length > 0) scheduleFlush()
  } catch (err) {
    if (isDev) console.warn('[analytics] flush error', err)
  } finally {
    flushing = false
    if (reason === 'hide') persistQueue()
  }
}

/** Which channel this visit arrived on — stamped on the session. */
function entryChannel(): string {
  return detectSource()
}

/**
 * Boots the tracker: ids, first touch, leftover offline events, and the flush
 * triggers (tab hidden, page closing, back online). Idempotent — React
 * StrictMode mounts twice and sellers reload often; neither should double-count
 * a session.
 */
export function initAnalytics(): void {
  if (started) return
  started = true
  try {
    const store = localStore()
    const session = sessionStore()
    const hadAnonId = (() => {
      try {
        return Boolean(store.getItem(ANON_ID_KEY))
      } catch {
        return false
      }
    })()

    anonymousId = getAnonymousId(store)
    const touched = touchSession(session, Date.now(), entryChannel())
    sessionId = touched.session.id
    const touchedFirst = captureFirstTouch(
      store,
      Date.now(),
      entryChannel(),
      typeof document !== 'undefined' ? document.referrer : '',
      currentUrl(),
    )
    firstTouch = touchedFirst.firstTouch

    // Events from an earlier visit that never made it out.
    queue = capQueue(loadQueue())

    if (touched.isNew) {
      trackEvent('session_start', {
        entry: readSessionEntry(session) ?? entryChannel(),
        returning: hadAnonId ? 'yes' : 'no',
      })
    }
    if (touchedFirst.isNew) {
      trackEvent('first_touch_captured', { had_previous: hadAnonId ? 'yes' : 'no' })
    }

    if (queue.length > 0) void flushAnalytics('init')

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') void flushAnalytics('hide')
      })
      window.addEventListener('pagehide', () => {
        persistQueue()
        void flushAnalytics('hide')
      })
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => { void flushAnalytics('online') })
    }
  } catch (err) {
    if (isDev) console.warn('[analytics] init failed', err)
  }
}

/** Records one action. Never throws. */
export function trackEvent(name: EventName, props?: EventProps): void {
  try {
    if (!started) initAnalytics()
    if (isOptedOut(localStore())) return
    enqueue(makeEvent(name, props, Date.now(), currentRoute, { as: name, strict: true }))
  } catch (err) {
    if (isDev) console.warn('[analytics] track failed', name, err)
  }
}

/**
 * Compatibility path for the pre-taxonomy `track(event, userId, source, data)`
 * callers. `userId` is deliberately ignored — the batch carries the live
 * `auth.currentUser` (or `'guest'`) instead, so identity can't drift. Props pass
 * through unfiltered so nothing already being recorded is lost while those call
 * sites are migrated to `trackEvent`.
 */
export function trackLegacy(event: string, source?: string | null, data?: Record<string, unknown>): void {
  try {
    if (!started) initAnalytics()
    if (isOptedOut(localStore())) return
    const props = (data || {}) as EventProps
    enqueue(makeEvent(event, props, Date.now(), currentRoute, {
      source: source || undefined,
      strict: false,
      as: isKnownEvent(event) ? event : undefined,
    }))
  } catch (err) {
    if (isDev) console.warn('[analytics] legacy track failed', event, err)
  }
}

/** Keeps the route stamp fresh so every event knows where it happened. */
export function setAnalyticsRoute(route: string): void {
  currentRoute = route || '/'
}

export function pageView(route: string, title?: string): void {
  setAnalyticsRoute(route)
  trackEvent('page_viewed', { route, title })
}

/** The visitor's choice — honoured by every writer above. */
export function setAnalyticsOptOut(off: boolean): void {
  writeOptOut(localStore(), off)
  if (off) {
    queue = []
    persistQueue()
    cancelTimer()
  }
}

export function isAnalyticsOff(): boolean {
  return isOptedOut(localStore())
}

/** Small read-out: used by dev tooling and the M1 verification script. */
export function analyticsSnapshot() {
  return {
    started,
    appVersion: APP_VERSION,
    sessionId,
    anonymousId,
    firstTouch,
    route: currentRoute,
    queued: queue.length,
    lastFlushAt,
    optedOut: isOptedOut(localStore()),
    queue,
  }
}
