import { useState, useCallback, useEffect, useRef } from 'react'

import { doc, setDoc, getDocs, collection, onSnapshot, updateDoc, deleteDoc, increment as firestoreIncrement, runTransaction } from 'firebase/firestore'
import { onAuthStateChanged } from 'firebase/auth'
import { db, auth } from './firebase'
import { withoutUndefined } from './productCardUtils'

export interface BagItem {
  productId: string
  productName: string
  productPrice: string
  imageUrl: string
  images?: string[]
  sellerSlug: string
  sellerId: string
  businessName: string
  addedAt: number
  quantity: number
  /**
   * What the buyer picked in the details sheet. The bag stays keyed by product — one product,
   * one line — so this is the *chosen* variant, updated in place when they change it
   * (`updateBagVariant`), and carried into the order when they order from the bag.
   */
  color?: string
  size?: string
}

const STORAGE_KEY = 'rachett_bag'

function loadBag(): BagItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    // Migrate old items without quantity/sellerId
    return parsed.map((item: Partial<BagItem>) => ({
      ...item,
      quantity: item.quantity || 1,
      sellerId: item.sellerId || '',
    })) as BagItem[]
  } catch {
    return []
  }
}

function saveBag(items: BagItem[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
}
export async function incrementBagCount(productId: string, delta: number) {
  try {
    const ref = doc(db, 'bagCounts', productId)
    await setDoc(ref, { count: firestoreIncrement(delta) }, { merge: true })
  } catch (e) {
    console.warn('Failed to update bag count:', e)
  }
}

export interface BagCountData {
  count: number
  baggedCount: number
}

/** One point per distinct user: the ever-bagged counter only rises when this user hasn't bagged it before. */
export async function incrementBaggedCount(productId: string, userId?: string) {
  if (!userId) return // guests don't count toward ever-bagged (rules also block their writes)
  try {
    const ref = doc(db, 'bagCounts', productId)
    const markerRef = doc(db, 'bagCounts', productId, 'baggers', userId)
    await runTransaction(db, async (tx) => {
      const markerSnap = await tx.get(markerRef)
      if (markerSnap.exists()) return // already counted this user — no inflation from bag/remove/bag
      tx.set(markerRef, { at: Date.now() })
      tx.set(ref, { baggedCount: firestoreIncrement(1) }, { merge: true })
    })
  } catch (e) {
    console.warn('Failed to update bagged count:', e)
  }
}

export async function getBagCounts(productIds: string[]): Promise<Record<string, BagCountData>> {
  if (productIds.length === 0) return {}
  try {
    const result: Record<string, BagCountData> = {}
    const snap = await getDocs(collection(db, 'bagCounts'))
    snap.forEach(doc => {
      if (productIds.includes(doc.id)) {
        const d = doc.data()
        result[doc.id] = { count: Math.max(0, d.count || 0), baggedCount: Math.max(0, d.baggedCount ?? d.count ?? 0) }
      }
    })
    productIds.forEach(id => {
      if (!(id in result)) result[id] = { count: 0, baggedCount: 0 }
    })
    return result
  } catch (e) {
    console.warn('Failed to fetch bag counts:', e)
    return {}
  }
}


/**
 * Every bag write goes through here, for one reason: these calls used to live *inside* React state
 * updaters, and a synchronous throw from `setDoc` (an `undefined` field, say) took the whole screen
 * down with it — the white page. Now a failed sync is a console warning and nothing more; the bag
 * on this device still works exactly as the person expects.
 */
function firestoreWrite(label: string, run: () => Promise<unknown> | void) {
  try {
    const result = run()
    if (result && typeof (result as Promise<unknown>).catch === 'function') {
      void (result as Promise<unknown>).catch(err => console.warn(`Bag sync (${label}) failed:`, err))
    }
  } catch (err) {
    console.warn(`Bag sync (${label}) threw before it was sent:`, err)
  }
}

export function useBag() {
  const [items, setItems] = useState<BagItem[]>(loadBag)
  const uidRef = useRef<string | null>(null)
  /** The latest items, for decisions taken *outside* a state updater (see the writers below). */
  const itemsRef = useRef<BagItem[]>(items)

  useEffect(() => {
    itemsRef.current = items
    saveBag(items)
  }, [items])

  // Auth + cloud sync: when signed in, live-listen to the Firestore bag.
  // Also runs a light safety-net refresh so the bag catches up even if
  // the realtime stream stalls (e.g. background tab, flaky connection).
  useEffect(() => {
    let unsubFirestore: (() => void) | null = null
    let refreshTimer: number | null = null

    const unsubAuth = onAuthStateChanged(auth, (user) => {
      if (unsubFirestore) { unsubFirestore(); unsubFirestore = null }
      if (refreshTimer !== null) { window.clearInterval(refreshTimer); refreshTimer = null }
      uidRef.current = user?.uid || null

      if (user) {
        let first = true

        const applyRemote = (remote: BagItem[]) => {
          const local = loadBag()
          const merged = new Map<string, BagItem>()
          // Local first, remote wins for same productId (cloud is source of truth)
          local.forEach(i => merged.set(i.productId, i))
          remote.forEach(i => merged.set(i.productId, i))

          if (first) {
            first = false
            // Upload any local-only items so they appear on other devices — **and count them
            // now**: this is the moment a guest becomes an account, which is the only honest
            // moment their bag can enter a public number (a number anybody could write to is a
            // number anybody could fake). The once-per-account marker makes it exactly once, so
            // bagging the same thing again — or on a second phone — never doubles it.
            const remoteIds = new Set(remote.map(i => i.productId))
            local.forEach(i => {
              if (remoteIds.has(i.productId)) return
              setDoc(doc(db, 'users', user.uid, 'bag', i.productId), i).catch(err => {
                console.warn('Failed to upload bag item:', err)
              })
              void incrementBagCount(i.productId, 1)
              void incrementBaggedCount(i.productId, user.uid)
            })
          }

          const next = Array.from(merged.values())
          setItems(prev => {
            if (prev.length === next.length && prev.every((item, idx) =>
              item.productId === next[idx].productId &&
              item.quantity === next[idx].quantity
            )) return prev
            return next
          })
        }

        const collectRemote = (snap: { forEach: (cb: (d: { data: () => unknown }) => void) => void }) => {
          const remote: BagItem[] = []
          snap.forEach(docSnap => {
            const data = docSnap.data() as BagItem
            if (data && data.productId) {
              remote.push({ ...data, quantity: data.quantity || 1, sellerId: data.sellerId || '' })
            }
          })
          return remote
        }

        // Real-time listener
        unsubFirestore = onSnapshot(
          collection(db, 'users', user.uid, 'bag'),
          (snap) => applyRemote(collectRemote(snap)),
          (err) => console.warn('Bag realtime listener error:', err)
        )

        // Safety-net refresh (catches up within ~5s if realtime stalls)
        refreshTimer = window.setInterval(async () => {
          try {
            const snap = await getDocs(collection(db, 'users', user.uid, 'bag'))
            applyRemote(collectRemote(snap))
          } catch (err) {
            console.warn('Bag refresh failed:', err)
          }
        }, 5000)
      } else {
        // Signed out: fall back to the local guest bag
        setItems(loadBag())
      }
    })

    return () => {
      unsubAuth()
      if (unsubFirestore) unsubFirestore()
      if (refreshTimer !== null) window.clearInterval(refreshTimer)
    }
  }, [])

  const addToBag = useCallback((item: Omit<BagItem, 'addedAt' | 'quantity'>, quantity = 1) => {
    if (itemsRef.current.some(i => i.productId === item.productId)) return
    const newItem: BagItem = {
      ...item,
      // Never `undefined`: an absent choice is an empty string, which Firestore accepts.
      color: (item.color || '').trim(),
      size: (item.size || '').trim(),
      addedAt: Date.now(),
      quantity: Math.max(1, Math.floor(Number(quantity) || 1)),
    }
    setItems(prev => (prev.some(i => i.productId === item.productId) ? prev : [...prev, newItem]))

    // Side effects *after* the state update, never inside it — the crash this fixes came from a
    // Firestore call throwing mid-updater.
    const uid = uidRef.current
    firestoreWrite('bag-count', () => incrementBagCount(item.productId, 1))
    firestoreWrite('bagged-count', () => incrementBaggedCount(item.productId, uid ?? undefined))
    if (uid) firestoreWrite('add-line', () => setDoc(doc(db, 'users', uid, 'bag', item.productId), withoutUndefined({ ...newItem })))
  }, [])

  /**
   * The details sheet: change the colour/size of something already in the bag. Same product,
   * same line (see `BagItem.color`) — deliberately not a second bag line, which would need the
   * whole bag, its counters and its order flow to be keyed differently.
   */
  const updateBagVariant = useCallback((productId: string, variant: { color?: string; size?: string }) => {
    const target = itemsRef.current.find(i => i.productId === productId)
    if (!target) return
    const color = (variant.color || '').trim()
    const size = (variant.size || '').trim()
    if ((target.color || '') === color && (target.size || '') === size) return
    setItems(prev => prev.map(i => (i.productId === productId ? { ...i, color, size } : i)))
    const uid = uidRef.current
    if (uid) firestoreWrite('variant', () => updateDoc(doc(db, 'users', uid, 'bag', productId), { color, size }))
  }, [])

  const removeFromBag = useCallback((productId: string) => {
    const wasThere = itemsRef.current.some(i => i.productId === productId)
    setItems(prev => prev.filter(i => i.productId !== productId))
    if (!wasThere) return
    const uid = uidRef.current
    firestoreWrite('remove-count', () => incrementBagCount(productId, -1))
    if (uid) firestoreWrite('remove-line', () => deleteDoc(doc(db, 'users', uid, 'bag', productId)))
  }, [])

  const setQuantity = useCallback((productId: string, quantity: number) => {
    const safeQty = Math.max(1, Math.floor(Number(quantity) || 1))
    setItems(prev => prev.map(i => (i.productId === productId ? { ...i, quantity: safeQty } : i)))
    const uid = uidRef.current
    if (!uid) return
    // Only a line that exists: "set the quantity of something not in the bag" is a no-op, not a
    // write that Firestore has to refuse.
    if (!itemsRef.current.some(i => i.productId === productId)) return
    firestoreWrite('quantity', () => updateDoc(doc(db, 'users', uid, 'bag', productId), { quantity: safeQty }))
  }, [])

  const isInBag = useCallback((productId: string) => {
    return items.some(i => i.productId === productId)
  }, [items])

  const clearBag = useCallback(() => {
    const uid = uidRef.current
    if (uid) {
      items.forEach(i => {
        deleteDoc(doc(db, 'users', uid, 'bag', i.productId)).catch(err => {
          console.warn('Failed to sync bag clear:', err)
        })
      })
    }
    setItems([])
  }, [items])

  return { items, addToBag, removeFromBag, isInBag, setQuantity, updateBagVariant, clearBag, count: items.length }
}
