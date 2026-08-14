import { useEffect, useState, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { doc, getDoc, collection, getDocs, updateDoc } from 'firebase/firestore'
import { auth, db } from './firebase'
import { onAuthStateChanged } from 'firebase/auth'
import { useSellerOrders } from './useSellerOrders'
import { useSellerMessages } from './useSellerMessages'
import { useSellerConversations } from './useSellerConversations'
import { useBuyerConversations } from './useBuyerConversations'
import { notify } from './notifications'
import LoadingScreen from './LoadingScreen'

interface Seller {
  businessName: string
  bio: string
  slug: string
  whatsapp?: string
  logoUrl?: string
  recoveryEmail?: string
  recoveryEmailVerified?: boolean
  recoveryEmailPromptCount?: number
  recoveryEmailLastPrompted?: any
}

interface Product {
  id: string
  name: string
  price: string
  description: string
  imageUrl: string
}

// Session cache so revisiting the dashboard renders instantly (no re-loading screen)
let cachedDashboard: { uid: string; seller: Seller; products: Product[] } | null = null
let dashboardLoadedOnce = false

// Spotlight baseline — survives remounts so existing unread orders never re-trigger it
let dashboardBaselineSet = false
let dashboardUnreadBaseline = 0

function Dashboard() {
  const initialCache = (() => {
    const me = auth.currentUser?.uid
    if (dashboardLoadedOnce && cachedDashboard && cachedDashboard.uid === me) return cachedDashboard
    return null
  })()
  const [seller, setSeller] = useState<Seller | null>(initialCache?.seller || null)
  const [products, setProducts] = useState<Product[]>(initialCache?.products || [])
  const [loading, setLoading] = useState(!initialCache)
  const [userId, setUserId] = useState<string>('')
  const navigate = useNavigate()
  const location = useLocation()
  const green = '#adff2f'

  // Recovery email
  const [recoveryEmailInput, setRecoveryEmailInput] = useState('')
  const [recoverySending, setRecoverySending] = useState(false)
  const [recoverySent, setRecoverySent] = useState(false)
  const [bannerDismissed, setBannerDismissed] = useState(false)

  const needsRecoveryEmail = seller?.recoveryEmail !== undefined 
    && seller.recoveryEmail === '' 
    && !seller.recoveryEmailVerified

  const handleAddRecoveryEmail = async () => {
    if (!recoveryEmailInput || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recoveryEmailInput)) return
    setRecoverySending(true)
    try {
      // Save email to seller doc
      await updateDoc(doc(db, 'sellers', userId), {
        recoveryEmail: recoveryEmailInput.toLowerCase().trim(),
        recoveryEmailPromptCount: (seller?.recoveryEmailPromptCount || 0) + 1,
        recoveryEmailLastPrompted: new Date(),
      })
      // Save email to Firestore — email delivery will be added in future (Resend/SendGrid)
      setRecoverySent(true)
      setBannerDismissed(true)
    } catch (err) {
      console.error('Recovery email error:', err)
    } finally {
      setRecoverySending(false)
    }
  }

  const navItems = [
    { label: 'Dashboard', path: '/dashboard', icon: '📊' },
    { label: 'Products', path: '/products', icon: '🛍️' },
    { label: 'Orders', path: '/orders', icon: '📦' },
    { label: 'Inbox', path: '/inbox', icon: '📩' },
    { label: 'Analytics', path: '/analytics', icon: '📈' },
    { label: 'Marketing', path: '/dashboard', icon: '📣' },
    { label: 'Payouts', path: '/dashboard', icon: '💸' },
    { label: 'Settings', path: '/edit-store', icon: '⚙️' },
    { label: 'Reviews', path: '/dashboard', icon: '⭐' },
  ]

  const playNewOrderAlert = useCallback(() => {
    try {
      const audio = new Audio('/notification.mp3')
      audio.volume = 0.7
      audio.play().catch(() => {})
    } catch {
      // no sound file
    }
  }, [])

  const { orders, unreadCount, loading: ordersLoading } = useSellerOrders(playNewOrderAlert)
  const { unreadCount: unreadMessagesCount } = useSellerMessages()
  const { unreadCount: unreadSellerConvoCount } = useSellerConversations()
  const { unreadCount: unreadBuyerConvoCount } = useBuyerConversations()

  const totalMessageUnread = unreadMessagesCount + unreadSellerConvoCount + unreadBuyerConvoCount

  // Spotlight — dims the screen ONLY when a genuinely NEW order arrives.
  // Baseline survives page revisits, so existing unread orders never re-trigger it.
  const [showSpotlight, setShowSpotlight] = useState(false)
  useEffect(() => {
    if (ordersLoading) return
    if (!dashboardBaselineSet) {
      // First real load: record the current unread count as the baseline — no spotlight
      dashboardBaselineSet = true
      dashboardUnreadBaseline = unreadCount
      return
    }
    if (unreadCount > dashboardUnreadBaseline) {
      setShowSpotlight(true)
      const timer = window.setTimeout(() => setShowSpotlight(false), 3000)
      return () => window.clearTimeout(timer)
    }
    if (unreadCount < dashboardUnreadBaseline) {
      dashboardUnreadBaseline = unreadCount
    }
  }, [unreadCount, ordersLoading])

  // Inbox notification sounds return in the native mobile app.
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) { navigate('/'); return }
      setUserId(user.uid)
      try {
        const docSnap = await getDoc(doc(db, 'sellers', user.uid))
        if (docSnap.exists()) {
          const data = docSnap.data() as Seller
          setSeller(data)
          const prodSnap = await getDocs(collection(db, 'sellers', user.uid, 'products'))
          const prodList = prodSnap.docs.map(d => ({ id: d.id, ...d.data() } as Product))
          setProducts(prodList)
          // Cache for instant render on next visit
          cachedDashboard = { uid: user.uid, seller: data, products: prodList }
          dashboardLoadedOnce = true
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Failed to load dashboard'
        console.error('Dashboard error:', errorMsg, err)
      } finally {
        setLoading(false)
      }
    })
    return () => unsubscribe()
  }, [navigate])

  // Status update functions moved to Orders page — dashboard is view-only
  if (loading) return (
    <LoadingScreen message="Warming up your store..." logo={seller?.logoUrl} />
  )

  if (!seller) return (
    <div style={{ minHeight: '100vh', background: '#0f0f0f', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: '#555', fontFamily: 'sans-serif' }}>No store found.</p>
    </div>
  )

  const storeLink = `${window.location.origin}/store/${seller.slug}`
  const pendingOrders = orders.filter(o => !['fulfilled', 'out_of_stock'].includes(o.status || ''))

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f0f', fontFamily: 'sans-serif', color: '#fff', display: 'flex' }}>
      {/* Spotlight dark overlay */}
      {showSpotlight && (
        <div
          onClick={() => setShowSpotlight(false)}
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.85)',
            zIndex: 30,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer',
            animation: 'rachettFadeIn 0.5s ease',
          }}>
          <p style={{ color: '#888', fontSize: '14px', textAlign: 'center', position: 'absolute', bottom: '20%' }}>
            Tap anywhere to dismiss
          </p>
          <style>{`
            @keyframes rachettFadeIn { from { opacity: 0 } to { opacity: 1 } }
            @keyframes rachettPulse { 0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(173,255,47,0.6); } 50% { transform: scale(1.15); box-shadow: 0 0 0 8px rgba(173,255,47,0.2); } }
          `}</style>
        </div>
      )}
      <div style={{ position: 'fixed', left: 0, top: 0, bottom: 0, width: 260, background: '#070707', borderRight: '1px solid #111', padding: '28px 16px', display: 'flex', flexDirection: 'column', gap: '28px', zIndex: showSpotlight ? 40 : 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px' }}>
          <div style={{ background: green, width: 34, height: 34, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 16, color: '#000' }}>R</div>
          <div>
            <div style={{ fontWeight: 800, color: '#fff', fontSize: 16 }}>Rachett</div>
            <div style={{ color: '#777', fontSize: 12 }}>{seller.businessName}</div>
          </div>
        </div>
        <div style={{ display: 'grid', gap: '6px' }}>
          {navItems.map(item => {
            const active = location.pathname === item.path || (item.path === '/dashboard' && location.pathname === '/dashboard')
            const showBadge = item.label === 'Orders' ? orders.filter(o => o.status === 'pending' || !o.status).length : item.label === 'Inbox' ? totalMessageUnread : 0
            return (
              <button key={item.path + item.label} onClick={() => navigate(item.path)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 14px', borderRadius: '14px', border: 'none', cursor: 'pointer', textAlign: 'left', background: active ? '#0f2910' : 'transparent', color: active ? '#fff' : '#aaa', fontWeight: active ? 700 : 600, fontSize: '14px'
                }}>
                <span>{item.icon}</span>
                <span style={{ flex: 1 }}>{item.label}</span>
                {showBadge > 0 ? (
                  <span style={{ minWidth: '24px', height: '24px', borderRadius: '999px', background: green, color: '#000', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 900, padding: '0 6px', boxShadow: `0 0 0 2px rgba(173,255,47,0.2)`, animation: showSpotlight ? 'rachettPulse 0.8s ease-in-out infinite' : 'none' }}>
                    {showBadge}
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
        <div style={{ marginTop: 'auto' }}>
          <button onClick={() => { navigator.clipboard.writeText(storeLink); alert(notify.storeLinkCopied) }}
            style={{ width: '100%', padding: '12px', borderRadius: '14px', border: '1px solid #222', background: '#111', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>
            Copy Store Link
          </button>
        </div>
      </div>

      <div style={{ width: '100%', marginLeft: 260, padding: '32px 28px', minHeight: '100vh' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button
              style={{ display: 'none', padding: '10px 12px', borderRadius: '12px', border: '1px solid #333', background: '#111', color: '#fff', cursor: 'pointer', fontSize: '16px' }}>
              ☰
            </button>
            <div>
              <div style={{ fontSize: '20px', fontWeight: 800 }}>Seller Dashboard</div>
              <div style={{ fontSize: '13px', color: '#888' }}>Manage products, orders, inbox and growth.</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={() => navigate('/browse')}
              style={{ background: green, border: 'none', color: '#000', borderRadius: '12px', padding: '10px 16px', cursor: 'pointer', fontSize: '13px', fontWeight: '700' }}>
              🏪 Market
            </button>
          </div>
        </div>
        <div className="rt-container" style={{ maxWidth: '100%', margin: '0', padding: 0 }}>

        {unreadCount > 0 && (
          <div
            onClick={() => navigate('/orders')}
            style={{
              background: '#1a2a1a',
              border: `1px solid ${green}`,
              borderRadius: '12px',
              padding: '16px 20px',
              marginBottom: '24px',
              cursor: 'pointer',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
            <div>
              <p style={{ margin: '0 0 4px', color: green, fontWeight: '800', fontSize: '15px' }}>
                {unreadCount} new order{unreadCount !== 1 ? 's' : ''} waiting
              </p>
              <p style={{ margin: 0, color: '#888', fontSize: '13px' }}>
                Tap to open and see who ordered what
              </p>
            </div>
            <span style={{ color: green, fontSize: '20px' }}>→</span>
          </div>
        )}

        {/* Recovery Email Banner */}
        {needsRecoveryEmail && !bannerDismissed && (
          <div style={{
            background: '#1a1a2e', border: '1px solid #3333aa', borderRadius: '12px',
            padding: '16px 20px', marginBottom: '24px',
          }}>
            {!recoverySent ? (
              <>
                <p style={{ margin: '0 0 4px', color: '#88aaff', fontWeight: '800', fontSize: '14px' }}>
                  🔐 Add a recovery email
                </p>
                <p style={{ margin: '0 0 12px', color: '#888', fontSize: '13px' }}>
                  If you lose access to your phone number, we'll use this email to help you recover your store.
                </p>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    value={recoveryEmailInput}
                    onChange={e => setRecoveryEmailInput(e.target.value)}
                    placeholder="you@example.com"
                    style={{ flex: 1, padding: '10px 12px', borderRadius: '8px', border: '1px solid #3333aa', background: '#111', color: '#fff', fontSize: '14px', boxSizing: 'border-box' }}
                  />
                  <button onClick={handleAddRecoveryEmail} disabled={recoverySending || !recoveryEmailInput}
                    style={{ padding: '10px 18px', background: recoverySending || !recoveryEmailInput ? '#333' : '#4466cc', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: recoverySending || !recoveryEmailInput ? 'not-allowed' : 'pointer', fontSize: '13px', whiteSpace: 'nowrap' }}>
                    {recoverySending ? 'Saving...' : 'Add Email'}
                  </button>
                </div>
                <button onClick={() => {
                  setBannerDismissed(true)
                  updateDoc(doc(db, 'sellers', userId), {
                    recoveryEmailLastPrompted: new Date(),
                    recoveryEmailPromptCount: (seller.recoveryEmailPromptCount || 0) + 1,
                  })
                }}
                  style={{ marginTop: '8px', background: 'transparent', color: '#666', border: 'none', cursor: 'pointer', fontSize: '12px', padding: 0 }}>
                  Remind me later
                </button>
              </>
            ) : (
              <>
                <p style={{ margin: '0 0 4px', color: green, fontWeight: '800', fontSize: '14px' }}>
                  ✅ Recovery email saved!
                </p>
                <p style={{ margin: 0, color: '#888', fontSize: '13px' }}>
                  {recoveryEmailInput} — we'll use this to help you recover your store if needed.
                </p>
              </>
            )}
          </div>
        )}

        {/* Stats */}
        <div className="rt-stats" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px', marginBottom: '32px' }}>
          <button
            type="button"
            onClick={() => navigate('/orders')}
            style={{
              background: '#1a1a1a', borderRadius: '12px', padding: '24px', border: `1px solid ${green}`,
              cursor: 'pointer', textAlign: 'left', width: '100%',
            }}>
            <p style={{ fontSize: '32px', fontWeight: '800', margin: '0 0 4px', color: green }}>{orders.length}</p>
            <p style={{ fontSize: '13px', color: '#888', margin: '0 0 4px' }}>Total Orders</p>
            <p style={{ fontSize: '11px', color: green, margin: 0, fontWeight: '600' }}>Tap to view all →</p>
          </button>
          <div style={{ background: '#1a1a1a', borderRadius: '12px', padding: '24px', border: '1px solid #222' }}>
            <p style={{ fontSize: '32px', fontWeight: '800', margin: '0 0 4px', color: green }}>{products.length}</p>
            <p style={{ fontSize: '13px', color: '#888', margin: 0 }}>Products</p>
          </div>
          <div style={{ background: '#1a1a1a', borderRadius: '12px', padding: '24px', border: '1px solid #222' }}>
            <p style={{ fontSize: '32px', fontWeight: '800', margin: '0 0 4px', color: green }}>{pendingOrders.length}</p>
            <p style={{ fontSize: '13px', color: '#888', margin: 0 }}>Pending Orders</p>
          </div>
        </div>

        {/* Store Link */}
        {/* Share Guide */}
<div style={{ borderTop: '1px solid #222', paddingTop: '16px' }}>
  <p style={{ color: '#888', fontSize: '13px', margin: '0 0 12px' }}>
    📢 <span style={{ color: '#fff', fontWeight: '600' }}>Grow your sales</span> — paste your link anywhere you have an audience. Instagram bio, TikTok profile, WhatsApp status, Facebook, Telegram, Pinterest, Reddit — anywhere.
  </p>
  <button onClick={() => { navigator.clipboard.writeText(storeLink); alert(notify.storeLinkCopied) }}
    style={{ width: '100%', padding: '12px', background: green, color: '#000', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '14px' }}>
    📋 Copy Link — Share Everywhere
  </button>
</div>

        {/* Pending Orders */}
        <h2 style={{ fontSize: '18px', fontWeight: '700', marginBottom: '16px' }}>
          Pending Orders <span style={{ color: green }}>({pendingOrders.length})</span>
        </h2>
        {pendingOrders.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', background: '#1a1a1a', borderRadius: '12px', border: '1px dashed #333', marginBottom: '32px' }}>
            <p style={{ color: '#444', margin: 0 }}>No pending orders.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '24px' }}>
            {pendingOrders.slice(0, 3).map(o => (
  <div key={o.id} onClick={() => navigate('/orders')}
    style={{ background: '#1a1a1a', borderRadius: '12px', padding: '16px 20px', border: '1px solid #222', cursor: 'pointer' }}>
    <div className="rt-order-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
      <div>
        <p style={{ margin: '0 0 4px', fontWeight: '700', fontSize: '15px', color: '#fff' }}>{o.buyerName}</p>
        <p style={{ margin: '0 0 4px', color: '#888', fontSize: '13px' }}>{o.productName} × {o.quantity}</p>
        <p style={{ margin: '0 0 4px', color: green, fontSize: '13px', fontWeight: '700' }}>UGX {o.productPrice}</p>
        {o.deliveryArea && <p style={{ margin: '0 0 4px', color: '#666', fontSize: '12px' }}>📍 {o.deliveryArea}</p>}
        {o.orderId && <p style={{ margin: 0, color: '#444', fontSize: '12px' }}>#{o.orderId}</p>}
      </div>
      <p style={{ margin: 0, color: '#444', fontSize: '12px' }}>
        {o.createdAt?.toDate?.()?.toLocaleDateString() || 'Just now'}
      </p>
    </div>
    <span style={{ color: '#555', fontSize: '12px' }}>Tap to manage →</span>
  </div>
            ))}
            {pendingOrders.length > 3 && (
              <button onClick={() => navigate('/orders')}
                style={{ padding: '12px', background: 'transparent', color: green, border: `1px solid ${green}`, borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: '700' }}>
                🟢 View all {pendingOrders.length} pending orders →
              </button>
            )}
          </div>
        )}

        {/* Products */}
        <div className="rt-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
  <h2 style={{ fontSize: '18px', fontWeight: '700', margin: 0 }}>Products</h2>
  <div style={{ display: 'flex', gap: '8px' }}>
    <button onClick={() => navigate('/bulk-upload')}
      style={{ background: green, color: '#000', border: 'none', padding: '10px 18px', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '13px' }}>
      + Bulk Upload
    </button>
    <button onClick={() => navigate('/edit-store')}
      style={{ background: '#444', color: '#fff', border: 'none', padding: '10px 14px', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '13px' }}>
      Edit Store
    </button>
  </div>
</div>
        {products.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', background: '#1a1a1a', borderRadius: '12px', border: '1px dashed #333' }}>
            <p style={{ color: '#444', margin: 0 }}>No products yet.</p>
          </div>
        ) : (
          <div className="rt-products" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            {products.map(p => (
              <div key={p.id} style={{ background: '#1a1a1a', borderRadius: '12px', overflow: 'hidden', border: '1px solid #222' }}>
                <img src={p.imageUrl || 'https://placehold.co/300x200'} alt={p.name}
                  style={{ width: '100%', height: '140px', objectFit: 'cover' }} />
                <div style={{ padding: '12px' }}>
                  <p style={{ margin: '0 0 4px', fontWeight: '600', fontSize: '14px' }}>{p.name}</p>
                  <p style={{ margin: 0, fontWeight: '700', color: green, fontSize: '14px' }}>UGX {p.price}</p>
                </div>
              </div>
            ))}
          </div>
        )}
        </div>
      </div>
    </div>
  )
}

export default Dashboard