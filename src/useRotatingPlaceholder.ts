import { useEffect, useMemo, useState } from 'react'
import {
  buildPlaceholderPool,
  nextPlaceholderBatch,
  placeholderAt,
  PLACEHOLDER_ROUND,
} from './searchPlaceholder'

/** How long each name stays on screen. Slow enough to read, quick enough to feel alive. */
const DEFAULT_INTERVAL_MS = 2600

/**
 * The rolling hint inside a search box.
 *
 * Each page hands in **its own** names — Browse the whole catalog and shops directory,
 * Nearby only what is inside the buyer's distance — so the two bars never read the same.
 * The counter only moves while the box is untouched, and a new round pulls a fresh sample,
 * so a big catalog keeps showing names instead of cycling the same six.
 */
export function useRotatingPlaceholder(options: {
  products: (string | undefined | null)[]
  stores: (string | undefined | null)[]
  /** Shown when there is nothing real to roll (e.g. a page with no products yet). */
  fallback: string
  /** True while the person is in the box — a hint that moves under the thumb is infuriating. */
  paused: boolean
  intervalMs?: number
}): string {
  const { products, stores, fallback, paused, intervalMs = DEFAULT_INTERVAL_MS } = options
  const [tick, setTick] = useState(0)

  const pool = useMemo(() => buildPlaceholderPool({ products, stores }), [products, stores])
  const round = Math.floor(tick / PLACEHOLDER_ROUND)
  const batch = useMemo(() => nextPlaceholderBatch(pool, round), [pool, round])

  useEffect(() => {
    if (paused || batch.length <= 1) return
    // "Reduce motion" means exactly this: hold one name still.
    try {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    } catch {
      // no matchMedia (old browser) — carry on
    }
    const timer = window.setInterval(() => setTick(n => n + 1), intervalMs)
    return () => window.clearInterval(timer)
  }, [paused, batch.length, intervalMs])

  return placeholderAt(batch, tick, fallback)
}
