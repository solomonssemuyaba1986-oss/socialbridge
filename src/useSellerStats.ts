import { useEffect, useState } from 'react'
import { doc, onSnapshot, collection, query, getDocs } from 'firebase/firestore'
import { db } from './firebase'
import { TRUST_COLLECTION, isPhoneProven } from './trust'
import { meetsReliableCriteria } from './reliableBadge'

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
  reliableSellerBadge: boolean
  reliableSellerBadgeStatus: BadgeStatus
  productCount: number
  productWithImageCount: number
  productQualityCount: number
  fulfilledOrders: number
  totalOrdersProcessed: number
  /** Rachett-measured (server): completed orders ÷ all orders. `null` until measured. */
  orderCompletionRate: number | null
  completedOrders: number
  totalOrders: number
}

function computeStoreAge(createdAt: any): { label: string; days: number } {
  if (!createdAt) return { label: 'New on rachett', days: 0 }

  const created = createdAt.toDate ? createdAt.toDate() : new Date(createdAt)
  const now = new Date()
  const diffMs = now.getTime() - created.getTime()
  const diffMonths = Math.floor(diffMs / (1000 * 60 * 60 * 24 * 30))
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays < 30) {
    const label = diffDays <= 1 ? 'New on rachett' : `${diffDays} days on rachett`
    return { label, days: diffDays }
  }
  if (diffMonths < 12) {
    return { label: `${diffMonths} month${diffMonths === 1 ? '' : 's'} on rachett`, days: diffDays }
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
 * Real Seller Badge (🟢): auto-awarded when all 6 conditions pass:
 * - Phone verified via OTP
 * - Nationality filled in
 * - Location filled in
 * - Business name + bio filled
 * - 1+ product added
 */
function computeRealSellerBadge(
  phoneVerified: boolean,
  nationality: string | undefined,
  location: string | undefined,
  businessName: string | undefined,
  bio: string | undefined,
  productCount: number,
): boolean {
  return Boolean(
    phoneVerified &&
    nationality &&
    location &&
    businessName &&
    bio &&
    productCount >= 1,
  )
}

/**
 * The old 🔵 Active Seller badge used to live here. It asked for six things at once — age, order
 * count, delivery success, a 24-hour reply, and three "quality" products — and because it was
 * recomputed in the browser it was really just a mirror of what the seller had written about
 * themselves. It is gone. The 💎 Reliable badge replaces it, and its two questions are answered by
 * rachett from real orders and real replies (see `reliableBadge.ts` and `functions/sellerStats.js`).
 */

function computeBadgeStatus(
  conditionsMet: boolean,
  earnedAt: number | undefined,
  graceUntil: number | undefined,
): { visible: boolean; status: BadgeStatus } {
  const now = Date.now()

  if (conditionsMet) {
    return { visible: true, status: 'active' }
  }

  if (earnedAt && graceUntil && now < graceUntil) {
    return { visible: true, status: 'grace' }
  }

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
    storeAge: 'New on rachett',
    storeAgeDays: 0,
    repeatBuyers: 0,
    deliverySuccess: 0,
    verifiedSeller: false,
    realSellerBadge: false,
    realSellerBadgeStatus: 'none',
    reliableSellerBadge: false,
    reliableSellerBadgeStatus: 'none',
    productCount: 0,
    productWithImageCount: 0,
    productQualityCount: 0,
    fulfilledOrders: 0,
    totalOrdersProcessed: 0,
    orderCompletionRate: null,
    completedOrders: 0,
    totalOrders: 0,
  })
  const [loading, setLoading] = useState(true)

  /**
   * The server's proof of the phone number, or null for a seller who has never verified.
   *
   * This is the document the 🟢 badge now rests on, and the reason it can be trusted is that no
   * browser can write it — see `firestore.rules` and `trust.ts`.
   */
  const [trustProof, setTrustProof] = useState<{ phoneProven?: unknown } | null>(null)

  const [sellerFields, setSellerFields] = useState<{
    phoneVerified?: boolean
    nationality?: string
    location?: string
    idDocumentPath?: string
    idStatus?: string
    businessName?: string
    bio?: string
    realSellerBadgeEarnedAt?: number
    realSellerBadgeGraceUntil?: number
  }>({})

  useEffect(() => {
    if (!sellerId) {
      setLoading(false)
      return
    }

    const unsubSeller = onSnapshot(doc(db, 'sellers', sellerId), (snap) => {
      if (!snap.exists()) return
      const data = snap.data()

      const age = computeStoreAge(data.createdAt)

      setSellerFields({
        // Strict on purpose: `"true"` is not `true`, and the fallback below must not be fooled by
        // a value that merely looks like a proof.
        phoneVerified: data.phoneVerified === true,
        nationality: data.nationality || undefined,
        location: data.location || undefined,
        idDocumentPath: data.idDocumentPath || undefined,
        idStatus: data.idStatus || undefined,
        businessName: data.businessName || undefined,
        bio: data.bio || undefined,
        realSellerBadgeEarnedAt: data.realSellerBadgeEarnedAt || undefined,
        realSellerBadgeGraceUntil: data.realSellerBadgeGraceUntil || undefined,
      })

      setStats(prev => ({
        ...prev,
        storeAge: age.label,
        storeAgeDays: age.days,
        verifiedSeller: data.verifiedSeller || false,
        // The shop's rating, recomputed by `recomputeSellerRating` (functions/index.js) every time
        // a buyer comments anywhere in the shop. It rides on the seller document — the one this
        // listener already holds — so every card can show it without reading a single comment.
        // `firestore.rules` refuses these keys from a browser, so this is rachett's own number
        // rather than something a seller typed. Absent = nobody has rated the shop yet.
        avgRating: Number(data.ratingAvg) || 0,
        reviewCount: Number(data.ratingCount) || 0,
      }))
    })

    // Rachett's own measurements — the completion rate and the average first-reply time. The
    // server writes only these (see `functions/sellerStats.js`); everything else the store page
    // shows is derived from the shop's own orders and products, below, so a stats document that
    // appears mid-session can never blank a number the shop already had.
    const unsubStats = onSnapshot(doc(db, 'sellers', sellerId, 'stats', 'main'), (snap) => {
      if (!snap.exists()) return
      const data = snap.data()
      setStats(prev => ({
        ...prev,
        completedOrders: data.completedOrders ?? prev.completedOrders,
        totalOrders: data.totalOrders ?? prev.totalOrders,
        orderCompletionRate: data.orderCompletionRate ?? prev.orderCompletionRate,
        avgResponseMinutes: data.avgResponseMinutes ?? prev.avgResponseMinutes,
        responseTime: computeResponseTimeLabel(data.avgResponseMinutes ?? prev.avgResponseMinutes),
      }))
      setLoading(false)
    })

    // The numbers a shop can count for itself: sales, delivery success, product quality. Read
    // straight from its orders and products — the server document carries none of them.
    computeStatsFromOrdersAndProducts(sellerId)

    // The proof, from the one place a browser cannot write. For a shop created after the move
    // this is the only document that carries it — the seller document may not hold the field at
    // all any more, so a badge that only read there would go silently blank.
    const unsubTrust = onSnapshot(doc(db, TRUST_COLLECTION, sellerId), (snap) => {
      setTrustProof(snap.exists() ? snap.data() : null)
    })

    return () => {
      unsubSeller()
      unsubStats()
      unsubTrust()
    }
  }, [sellerId])

  const computeStatsFromOrdersAndProducts = async (sid: string) => {
    try {
      const ordersSnap = await getDocs(query(collection(db, 'sellers', sid, 'orders')))
      const fulfilledOrdersArr = ordersSnap.docs.filter(d => d.data().status === 'fulfilled')
      const totalSales = fulfilledOrdersArr.reduce((sum, d) => {
        const qty = Number(d.data().quantity) || 1
        return sum + qty
      }, 0)
      const fulfilledOrders = fulfilledOrdersArr.length

      const buyerNames = new Set(fulfilledOrdersArr.map(d => d.data().buyerName?.toLowerCase()).filter(Boolean))
      const repeatBuyers = fulfilledOrders > buyerNames.size ? fulfilledOrders - buyerNames.size : 0

      const cancelledOrders = ordersSnap.docs.filter(d => d.data().status === 'cancelled').length
      const totalProcessed = fulfilledOrders + cancelledOrders
      const deliverySuccess = totalProcessed > 0 ? Math.round((fulfilledOrders / totalProcessed) * 100) : 0

      const productsSnap = await getDocs(query(collection(db, 'sellers', sid, 'products')))
      const productCount = productsSnap.size
      const productWithImageCount = productsSnap.docs.filter(d => {
        const data = d.data()
        return data.imageUrl || (data.images && data.images.length > 0)
      }).length
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

  const realSellerConditionsMet = computeRealSellerBadge(
    // The two possible homes for the proof, in the order they are trusted: the server's record
    // first, the frozen pre-move field on an older shop second. `trust.ts` decides, so the rule
    // is written down once and proved by `_trust_check.cjs`.
    isPhoneProven({ trust: trustProof, seller: sellerFields }),
    sellerFields.nationality,
    sellerFields.location,
    sellerFields.businessName,
    sellerFields.bio,
    stats.productCount,
  )

  const reliableSellerConditionsMet = meetsReliableCriteria({
    realSeller: realSellerConditionsMet,
    orderCompletionRate: stats.orderCompletionRate,
    totalOrders: stats.totalOrders,
    avgResponseMinutes: stats.avgResponseMinutes,
  })

  const realBadge = computeBadgeStatus(
    realSellerConditionsMet,
    sellerFields.realSellerBadgeEarnedAt,
    sellerFields.realSellerBadgeGraceUntil,
  )

  // The 💎 Reliable badge has no grace timer and is never persisted: it simply reflects the last
  // numbers rachett measured, so it comes and goes with the shop's own behaviour.
  const reliableBadge = computeBadgeStatus(reliableSellerConditionsMet, undefined, undefined)

  return {
    stats: {
      ...stats,
      realSellerBadge: realBadge.visible,
      realSellerBadgeStatus: realBadge.status,
      reliableSellerBadge: reliableBadge.visible,
      reliableSellerBadgeStatus: reliableBadge.status,
    },
    loading,
  }
}

/** "Selling since Mar 2026" / "12 days on rachett" / "New on rachett". */
export function getStoreAgeLabel(createdAt: unknown): string {
  return computeStoreAge(createdAt).label
}

export function getSalesLabel(totalSales: number): string {
  return computeSalesLabel(totalSales)
}

export function formatRating(rating: number): string {
  return rating.toFixed(1)
}

export function renderStars(rating: number): string {
  const full = Math.floor(rating)
  const half = rating - full >= 0.5 ? 1 : 0
  const empty = 5 - full - half
  return '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(empty)
}

export function getBadgeStatusLabel(status: BadgeStatus, badgeName: string): string {
  switch (status) {
    case 'active': return badgeName
    case 'grace': return `${badgeName} (renewing)`
    case 'none': return ''
  }
}