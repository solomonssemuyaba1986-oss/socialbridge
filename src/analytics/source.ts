/**
 * Where a visitor came from — read from `?source=` / `?utm_source=` first, then
 * from the referrer. Kept dependency-free (no Firebase) so identity and
 * attribution can be tested and reused by scripts.
 *
 * Extracted from `tracking.ts` so the analytics client and `StorePage` can share
 * one definition; `tracking.ts` re-exports `detectSource` for older imports.
 */
export const CHANNELS = [
  'WhatsApp', 'Instagram', 'TikTok', 'Telegram', 'Twitter', 'Facebook', 'Email', 'Web',
] as const
export type Channel = (typeof CHANNELS)[number]

/** Matches the loose words we and sellers actually use in links. */
function channelFromRaw(raw: string): Channel | null {
  if (!raw) return null
  if (raw.includes('whatsapp') || raw.includes('wa.me')) return 'WhatsApp'
  if (raw.includes('instagram')) return 'Instagram'
  if (raw.includes('tiktok')) return 'TikTok'
  if (raw.includes('telegram') || raw.includes('t.me')) return 'Telegram'
  if (raw.includes('twitter') || raw.includes('x.com')) return 'Twitter'
  if (raw.includes('facebook') || raw.includes('fb.')) return 'Facebook'
  if (raw.includes('email') || raw.includes('mail')) return 'Email'
  if (raw.includes('web')) return 'Web'
  return null
}

function channelFromReferrer(referrer: string): Channel | null {
  if (!referrer) return null
  if (referrer.includes('whatsapp') || referrer.includes('wa.me') || referrer.includes('api.whatsapp.com')) return 'WhatsApp'
  if (referrer.includes('instagram.com')) return 'Instagram'
  if (referrer.includes('tiktok.com')) return 'TikTok'
  if (referrer.includes('telegram.me') || referrer.includes('t.me')) return 'Telegram'
  if (referrer.includes('twitter.com') || referrer.includes('x.com')) return 'Twitter'
  if (referrer.includes('facebook.com')) return 'Facebook'
  if (referrer.includes('mail.google.com') || referrer.includes('outlook.live.com') || referrer.includes('mail.yahoo.com')) return 'Email'
  return null
}

/** The channel for the page the visitor is on right now. */
export function detectSource(): Channel {
  if (typeof window === 'undefined') return 'Web'
  const params = new URLSearchParams(window.location.search)
  const raw = (params.get('source') || params.get('utm_source') || '').toLowerCase()
  const fromParam = channelFromRaw(raw)
  if (fromParam) return fromParam
  return channelFromReferrer(document.referrer.toLowerCase()) ?? 'Web'
}

/** Same thing, for a caller that already holds the URLSearchParams (e.g. StorePage). */
export function detectPlatform(params: URLSearchParams): Channel {
  const raw = (params.get('source') || params.get('utm_source') || '').toLowerCase()
  const fromParam = channelFromRaw(raw)
  if (fromParam) return fromParam
  if (typeof document === 'undefined') return 'Web'
  return channelFromReferrer(document.referrer.toLowerCase()) ?? 'Web'
}

/** Full landing URL (query included — that's where `?source=` lives). */
export function currentUrl(): string {
  if (typeof window === 'undefined') return ''
  return window.location.href.slice(0, 300)
}
