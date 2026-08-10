import { useState, useCallback, useEffect } from 'react'

export interface BagItem {
  productId: string
  productName: string
  productPrice: string
  imageUrl: string
  sellerSlug: string
  businessName: string
  addedAt: number
}

const STORAGE_KEY = 'rachett_bag'

function loadBag(): BagItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveBag(items: BagItem[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
}

export function useBag() {
  const [items, setItems] = useState<BagItem[]>(loadBag)

  useEffect(() => {
    saveBag(items)
  }, [items])

  const addToBag = useCallback((item: Omit<BagItem, 'addedAt'>) => {
    setItems(prev => {
      if (prev.some(i => i.productId === item.productId)) return prev
      return [...prev, { ...item, addedAt: Date.now() }]
    })
  }, [])

  const removeFromBag = useCallback((productId: string) => {
    setItems(prev => prev.filter(i => i.productId !== productId))
  }, [])

  const isInBag = useCallback((productId: string) => {
    return items.some(i => i.productId === productId)
  }, [items])

  const clearBag = useCallback(() => setItems([]), [])

  return { items, addToBag, removeFromBag, isInBag, clearBag, count: items.length }
}
