import { useEffect, useState } from 'react'
import { doc, onSnapshot, collection, query, getDocs } from 'firebase/firestore'
import { db } from './firebase'

export interface SellerStats {
  totalSales: number
  avgRating: number
  reviewCount: number
  responseRate: number
  responseTime: string
  storeAge: string
  repeatBuyers: number
  deliverySuccess: number
  verifiedSeller: boolean
}

function computeStoreAge(createdAt: any): string {
  if (!createdAt) return 'New on Rachett'
  
  const created = createdAt.toDate ? createdAt.toDate() : new Date(createdAt)
  const now = new Date()
  const diffMs = now.getTime() - created.getTime()
  const diffMonths = Math.floor(diffMs / (1000 * 60 * 60 * 24 * 30))
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays < 30) {
    return diffDays <= 1 ? 'New on Rachett' : `${diffDays} days on Rachett`
  }
  if (diffMonths < 12) {
    return `${diffMonths} month${diffMonths === 1 ? '' : 's'} on Rachett`
  }
  
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `Selling since ${months[created.getMonth()]} ${created.getFullYear()}`
}

function computeSalesLabel(totalSales: number): string {
  if (totalSales === 0) return 'New seller'
  if (totalSales <= 10) return 'Trusted by early customers'
  if (totalSales <= 50) return 'Growing seller'
  if (totalSales <= 200) return 'Popular seller'
  return `${totalSales.toLocaleString()} items sold`
}

function computeResponseTimeLabel(avgResponseMinutes: number | null): string {
  if (avgResponseMinutes === null) return '—'
  if (avgResponseMinutes < 5) return 'Responds in < 5 min'
  if (avgResponseMinutes < 60) return 'Responds in < 1 hour'
  if (avgResponseMinutes < 120) return 'Responds in < 2 hours'
  if (avgResponseMinutes < 1440) return 'Responds within a day'
  return 'Responds within a few days'
}

export function useSellerStats(sellerId: string | null) {
  const [stats, setStats] = useState<SellerStats>({
    totalSales: 0,
    avgRating: 0,
    reviewCount: 0,
    responseRate: 0,
    responseTime: '—',
    storeAge: 'New on Rachett',
    repeatBuyers: 0,
    deliverySuccess: 0,
    verifiedSeller: false,
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!sellerId) {
      setLoading(false)
      return
    }

    // Listen to seller doc for verifiedSeller + storeCreatedAt
    const unsubSeller = onSnapshot(doc(db, 'sellers', sellerId), (snap) => {
      if (!snap.exists()) return
      const data = snap.data()
      
      // Compute store age from createdAt
      const storeAge = computeStoreAge(data.createdAt)

      setStats(prev => ({
        ...prev,
        storeAge,
        verifiedSeller: data.verifiedSeller || false,
      }))
    })

    // Listen to stats subcollection if it exists
    const unsubStats = onSnapshot(doc(db, 'sellers', sellerId, 'stats', 'main'), (snap) => {
      if (!snap.exists()) {
        // No stats doc yet — compute from orders
        computeStatsFromOrders(sellerId)
        return
      }
      const data = snap.data()
      setStats(prev => ({
        ...prev,
        totalSales: data.totalSales || 0,
        avgRating: data.avgRating || 0,
        reviewCount: data.reviewCount || 0,
        responseRate: data.responseRate || 0,
        responseTime: computeResponseTimeLabel(data.avgResponseMinutes ?? null),
        repeatBuyers: data.repeatBuyers || 0,
        deliverySuccess: data.deliverySuccess || 0,
      }))
      setLoading(false)
    })

    return () => {
      unsubSeller()
      unsubStats()
    }
  }, [sellerId])

  const computeStatsFromOrders = async (sid: string) => {
    try {
      const ordersSnap = await getDocs(query(collection(db, 'sellers', sid, 'orders')))
      const fulfilledOrders = ordersSnap.docs.filter(d => d.data().status === 'fulfilled')
      const totalSales = fulfilledOrders.reduce((sum, d) => {
        const qty = Number(d.data().quantity) || 1
        return sum + qty
      }, 0)

      // Count unique buyers for repeat buyers
      const buyerNames = new Set(fulfilledOrders.map(d => d.data().buyerName?.toLowerCase()).filter(Boolean))
      const repeatBuyers = fulfilledOrders.length > buyerNames.size ? fulfilledOrders.length - buyerNames.size : 0

      // Delivery success: orders that were fulfilled vs cancelled
      const cancelledOrders = ordersSnap.docs.filter(d => d.data().status === 'cancelled').length
      const totalProcessed = fulfilledOrders.length + cancelledOrders
      const deliverySuccess = totalProcessed > 0 ? Math.round((fulfilledOrders.length / totalProcessed) * 100) : 0

      setStats(prev => ({
        ...prev,
        totalSales,
        repeatBuyers,
        deliverySuccess,
      }))
      setLoading(false)
    } catch (err) {
      console.error('Error computing stats from orders:', err)
      setLoading(false)
    }
  }

  return { stats, loading }
}

// Helper to get a friendly sales label
export function getSalesLabel(totalSales: number): string {
  return computeSalesLabel(totalSales)
}

// Helper to format rating for display
export function formatRating(rating: number): string {
  return rating.toFixed(1)
}

// Helper to render star symbols
export function renderStars(rating: number): string {
  const full = Math.floor(rating)
  const half = rating - full >= 0.5 ? 1 : 0
  const empty = 5 - full - half
  return '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(empty)
}
