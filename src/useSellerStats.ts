import { useEffect, useState } from 'react'
import { doc, onSnapshot, collection, query, getDocs } from 'firebase/firestore'
import { db } from './firebase'

export type BadgeStatus = 'none' | 'active' | 'grace'

export interface SellerStats {
  totalSales: number
  avgRating: number
  reviewCount: number
  responseRate: number
  responseTime: string
  avgResponseMinutes: number | null
  storeAge: string
  storeAgeDays: number
  repeatBuyers: number
  deliverySuccess: number
  verifiedSeller: boolean
  realSellerBadge: boolean
  realSellerBadgeStatus: BadgeStatus
  activeSellerBadge: boolean
  activeSellerBadgeStatus: BadgeStatus
  productCount: number
  productWithImageCount: number
  productQualityCount: number
  fulfilledOrders: number
  totalOrdersProcessed: number
}

function computeStoreAge(createdAt: any): { label: string; days: number } {
  if (!createdAt) return { label: 'New on Rachett', days: 0 }

  const created = createdAt.toDate ? createdAt.toDate() : new Date(createdAt)
  const now = new Date()
  const diffMs = now.getTime() - created.getTime()
  const diffMonths = Math.floor(diffMs / (1000 * 60 * 60 * 24 * 30))
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays < 30) {
    const label = diffDays <= 1 ? 'New on Rachett' : `${diffDays} days on Rachett`
    return { label, days: diffDays }
  }
  if (diffMonths < 12) {
    return { label: `${diffMonths} month${diffMonths === 1 ? '' : 's'} on Rachett`, days: diffDays }
  }

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return { label: `Selling since ${months[created.getMonth()]} ${created.getFullYear()}`, days: diffDays }
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

/**
 * Real Seller Badge (🟢): auto-awarded when all 5 conditions pass:
 * - Phone verified via OTP
 * - Nationality filled in
 * - Business name + bio filled
 * - 1+ product added
 */
function computeRealSellerBadge(
  phoneVerified: boolean,
  nationality: string | undefined,
  businessName: string | undefined,
  bio: string | undefined,
  productCount: number,
): boolean {
  return Boolean(
    phoneVerified &&
    nationality &&
    businessName &&
    bio &&
    productCount >= 1,
  )
}

/**
 * Active Seller Badge (🔵):
 * - Must already be a Real Seller
 * - 14+ days on Rachett
 * - 10+ fulfilled orders
 * - 60%+ delivery success (computed only when 10+ orders processed)
 * - Responds in < 24 hours (avg response < 1440 minutes)
 * - 3+ quality products (name 5+ chars, description 20+ chars, has image)
 */
function computeActiveSellerBadge(
  realSellerBadge: boolean,
  storeAgeDays: number,
  fulfilledOrders: number,
  deliverySuccess: number,
  totalOrdersProcessed: number,
  avgResponseMinutes: number | null,
  productQualityCount: number,
): boolean {
  if (!realSellerBadge) return false
  if (storeAgeDays < 14) return false
  if (fulfilledOrders < 10) return false
  // Only evaluate delivery success when we have enough data
  if (totalOrdersProcessed >= 10 && deliverySuccess < 60) return false
  if (avgResponseMinutes === null || avgResponseMinutes >= 1440) return false
  if (productQualityCount < 3) return false
  return true
}

/**
 * Compute badge status with grace period.
 * - badgeEarnedAt: timestamp (millis) when badge was first earned
 * - graceUntil: timestamp (millis) when grace period expires
 * - conditionsMet: are all conditions currently passing?
 */
function computeBadgeStatus(
  conditionsMet: boolean,
  earnedAt: number | undefined,
  graceUntil: number | undefined,
): { visible: boolean; status: BadgeStatus } {
  const now = Date.now()

  if (conditionsMet) {
    // All conditions pass — badge is active
    return { visible: true, status: 'active' }
  }

  if (earnedAt && graceUntil && now < graceUntil) {
    // Conditions failed but still within grace period
    return { visible: true, status: 'grace' }
  }

  // Never earned, or grace expired — no badge
  return { visible: false, status: 'none' }
}

export function useSellerStats(sellerId: string | null) {
  const [stats, setStats] = useState<SellerStats>({
    totalSales: 0,
    avgRating: 0,
    reviewCount: 0,
    responseRate: 0,
    responseTime: '—',
    avgResponseMinutes: null,
    storeAge: 'New on Rachett',
    storeAgeDays: 0,
    repeatBuyers: 0,
    deliverySuccess: 0,
    verifiedSeller: false,
    realSellerBadge: false,
    realSellerBadgeStatus: 'none',
    activeSellerBadge: false,
    activeSellerBadgeStatus: 'none',
    productCount: 0,
    productWithImageCount: 0,
    productQualityCount: 0,
    fulfilledOrders: 0,
    totalOrdersProcessed: 0,
  })
  const [loading, setLoading] = useState(true)

  // Track seller-level fields for badge computation
  const [sellerFields, setSellerFields] = useState<{
    phoneVerified?: boolean
    nationality?: string
    idDocumentPath?: string
    idStatus?: string
    businessName?: string
    bio?: string
    realSellerBadgeEarnedAt?: number
    realSellerBadgeGraceUntil?: number
    activeSellerBadgeEarnedAt?: number
    activeSellerBadgeGraceUntil?: number
  }>({})

  useEffect(() => {
    if (!sellerId) {
      setLoading(false)
      return
    }

    // Listen to seller doc for badge-related fields + storeCreatedAt
    const unsubSeller = onSnapshot(doc(db, 'sellers', sellerId), (snap) => {
      if (!snap.exists()) return
      const data = snap.data()

      const age = computeStoreAge(data.createdAt)

      setSellerFields({
        phoneVerified: data.phoneVerified || false,
        nationality: data.nationality || undefined,
        idDocumentPath: data.idDocumentPath || undefined,
        idStatus: data.idStatus || undefined,
        businessName: data.businessName || undefined,
        bio: data.bio || undefined,
        realSellerBadgeEarnedAt: data.realSellerBadgeEarnedAt || undefined,
        realSellerBadgeGraceUntil: data.realSellerBadgeGraceUntil || undefined,
        activeSellerBadgeEarnedAt: data.activeSellerBadgeEarnedAt || undefined,
        activeSellerBadgeGraceUntil: data.activeSellerBadgeGraceUntil || undefined,
      })

      setStats(prev => ({
        ...prev,
        storeAge: age.label,
        storeAgeDays: age.days,
        verifiedSeller: data.verifiedSeller || false,
      }))
    })

    // Listen to stats subcollection if it exists
    const unsubStats = onSnapshot(doc(db, 'sellers', sellerId, 'stats', 'main'), (snap) => {
      if (!snap.exists()) {
        // No stats doc yet — compute from orders + products
        computeStatsFromOrdersAndProducts(sellerId)
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
        avgResponseMinutes: data.avgResponseMinutes ?? null,
        repeatBuyers: data.repeatBuyers || 0,
        deliverySuccess: data.deliverySuccess || 0,
        fulfilledOrders: data.fulfilledOrders || 0,
        totalOrdersProcessed: data.totalOrdersProcessed || 0,
        productCount: data.productCount || 0,
        productWithImageCount: data.productWithImageCount || 0,
        productQualityCount: data.productQualityCount || 0,
      }))
      setLoading(false)
    })

    return () => {
      unsubSeller()
      unsubStats()
    }
  }, [sellerId])

  /**
   * Fallback: compute stats from orders + products subcollections when stats/main doc doesn't exist.
   */
  const computeStatsFromOrdersAndProducts = async (sid: string) => {
    try {
      // Fetch orders
      const ordersSnap = await getDocs(query(collection(db, 'sellers', sid, 'orders')))
      const fulfilledOrdersArr = ordersSnap.docs.filter(d => d.data().status === 'fulfilled')
      const totalSales = fulfilledOrdersArr.reduce((sum, d) => {
        const qty = Number(d.data().quantity) || 1
        return sum + qty
      }, 0)
      const fulfilledOrders = fulfilledOrdersArr.length

      // Count unique buyers for repeat buyers
      const buyerNames = new Set(fulfilledOrdersArr.map(d => d.data().buyerName?.toLowerCase()).filter(Boolean))
      const repeatBuyers = fulfilledOrders > buyerNames.size ? fulfilledOrders - buyerNames.size : 0

      // Delivery success: fulfilled vs cancelled (all processed)
      const cancelledOrders = ordersSnap.docs.filter(d => d.data().status === 'cancelled').length
      const totalProcessed = fulfilledOrders + cancelledOrders
      const deliverySuccess = totalProcessed > 0 ? Math.round((fulfilledOrders / totalProcessed) * 100) : 0

      // Fetch products
      const productsSnap = await getDocs(query(collection(db, 'sellers', sid, 'products')))
      const productCount = productsSnap.size
      const productWithImageCount = productsSnap.docs.filter(d => {
        const data = d.data()
        return data.imageUrl || (data.images && data.images.length > 0)
      }).length
      // Quality products: name 5+ chars, description 20+ chars, has image
      const productQualityCount = productsSnap.docs.filter(d => {
        const data = d.data()
        const hasName = typeof data.name === 'string' && data.name.trim().length >= 5
        const hasDesc = typeof data.description === 'string' && data.description.trim().length >= 20
        const hasImage = data.imageUrl || (data.images && data.images.length > 0)
        return hasName && hasDesc && hasImage
      }).length

      setStats(prev => ({
        ...prev,
        totalSales,
        repeatBuyers,
        deliverySuccess,
        fulfilledOrders,
        totalOrdersProcessed: totalProcessed,
        productCount,
        productWithImageCount,
        productQualityCount,
      }))
      setLoading(false)
    } catch (err) {
      console.error('Error computing stats from orders:', err)
      setLoading(false)
    }
  }

  // Recompute raw badge conditions
  const realSellerConditionsMet = computeRealSellerBadge(
    sellerFields.phoneVerified ?? false,
    sellerFields.nationality,
    sellerFields.businessName,
    sellerFields.bio,
    stats.productCount,
  )

  const activeSellerConditionsMet = computeActiveSellerBadge(
    realSellerConditionsMet,
    stats.storeAgeDays,
    stats.fulfilledOrders,
    stats.deliverySuccess,
    stats.totalOrdersProcessed,
    stats.avgResponseMinutes,
    stats.productQualityCount,
  )

  // Apply grace period rules
  const realBadge = computeBadgeStatus(
    realSellerConditionsMet,
    sellerFields.realSellerBadgeEarnedAt,
    sellerFields.realSellerBadgeGraceUntil,
  )

  const activeBadge = computeBadgeStatus(
    activeSellerConditionsMet,
    sellerFields.activeSellerBadgeEarnedAt,
    sellerFields.activeSellerBadgeGraceUntil,
  )

  return {
    stats: {
      ...stats,
      realSellerBadge: realBadge.visible,
      realSellerBadgeStatus: realBadge.status,
      activeSellerBadge: activeBadge.visible,
      activeSellerBadgeStatus: activeBadge.status,
    },
    loading,
  }
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

// Helper to get a human-readable label for badge status
export function getBadgeStatusLabel(status: BadgeStatus, badgeName: string): string {
  switch (status) {
    case 'active': return badgeName
    case 'grace': return `${badgeName} (renewing)`
    case 'none': return ''
  }
}