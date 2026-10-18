/**
 * The pure half of presence — what a `lastSeen` timestamp is allowed to say.
 *
 * No Firebase imports here on purpose: this file is the rule, `presence.ts` is the wiring
 * (heartbeat write + live listener). Keeping them apart means the words a buyer reads can be
 * checked on their own (`_presence_check.cjs`), without an emulator or a network.
 */
import { toMillis } from './productCardUtils'

/** How long after the last heartbeat a seller still reads as "Active now". */
export const ACTIVE_WINDOW_MS = 5 * 60 * 1000

/** Past this, "last seen" is the honest phrase — the seller has not been around. */
const STALE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

export interface Presence {
  /** False when the shop has never written a `lastSeen` — say nothing rather than guess. */
  known: boolean
  online: boolean
  /** "Active now" · "Active 12 min ago" · "Active 3h ago" · "Last seen 6d ago". */
  label: string
  lastSeenMs: number | null
}

function minutesLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function presenceOf(lastSeen: unknown, now: number = Date.now()): Presence {
  const ms = toMillis(lastSeen)
  if (ms === undefined || !Number.isFinite(ms)) {
    return { known: false, online: false, label: '', lastSeenMs: null }
  }
  const age = now - ms
  // A timestamp far in the future is a bad clock (or a hand-written field), not evidence that
  // someone is here. Say nothing rather than claim presence we cannot know.
  if (age < -ACTIVE_WINDOW_MS) return { known: false, online: false, label: '', lastSeenMs: null }
  if (age < ACTIVE_WINDOW_MS) return { known: true, online: true, label: 'Active now', lastSeenMs: ms }
  // Floored, not rounded: "1h ago" may be 61 minutes, never 119. The label understates rather
  // than overstates how recently someone was around — and it can never say "Active 7d ago" on
  // the same minute the rule turns stale.
  const minutes = Math.max(1, Math.floor(age / 60000))
  const label = age >= STALE_WINDOW_MS
    ? `Last seen ${minutesLabel(minutes)}`
    : `Active ${minutesLabel(minutes)}`
  return { known: true, online: false, label, lastSeenMs: ms }
}
