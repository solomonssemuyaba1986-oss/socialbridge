/**
 * The shops, read once and remembered briefly: where each one is, and what it is called.
 *
 * Two pages need the same shop facts. Browse's "Nearby" sort and the empty bag's "bought near you"
 * shelf both ask *is this shop within reach of my area?* — and an empty bag also needs the slug and
 * name, because a product document does not carry them and a suggestion without a slug cannot be
 * opened at all. Both pages read the same collection, so this is the one place that happens, and the
 * parsing rule lives in `browseSort.sellerDirectoryFrom` so the two pages cannot drift.
 *
 * It is deliberately lazy and opt-in: `enabled` is false until a page actually needs it, and the
 * caller only turns it on when the buyer has an area on their device (`useBuyerLocation`) — with no
 * area there is no distance to compute, so nothing is read. The result is cached across page visits
 * for a few minutes: shops do not move and do not rename themselves hourly.
 *
 * Only the pins, slugs and names are kept — phones, balances and everything else on a seller
 * document are not read into memory here, and the buyer's area never leaves their phone (`place.ts`).
 */
import { useEffect, useState } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { db } from './firebase'
import { sellerDirectoryFrom, type Point, type SellerStore } from './browseSort'

/** Shops do not move — long enough that a page hopping makes no reads at all. */
const DIRECTORY_CACHE_MAX_AGE_MS = 10 * 60 * 1000

export interface SellerDirectory {
  geo: Map<string, Point>
  stores: Map<string, SellerStore>
}

const EMPTY_DIRECTORY = () => ({ geo: new Map(), stores: new Map() }) as SellerDirectory

let cache: { value: SellerDirectory; at: number } | null = null
/** One read at a time, shared by every caller asking within the same moment. */
let inFlight: Promise<SellerDirectory> | null = null

function readCache(): SellerDirectory | null {
  if (!cache) return null
  if (Date.now() - cache.at > DIRECTORY_CACHE_MAX_AGE_MS) return null
  return cache.value
}

async function loadSellerDirectory(): Promise<SellerDirectory> {
  const cached = readCache()
  if (cached) return cached
  if (inFlight) return inFlight

  inFlight = getDocs(collection(db, 'sellers'))
    .then(snap => {
      const value = sellerDirectoryFrom(snap.docs.map(d => {
        const data = d.data() as { geo?: { lat?: unknown; lng?: unknown }; slug?: unknown; businessName?: unknown }
        return { id: d.id, geo: data.geo, slug: data.slug, businessName: data.businessName }
      }))
      cache = { value, at: Date.now() }
      return value
    })
    .catch(err => {
      // A page must not break because it could not place a shop: unknown distance is the safe
      // answer, and a shelf that cannot be opened is simply not offered.
      console.warn('Seller directory: could not read shops — distances and shop names will be left out', err)
      return EMPTY_DIRECTORY()
    })
    .finally(() => { inFlight = null })

  return inFlight
}

/**
 * The directory, ready to hand to `sortProducts` or to a distance check. Returns empty maps until
 * it has something, so a caller never has to wait to render — and never invents a distance or a
 * shop name meanwhile.
 */
export function useSellerDirectory(enabled: boolean): SellerDirectory {
  const [directory, setDirectory] = useState<SellerDirectory>(() => readCache() ?? EMPTY_DIRECTORY())

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    void loadSellerDirectory().then(next => { if (!cancelled) setDirectory(next) })
    return () => { cancelled = true }
  }, [enabled])

  return directory
}

/**
 * A page that has *already* read the shops leaves them here — Browse does, for its store list — so
 * the next page that needs them (the empty bag; Nearby) costs no reads at all for the same
 * documents. A snapshot we already hold wins: a page's older local copy must never replace it.
 */
export function primeSellerDirectory(directory: SellerDirectory): void {
  if (cache) return
  cache = { value: directory, at: Date.now() }
}

/** Used by tests/tools to prove the cache behaves; harmless in the app. */
export function __resetSellerDirectoryCache() {
  cache = null
  inFlight = null
}
