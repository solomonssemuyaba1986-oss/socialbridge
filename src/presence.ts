/**
 * "Is this seller around?" — the one piece of presence this app keeps.
 *
 * A shop document has always been public (`firestore.rules`: `allow read: if true`), so the
 * seller's own `lastSeen` can live right there without exposing anything about the person behind
 * it: a timestamp, no phone number, no location. The seller's own app writes it while they are
 * signed in (the heartbeat is mounted app-wide by `sellerLive.tsx`, so a seller browsing the
 * market as a buyer still counts), and a buyer's chat reads it — one document, already needed by
 * half the market.
 *
 * Deliberately coarse: five minutes is "active now", then the words count up. A buyer learns
 * whether it is worth waiting for an answer; nobody learns when the seller sleeps.
 *
 * The rule itself lives in `presenceUtils.ts`; this file only does the two things that need
 * Firebase — the seller's heartbeat and the buyer's live listener.
 */
import { useEffect, useState } from 'react'
import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from './firebase'
import { toMillis } from './productCardUtils'
import { presenceOf, type Presence } from './presenceUtils'

export { ACTIVE_WINDOW_MS, presenceOf, type Presence } from './presenceUtils'

/** How often the seller's app says "still here". */
const HEARTBEAT_MS = 2 * 60 * 1000
/** How often the buyer's screen re-reads the words ("2 min ago" → "3 min ago"). */
const TICK_MS = 60 * 1000

/** One write, merge-only, so the shop document is never replaced. */
export async function markSellerActive(uid: string): Promise<void> {
  await setDoc(doc(db, 'sellers', uid), { lastSeen: serverTimestamp() }, { merge: true })
}

/**
 * Keeps the seller's `lastSeen` fresh while they are in the app.
 *
 * The provider sits above every route, so this is not tied to the dashboard: a seller who is
 * shopping as a buyer is just as reachable, and the badge is truthful on every screen.
 *
 * A hidden tab stops beating on purpose: "active" should mean someone is looking, and a phone in
 * a pocket should not tell buyers otherwise. Coming back to the tab beats immediately.
 */
export function useSellerHeartbeat(uid: string | null, enabled: boolean): void {
  useEffect(() => {
    if (!uid || !enabled) return
    let stopped = false
    const beat = () => {
      if (stopped) return
      void markSellerActive(uid).catch(err => console.warn('presence: heartbeat', err))
    }
    beat()
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') beat()
    }, HEARTBEAT_MS)
    const onVisibility = () => {
      if (document.visibilityState === 'visible') beat()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stopped = true
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [uid, enabled])
}

/**
 * The seller's presence, live, for the buyer's chat header.
 *
 * `enabled` is false when the reader *is* the seller — there is no reason to tell someone they
 * are here, and it saves a listener on their own document.
 */
export function useSellerPresence(sellerId: string | null | undefined, enabled = true): Presence {
  /**
   * The timestamp is kept *with the shop it belongs to*. Opening another thread (or turning the
   * listener off) must never let the previous seller's `lastSeen` leak into this header, and
   * tagging the value is how we clear it without calling setState from an effect body.
   */
  const [seen, setSeen] = useState<{ sellerId: string; ms: number | null } | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!enabled || !sellerId) return
    const unsub = onSnapshot(
      doc(db, 'sellers', sellerId),
      snap => setSeen({ sellerId, ms: toMillis(snap.data()?.lastSeen) ?? null }),
      err => console.warn('presence: seller doc', err),
    )
    return unsub
  }, [sellerId, enabled])

  useEffect(() => {
    if (!enabled) return
    const id = window.setInterval(() => setNow(Date.now()), TICK_MS)
    return () => window.clearInterval(id)
  }, [enabled])

  const lastSeenMs = enabled && sellerId && seen?.sellerId === sellerId ? seen.ms : null
  return presenceOf(lastSeenMs, now)
}
