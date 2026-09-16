/**
 * Impressions, shared by card components and whole grids.
 *
 * Two ways in, one rule: an impression is recorded **once per product per
 * session**, the first time the card is at least half on screen.
 *  - `useImpression()` — for a card that is its own component (ProductCard, the
 *    store-page card).
 *  - `observeImpressions()` — for a page that renders its own markup in a `.map()`
 *    (Browse). The elements just need `data-impression-id` (and optionally
 *    `data-impression-seller`), and no JSX has to be restructured.
 */
import { trackEvent } from './client'
import type { EventProps } from './taxonomy'

/** Keys already counted this session (module lifetime = page session). */
export const seenImpressions = new Set<string>()

export function impressionKey(surface: string, productId: string): string {
  return `${surface}:${productId}`
}

/** Fires now if this product hasn't been counted on this surface yet. */
export function recordImpression(surface: string, props: EventProps): void {
  const productId = props.productId === undefined || props.productId === null ? '' : String(props.productId)
  if (!productId) return
  const key = impressionKey(surface, productId)
  if (seenImpressions.has(key)) return
  seenImpressions.add(key)
  trackEvent('product_impression', { ...props, surface })
}

export const IMPRESSION_ATTR = 'data-impression-id'
export const IMPRESSION_SELLER_ATTR = 'data-impression-seller'

/**
 * Counts impressions for every `[data-impression-id]` element inside `root`.
 * Returns a cleanup function; re-run it whenever the rendered list changes.
 */
export function observeImpressions(root: HTMLElement | null, surface: string, threshold = 0.5): () => void {
  if (!root || typeof IntersectionObserver === 'undefined') return () => {}
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      const el = entry.target as HTMLElement
      const productId = el.getAttribute(IMPRESSION_ATTR)
      if (!productId) continue
      observer.unobserve(el)
      recordImpression(surface, {
        productId,
        sellerId: el.getAttribute(IMPRESSION_SELLER_ATTR) || undefined,
      })
    }
  }, { threshold })

  root.querySelectorAll(`[${IMPRESSION_ATTR}]`).forEach(el => {
    const productId = el.getAttribute(IMPRESSION_ATTR) || ''
    if (productId && !seenImpressions.has(impressionKey(surface, productId))) observer.observe(el)
  })

  return () => observer.disconnect()
}
