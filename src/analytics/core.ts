/**
 * The shape of what we store, and the pure rules around it — no Firebase, no DOM
 * beyond `navigator`/`screen` being passed in. `client.ts` owns the I/O; keeping
 * the decisions here means the batching, trimming and route normalisation can be
 * verified in a plain Node script.
 *
 * Storage shape (one document per batch, collection `events`):
 *
 *   {
 *     schemaVersion: 2, appVersion, sessionId, anonymousId, userId, role,
 *     firstTouch: { source, referrer, landing, at },
 *     platform:   { ua, lang, tz, screen, standalone },
 *     count, clientAt, sentAt, expireAt,
 *     events: [ { n: name, t: clientMs, r: route, s?: channel, p: {…props} } ]
 *   }
 *
 * One doc per ≤25 events instead of one per tap: same data, ~25× fewer writes.
 * `expireAt` is only a marker — nothing is deleted until a Firestore TTL policy
 * is configured on that field (see DATA_COLLECTION.md §6).
 */
import { pickAllowedProps, type EventName, type EventProps } from './taxonomy'
import type { FirstTouch } from './identity'

export const BATCH_SCHEMA_VERSION = 2
/** Events per document. */
export const BATCH_MAX_EVENTS = 25
/** Or flush after this long, whichever comes first. */
export const BATCH_MAX_WAIT_MS = 10_000
/** Hard ceiling before we trim a batch (Firestore document limit is 1 MB). */
export const BATCH_MAX_BYTES = 900_000
/** Offline buffer — oldest events are dropped beyond this. */
export const OFFLINE_QUEUE_MAX = 200
/** How long raw batches are meant to live once a TTL policy is set (days). */
export const RAW_TTL_DAYS = 400

export interface QueuedEvent {
  /** event name */
  n: string
  /** client timestamp (ms) — when it happened, not when it was sent */
  t: number
  /** route template, e.g. "/store/:slug" */
  r: string
  /** explicit channel, set only by legacy callers that passed one */
  s?: string
  /** props (taxonomy-filtered) */
  p: EventProps
}

export interface PlatformInfo {
  ua: string
  lang: string
  tz: string
  screen: string
  standalone: boolean
}

export interface BatchContext {
  appVersion: string
  sessionId: string
  anonymousId: string
  /** null when signed out — written as `'guest'` to stay consistent with older docs */
  userId: string | null
  role: string | null
  firstTouch: FirstTouch | null
  platform: PlatformInfo
}

export interface AnalyticsBatch extends BatchContext {
  schemaVersion: number
  count: number
  clientAt: number
  events: QueuedEvent[]
}

/**
 * `/store/aisha-fabrics?source=whatsapp` → `/store/:slug`
 * Long ids/tokens collapse to `:id` so a route stays a groupable dimension.
 */
export function normalizeRoute(pathname: string): string {
  let path = (pathname || '/').split('?')[0].split('#')[0]
  if (!path.startsWith('/')) path = `/${path}`
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1)
  const parts = path.split('/').filter(Boolean)
  const cleaned = parts.map((part, index) => {
    if (index === 1 && parts[0] === 'store') return ':slug'
    if (part.length >= 20) return ':id'
    if (/^\d{6,}$/.test(part)) return ':id'
    return part
  })
  return `/${cleaned.join('/')}`
}

/**
 * Build one queued event. `strict` keeps the payload inside the taxonomy;
 * legacy callers pass `strict: false` so nothing they already send is lost while
 * the call sites are migrated.
 */
export function makeEvent(
  name: string,
  props: EventProps | undefined,
  now: number,
  route: string,
  options?: { source?: string; strict?: boolean; as?: EventName },
): QueuedEvent {
  const strict = options?.strict !== false
  const finalName = options?.as ?? name
  const payload = strict && options?.as ? pickAllowedProps(options.as, props) : (props ?? {})
  const event: QueuedEvent = { n: finalName, t: now, r: route, p: payload }
  if (options?.source) event.s = options.source
  return event
}

/** True when the queue should be flushed right now. */
export function shouldFlush(
  queueLength: number,
  lastFlushAt: number,
  now: number,
  maxEvents: number = BATCH_MAX_EVENTS,
  maxWaitMs: number = BATCH_MAX_WAIT_MS,
): boolean {
  if (queueLength <= 0) return false
  if (queueLength >= maxEvents) return true
  return now - lastFlushAt >= maxWaitMs
}

/** Drops the oldest events when the offline buffer runs away. */
export function capQueue(queue: QueuedEvent[], max: number = OFFLINE_QUEUE_MAX): QueuedEvent[] {
  if (queue.length <= max) return queue
  return queue.slice(queue.length - max)
}

export function batchBytes(batch: AnalyticsBatch): number {
  try {
    return JSON.stringify(batch).length
  } catch {
    return BATCH_MAX_BYTES
  }
}

/**
 * Takes the next batch off the front of the queue (≤ BATCH_MAX_EVENTS, and
 * trimmed further if a payload is unusually fat). The caller sends it and keeps
 * whatever is left.
 */
export function buildBatch(queue: QueuedEvent[], ctx: BatchContext, now: number): AnalyticsBatch {
  const events = queue.slice(0, BATCH_MAX_EVENTS)
  const batch: AnalyticsBatch = {
    schemaVersion: BATCH_SCHEMA_VERSION,
    appVersion: ctx.appVersion,
    sessionId: ctx.sessionId,
    anonymousId: ctx.anonymousId,
    userId: ctx.userId,
    role: ctx.role,
    firstTouch: ctx.firstTouch,
    platform: ctx.platform,
    count: events.length,
    clientAt: now,
    events,
  }
  while (events.length > 1 && batchBytes(batch) > BATCH_MAX_BYTES) {
    events.pop()
    batch.count = events.length
  }
  return batch
}

/** When this raw batch becomes eligible for TTL cleanup (a marker, not a delete). */
export function rawExpireAtMs(now: number, days: number = RAW_TTL_DAYS): number {
  return now + days * 24 * 60 * 60 * 1000
}
