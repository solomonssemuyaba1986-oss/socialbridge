/**
 * `product_impression` for a card that is its own component — see
 * `impressions.ts` for the shared rule (once per product per session) and for the
 * container-observer variant used by pages that render their own markup.
 */
import { useEffect, type RefObject } from 'react'
import { impressionKey, seenImpressions } from './impressions'
import { trackEvent } from './client'

export interface ImpressionTarget {
  productId: string
  sellerId?: string
  /** Where the card sat in the list — first-screen cards convert differently. */
  position?: number
}

export function useImpression(
  ref: RefObject<HTMLElement | null>,
  target: ImpressionTarget,
  options?: { surface?: string; threshold?: number; enabled?: boolean },
) {
  const productId = target.productId || ''
  const sellerId = target.sellerId || undefined
  const position = target.position
  const surface = options?.surface ?? 'unknown'
  const enabled = options?.enabled !== false
  const threshold = options?.threshold ?? 0.5

  useEffect(() => {
    const el = ref.current
    if (!el || !productId || !enabled) return
    const key = impressionKey(surface, productId)
    if (seenImpressions.has(key)) return
    if (typeof IntersectionObserver === 'undefined') return

    let done = false
    const observer = new IntersectionObserver(entries => {
      if (done || !entries.some(entry => entry.isIntersecting)) return
      done = true
      observer.disconnect()
      if (seenImpressions.has(key)) return
      seenImpressions.add(key)
      trackEvent('product_impression', { productId, sellerId, position, surface })
    }, { threshold })

    observer.observe(el)
    return () => observer.disconnect()
  }, [ref, productId, sellerId, position, surface, enabled, threshold])
}


