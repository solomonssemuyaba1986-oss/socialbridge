/**
 * The grey name that rolls inside a search box.
 *
 * Two rules, both taken from the promise already printed under the suggestions
 * ("Only shops, products and categories that exist on rachett"):
 *
 *  - **never invent a name** — only things loaded on *that* page. Browse is handed all of
 *    rachett (the catalog feed + the shops directory); Nearby is handed what is near you
 *    (its discovery pool + the shops inside the chosen distance). Different lists in,
 *    different names out.
 *  - **4 products + 2 shops per round**, and a *fresh* sample on the next round, so a big
 *    catalog keeps showing names instead of cycling the same six forever.
 *
 * Pure (no React, no Firebase) so the split, the de-dupe and the interleaving can be
 * verified in a plain Node script — see `_search_check.cjs`.
 */

export interface PlaceholderPool {
  /** Real product names, trimmed and de-duplicated. */
  products: string[]
  /** Real shop names, trimmed and de-duplicated. */
  stores: string[]
}

export const PLACEHOLDER_PRODUCTS = 4
export const PLACEHOLDER_STORES = 2
export const PLACEHOLDER_ROUND = PLACEHOLDER_PRODUCTS + PLACEHOLDER_STORES

/** Trim, drop blanks, de-duplicate case-insensitively, and sort so the order never flickers. */
function cleanNames(names: (string | undefined | null)[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of names) {
    const name = String(raw ?? '').trim().replace(/\s+/g, ' ')
    if (!name) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(name)
  }
  return out.sort((a, b) => a.localeCompare(b))
}

export function buildPlaceholderPool(input: {
  products?: (string | undefined | null)[]
  stores?: (string | undefined | null)[]
}): PlaceholderPool {
  return {
    products: cleanNames(input.products || []),
    stores: cleanNames(input.stores || []),
  }
}

/** Deterministic shuffle (mulberry32) — same seed, same order, so a round is stable. */
function shuffle<T>(items: T[], seed: number): T[] {
  const arr = [...items]
  let s = (seed || 1) >>> 0
  const rand = () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    const tmp = arr[i]
    arr[i] = arr[j]
    arr[j] = tmp
  }
  return arr
}

/**
 * One round: up to 4 products and up to 2 shops, **interleaved** so a round never reads as
 * "four products… now two shops" (`p p s p s p`). A short list simply yields a short round;
 * no name is ever repeated inside one round.
 */
export function nextPlaceholderBatch(pool: PlaceholderPool, seed: number): string[] {
  const products = shuffle(pool.products, seed).slice(0, PLACEHOLDER_PRODUCTS)
  const stores = shuffle(pool.stores, seed + 7919).slice(0, PLACEHOLDER_STORES)

  const out = [...products]
  stores.forEach((name, i) => {
    out.splice(Math.min(out.length, (i + 1) * 2), 0, name)
  })
  return out
}

/** Which name to show right now. `tick` only ever goes up, so rounds advance by themselves. */
export function placeholderAt(batch: string[], tick: number, fallback: string): string {
  if (batch.length === 0) return fallback
  const index = ((tick % (batch.length * 8)) + batch.length * 8) % batch.length
  return batch[index] || fallback
}
