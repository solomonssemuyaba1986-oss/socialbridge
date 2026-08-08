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

export function detectSource(): string {
  if (typeof window === 'undefined') return 'Web'
  const params = new URLSearchParams(window.location.search)
  const rawSource = (params.get('source') || params.get('utm_source') || '').toLowerCase()
  if (rawSource.includes('whatsapp')) return 'WhatsApp'
  if (rawSource.includes('instagram')) return 'Instagram'
  if (rawSource.includes('tiktok')) return 'TikTok'
  if (rawSource.includes('telegram')) return 'Telegram'
  if (rawSource.includes('twitter')) return 'Twitter'
  if (rawSource.includes('facebook')) return 'Facebook'
  if (rawSource.includes('email')) return 'Email'
  if (rawSource.includes('web')) return 'Web'

  const referrer = document.referrer.toLowerCase()
  if (referrer.includes('whatsapp') || referrer.includes('wa.me') || referrer.includes('api.whatsapp.com')) return 'WhatsApp'
  if (referrer.includes('instagram.com')) return 'Instagram'
  if (referrer.includes('tiktok.com')) return 'TikTok'
  if (referrer.includes('telegram.me') || referrer.includes('t.me')) return 'Telegram'
  if (referrer.includes('twitter.com')) return 'Twitter'
  if (referrer.includes('facebook.com')) return 'Facebook'
  if (referrer.includes('mail.google.com') || referrer.includes('outlook.live.com') || referrer.includes('mail.yahoo.com')) return 'Email'
  return 'Web'
}
