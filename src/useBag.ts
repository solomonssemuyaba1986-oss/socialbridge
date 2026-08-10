import { useState, useCallback, useEffect } from 'react'

import { doc, setDoc, getDocs, collection, increment as firestoreIncrement } from 'firebase/firestore'
import { db } from './firebase'

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

  useEffect(() => {
    saveBag(items)
  }, [items])

  const addToBag = useCallback((item: Omit<BagItem, 'addedAt' | 'quantity'>) => {
    setItems(prev => {
      if (prev.some(i => i.productId === item.productId)) return prev
      incrementBagCount(item.productId, 1)
      return [...prev, { ...item, addedAt: Date.now(), quantity: 1 }]
    })
  }, [])

  const removeFromBag = useCallback((productId: string) => {
    setItems(prev => {
      const next = prev.filter(i => i.productId !== productId)
      if (next.length < prev.length) {
        incrementBagCount(productId, -1)
      }
      return next
    })
  }, [])

  const setQuantity = useCallback((productId: string, quantity: number) => {
    setItems(prev => prev.map(i => i.productId === productId ? { ...i, quantity: Math.max(1, quantity) } : i))
  }, [])

  const isInBag = useCallback((productId: string) => {
    return items.some(i => i.productId === productId)
  }, [items])

  const clearBag = useCallback(() => setItems([]), [])

  return { items, addToBag, removeFromBag, isInBag, setQuantity, clearBag, count: items.length }
}
