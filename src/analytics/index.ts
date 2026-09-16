/**
 * Public entry point for rachett analytics.
 *
 *   initAnalytics()                 — once, in main.tsx
 *   pageView(route)                 — on route change
 *   trackEvent('bag_added', {...})  — anywhere a user does something
 *
 * Event names and their allowed properties live in `taxonomy.ts`; the storage
 * shape and batching rules live in `core.ts`; the Firestore writer is
 * `client.ts`. Nothing else in the app should touch those directly.
 */
export {
  initAnalytics,
  trackEvent,
  trackLegacy,
  pageView,
  setAnalyticsRoute,
  flushAnalytics,
  setAnalyticsOptOut,
  isAnalyticsOff,
  analyticsSnapshot,
} from './client'
export { detectPlatform, detectSource, CHANNELS, type Channel } from './source'
export { EVENT_PROPS, isKnownEvent, type EventName, type EventProps } from './taxonomy'
export { normalizeRoute } from './core'
export {
  IMPRESSION_ATTR,
  IMPRESSION_SELLER_ATTR,
  impressionKey,
  observeImpressions,
  recordImpression,
  seenImpressions,
} from './impressions'
export { useImpression } from './useImpression'
