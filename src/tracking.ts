/**
 * The original tracker, now a thin shim in front of the analytics client
 * (`src/analytics/`). The signature stays exactly the same so every existing
 * call site keeps working while it is migrated to `trackEvent` + the taxonomy.
 *
 * What changed underneath: events are queued and written as batches of up to 25
 * carrying a session id, a device (anonymous) id, the landing channel, the page
 * they happened on and the build version — instead of one bare document per tap.
 *
 * NOTE: `userId` is intentionally unused. Each batch records the live
 * `auth.currentUser` (or 'guest') at send time, so a uid passed in by a caller can
 * never mislabel somebody else's events.
 */
import { trackLegacy } from './analytics/client'

export { detectSource, detectPlatform } from './analytics/source'

export function track(
  event: string,
  _userId: string | null,
  source: string,
  data?: Record<string, unknown>,
): void {
  trackLegacy(event, source, data)
}