import { useState, useCallback, useEffect, useRef } from 'react'

import { doc, setDoc, getDocs, collection, onSnapshot, updateDoc, deleteDoc, increment as firestoreIncrement } from 'firebase/firestore'
import { onAuthStateChanged } from 'firebase/auth'
import { db, auth } from './firebase'

export interface BagItem {
  productId: string
  productName: string
  productPrice: string
  imageUrl: string
  sellerSlug: string
  businessName: string
  addedAt: number
  quantity: number
}

const STORAGE_KEY = 'rachett_bag'

function loadBag(): BagItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    // Migrate old items without quantity
    return parsed.map((item: BagItem) => ({ ...item, quantity: item.quantity || 1 }))
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

export async function getBagCounts(productIds: string[]): Promise<Record<string, number>> {
  if (productIds.length === 0) return {}
  try {
    const result: Record<string, number> = {}
    const snap = await getDocs(collection(db, 'bagCounts'))
    snap.forEach(doc => {
      if (productIds.includes(doc.id)) {
        result[doc.id] = doc.data().count || 0
      }
    })
    productIds.forEach(id => {
      if (!(id in result)) result[id] = 0
    })
    return result
  } catch (e) {
    console.warn('Failed to fetch bag counts:', e)
    return {}
  }
}


export function useBag() {
  const [items, setItems] = useState<BagItem[]>(loadBag)
  const uidRef = useRef<string | null>(null)

  useEffect(() => {
    saveBag(items)
  }, [items])

  // Auth + cloud sync: when signed in, live-listen to the Firestore bag
  useEffect(() => {
    let unsubFirestore: (() => void) | null = null

    const unsubAuth = onAuthStateChanged(auth, (user) => {
      if (unsubFirestore) { unsubFirestore(); unsubFirestore = null }
      uidRef.current = user?.uid || null

      if (user) {
        // First snapshot: merge local (guest) items into the cloud bag,
        // then keep live-listening so changes from other devices appear instantly.
        let first = true
        unsubFirestore = onSnapshot(collection(db, 'users', user.uid, 'bag'), (snap) => {
          const remote: BagItem[] = []
          snap.forEach(docSnap => {
            const data = docSnap.data() as BagItem
            if (data && data.productId) {
              remote.push({ ...data, quantity: data.quantity || 1 })
            }
          })

          const local = loadBag()
          const merged = new Map<string, BagItem>()
          // Local first, remote wins for same productId (cloud is source of truth)
          local.forEach(i => merged.set(i.productId, i))
          remote.forEach(i => merged.set(i.productId, i))

          if (first) {
            first = false
            // Upload any local-only items so they appear on other devices
            const remoteIds = new Set(remote.map(i => i.productId))
            local.forEach(i => {
              if (!remoteIds.has(i.productId)) {
                setDoc(doc(db, 'users', user.uid, 'bag', i.productId), i).catch(err => {
                  console.warn('Failed to upload bag item:', err)
                })
              }
            })
          }
          setItems(Array.from(merged.values()))
        })
      } else {
        // Signed out: fall back to the local guest bag
        setItems(loadBag())
      }
    })

    return () => {
      unsubAuth()
      if (unsubFirestore) unsubFirestore()
    }
  }, [])

  const addToBag = useCallback((item: Omit<BagItem, 'addedAt' | 'quantity'>) => {
    setItems(prev => {
      if (prev.some(i => i.productId === item.productId)) return prev
      const newItem = { ...item, addedAt: Date.now(), quantity: 1 }
      incrementBagCount(item.productId, 1)
      const uid = uidRef.current
      if (uid) {
        setDoc(doc(db, 'users', uid, 'bag', item.productId), newItem).catch(err => {
          console.warn('Failed to sync bag add:', err)
        })
      }
      return [...prev, newItem]
    })
  }, [])

  const removeFromBag = useCallback((productId: string) => {
    setItems(prev => {
      const next = prev.filter(i => i.productId !== productId)
      if (next.length < prev.length) {
        incrementBagCount(productId, -1)
        const uid = uidRef.current
        if (uid) {
          deleteDoc(doc(db, 'users', uid, 'bag', productId)).catch(err => {
            console.warn('Failed to sync bag remove:', err)
          })
        }
      }
      return next
    })
  }, [])

  const setQuantity = useCallback((productId: string, quantity: number) => {
    const safeQty = Math.max(1, quantity)
    setItems(prev => {
      const next = prev.map(i => i.productId === productId ? { ...i, quantity: safeQty } : i)
      const uid = uidRef.current
      if (uid) {
        updateDoc(doc(db, 'users', uid, 'bag', productId), { quantity: safeQty }).catch(err => {
          console.warn('Failed to sync bag quantity:', err)
        })
      }
      return next
    })
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

  return { items, addToBag, removeFromBag, isInBag, setQuantity, clearBag, count: items.length }
}
