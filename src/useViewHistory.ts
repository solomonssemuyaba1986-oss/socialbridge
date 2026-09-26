/**
 * The history of one surface, kept on this device.
 *
 * Device-local, like the bag and the recent searches: it is nobody's business but the person
 * holding the phone, it costs no reads and no writes, and there are no rules to deploy. Browse and
 * Nearby each get their own key (`rachett_history_browse`, `rachett_history_nearby`), so neither
 * page can ever show the other's list.
 *
 * What counts as a view is decided by the page: it opens the details sheet, and *that* is the
 * moment — not a card drifting past in a feed.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import { db } from './firebase'
import {
  groupHistory,
  mergeView,
  parseHistory,
  toViewEntry,
  type HistorySurface,
  type ViewEntry,
  type ViewProduct,
} from './history'
import { trackEvent } from './analytics'

const storageKey = (surface: HistorySurface) => `rachett_history_${surface}`

function loadHistory(surface: HistorySurface): ViewEntry[] {
  try {
    return parseHistory(localStorage.getItem(storageKey(surface)))
  } catch {
    // ignore storage errors
    return []
  }
}

function saveHistory(surface: HistorySurface, entries: ViewEntry[]): void {
  try {
    localStorage.setItem(storageKey(surface), JSON.stringify(entries))
  } catch {
    // ignore storage errors
  }
}

export function useViewHistory(surface: HistorySurface) {
  const [entries, setEntries] = useState<ViewEntry[]>(() => loadHistory(surface))

  // One component renders both pages, so moving between them must re-read — never inherit a list.
  useEffect(() => {
    setEntries(loadHistory(surface))
  }, [surface])

  /** Remember that they opened this. Repeated views move up; they never repeat. */
  const record = useCallback((product: unknown) => {
    const entry = toViewEntry(product as ViewProduct)
    if (!entry) return
    setEntries(prev => {
      const next = mergeView(prev, entry)
      saveHistory(surface, next)
      return next
    })
  }, [surface])

  /** Drop one row — used when a product has been taken down since they looked at it. */
  const remove = useCallback((productId: string) => {
    setEntries(prev => {
      const next = prev.filter(entry => entry.productId !== productId)
      saveHistory(surface, next)
      return next
    })
  }, [surface])

  /** "Clear history" — the whole list, because somebody on a shared phone asked for it. */
  const clear = useCallback(() => {
    saveHistory(surface, [])
    trackEvent('history_cleared', { surface, count: entries.length })
    setEntries([])
  }, [surface, entries.length])

  const groups = useMemo(() => groupHistory(entries), [entries])

  return { surface, entries, groups, count: entries.length, record, remove, clear }
}

export type ViewHistoryApi = ReturnType<typeof useViewHistory>

/**
 * The product as it is **now**, or null when it is gone.
 *
 * A history row is a snapshot: it holds the price and photo from the moment it was viewed. Before
 * opening anything from an old row we read the real document, so a product that has been deleted
 * can never be shown as if it were still on sale — and the shop's public fields are carried over
 * from the row itself, because a product document does not always have them.
 */
export async function fetchHistoryProduct(entry: ViewEntry): Promise<Record<string, unknown> | null> {
  if (!entry.productId || !entry.sellerId) return null

  try {
    const snap = await getDoc(doc(db, 'sellers', entry.sellerId, 'products', entry.productId))
    if (!snap.exists()) return null
    return {
      sellerSlug: entry.sellerSlug,
      businessName: entry.businessName,
      ...snap.data(),
      id: entry.productId,
      sellerId: entry.sellerId,
    }
  } catch (err) {
    console.warn('History: could not read that product again', err)
    return null
  }
}
