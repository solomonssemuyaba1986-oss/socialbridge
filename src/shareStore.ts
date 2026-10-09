/**
 * Sharing a shop, once, for every screen that offers it.
 *
 * Three places now hand a seller their own link — the Dashboard block, the sidebar button and the
 * Marketing page — and they used to differ in the only way that matters: whether the copy was
 * *counted*. `store_link_copied` and `store_shared` sat in the taxonomy with no call sites at all, so
 * "did she share her shop?" was a question rachett could not answer about the page built to answer it.
 *
 * So the clipboard, the phone's own share sheet and the events live here together, and the screens
 * call these functions instead of each doing their own `navigator.clipboard.writeText`.
 */
import { trackEvent } from './analytics'
import { notify } from './notifications'

/** Which screen asked — kept small and stable, because it is compared across months. */
export type ShareSurface = 'marketing' | 'dashboard' | 'sidebar' | 'store' | 'product' | 'orders'

type ShareCapable = Navigator & { share?: (data: { title?: string; text?: string; url?: string }) => Promise<void> }

/**
 * Copy, with a fallback for the phones that matter.
 *
 * `navigator.clipboard` needs a secure context and a recent browser; a seller on an older Android
 * browser gets the textarea trick instead of a button that silently does nothing.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through to the old way — a blocked clipboard is not a failed copy yet
  }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.top = '-1000px'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const copied = document.execCommand('copy')
    area.remove()
    return copied
  } catch {
    return false
  }
}

/** True when the device has its own share sheet — a phone usually does, a desktop usually does not. */
export function canNativeShare(): boolean {
  return typeof navigator !== 'undefined' && typeof (navigator as ShareCapable).share === 'function'
}

export async function copyStoreLink(input: { sellerId: string; link: string; surface: ShareSurface }): Promise<boolean> {
  const copied = await copyText(input.link)
  if (copied) {
    trackEvent('store_link_copied', { sellerId: input.sellerId, surface: input.surface })
    alert(notify.storeLinkCopied)
  } else {
    alert(notify.copyFailed)
  }
  return copied
}

export async function copyProductLink(input: {
  productId: string
  sellerId: string
  link: string
  surface: ShareSurface
}): Promise<boolean> {
  const copied = await copyText(input.link)
  if (copied) {
    trackEvent('product_link_copied', { productId: input.productId, sellerId: input.sellerId, surface: input.surface })
    alert(notify.productLinkCopied)
  } else {
    alert(notify.copyFailed)
  }
  return copied
}

/** Records a share that went out through a channel rachett opened in a new tab. */
export function markShared(input: {
  sellerId: string
  channel: string
  surface: ShareSurface
  productId?: string
}): void {
  if (input.productId) {
    trackEvent('product_shared', {
      productId: input.productId,
      sellerId: input.sellerId,
      channel: input.channel,
      surface: input.surface,
    })
    return
  }
  trackEvent('store_shared', { sellerId: input.sellerId, channel: input.channel, surface: input.surface })
}

/**
 * The phone's own share sheet when there is one, the clipboard when there is not. Returns which
 * happened, because the confirmation the seller sees should match what really occurred.
 */
export async function shareLink(input: {
  sellerId: string
  link: string
  text: string
  title?: string
  surface: ShareSurface
  productId?: string
}): Promise<'shared' | 'copied' | 'failed'> {
  const nav = typeof navigator === 'undefined' ? null : (navigator as ShareCapable)
  const payload = { title: input.title || 'rachett', text: input.text, url: input.link }
  if (nav && typeof nav.share === 'function') {
    try {
      await nav.share(payload)
      markShared({ sellerId: input.sellerId, channel: 'native', surface: input.surface, productId: input.productId })
      return 'shared'
    } catch (err) {
      // A cancelled sheet is not an error worth a message — but it is not a share either.
      if (err instanceof Error && err.name === 'AbortError') return 'failed'
    }
  }
  const copied = input.productId
    ? await copyProductLink({ productId: input.productId, sellerId: input.sellerId, link: input.link, surface: input.surface })
    : await copyStoreLink({ sellerId: input.sellerId, link: input.link, surface: input.surface })
  return copied ? 'copied' : 'failed'
}

/** ── The QR card ────────────────────────────────────────────────────────────────────────────── */

/** Fired once per mount: a QR that is on screen is a QR somebody decided to print. */
export function markQrViewed(sellerId: string): void {
  trackEvent('qr_viewed', { sellerId })
}

export function markQrDownloaded(sellerId: string, surface: ShareSurface): void {
  trackEvent('qr_downloaded', { sellerId, surface })
}

export function markQrPrinted(sellerId: string, surface: ShareSurface): void {
  trackEvent('qr_printed', { sellerId, surface })
}

/** ── The page itself ────────────────────────────────────────────────────────────────────────── */

export function markMarketingOpened(productCount: number): void {
  trackEvent('marketing_opened', { productCount })
}

export function markPromoteUsed(card: string, surface: ShareSurface): void {
  trackEvent('promote_card_used', { card, surface })
}
