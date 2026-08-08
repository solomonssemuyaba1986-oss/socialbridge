import { collection, addDoc, serverTimestamp } from 'firebase/firestore'
import { db } from './firebase'

/**
 * Fire-and-forget event tracker for Rachett AI / machine learning.
 * Never blocks the UI — errors are silently swallowed.
 *
 * @param event  - Human-readable event name (e.g. 'product_viewed')
 * @param userId - auth.currentUser?.uid || 'guest'
 * @param source - platform source (Instagram, WhatsApp, Web, etc.)
 * @param data   - optional payload (productId, search query, etc.)
 */
export function track(
  event: string,
  userId: string | null,
  source: string,
  data?: Record<string, unknown>
) {
  addDoc(collection(db, 'events'), {
    event,
    userId: userId || 'guest',
    sourcePlatform: source || 'Web',
    data: data || {},
    createdAt: serverTimestamp(),
  }).catch(() => {}) // silent — never let tracking break the UI
}
