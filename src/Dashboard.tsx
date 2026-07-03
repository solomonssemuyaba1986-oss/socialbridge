import { useEffect, useState, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { doc, getDoc, collection, getDocs, updateDoc } from 'firebase/firestore'
import { auth, db } from './firebase'
import { onAuthStateChanged } from 'firebase/auth'
import { useSellerOrders } from './useSellerOrders'

interface Seller {
  businessName: string
  bio: string
  slug: string
  whatsapp?: string
}

interface Product {
  id: string
  name: string
  price: string
  description: string
  imageUrl: string
}

function Dashboard() {
  const [seller, setSeller] = useState<Seller | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState<string>('')
  const navigate = useNavigate()
  const location = useLocation()
  const green = '#adff2f'

  const navItems = [
    { label: 'Dashboard', path: '/dashboard', icon: '📊' },
    { label: 'Products', path: '/dashboard', icon: '🛍️' },
    { label: 'Orders', path: '/orders', icon: '📦' },
    { label: 'Inbox', path: '/inbox', icon: '📩' },
    { label: 'Analytics', path: '/dashboard', icon: '📈' },
    { label: 'Marketing', path: '/dashboard', icon: '📣' },
    { label: 'Payouts', path: '/dashboard', icon: '💸' },
    { label: 'Settings', path: '/edit-store', icon: '⚙️' },
    { label: 'Reviews', path: '/dashboard', icon: '⭐' },
  ]

  const getProductUrl = (product: Product) => `${storeLink}?productId=${product.id}`
  const getCaption = (product: Product) =>
    `${product.name} — UGX ${product.price}\nSee more from this seller at ${storeLink}\n${getProductUrl(product)}`
  const shareToWhatsApp = (product: Product) => window.open(`https://wa.me/?text=${encodeURIComponent(getCaption(product))}`, '_blank')
  const shareToTelegram = (product: Product) => window.open(`https://t.me/share/url?url=${encodeURIComponent(getProductUrl(product))}&text=${encodeURIComponent(getCaption(product))}`, '_blank')
  const shareToTwitter = (product: Product) => window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(getCaption(product))}`, '_blank')
  const shareToFacebook = (product: Product) => window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(getProductUrl(product))}`, '_blank')
  const copyCaption = async (product: Product) => { await navigator.clipboard.writeText(getCaption(product)); alert('Caption copied!') }

  const playNewOrderAlert = useCallback(() => {
    try {
      const audio = new Audio('/notification.mp3')
      audio.volume = 0.7
      audio.play().catch(() => {})
    } catch {
      // no sound file
    }
  }, [])

  const { orders, unreadCount } = useSellerOrders(playNewOrderAlert)

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
          setProducts(prodSnap.docs.map(d => ({ id: d.id, ...d.data() } as Product)))
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

  const markFulfilled = async (orderId: string) => {
    await updateDoc(doc(db, 'sellers', userId, 'orders', orderId), { status: 'fulfilled' })
  }

  const updateOrderStatus = async (orderId: string, status: string) => {
    await updateDoc(doc(db, 'sellers', userId, 'orders', orderId), { status })
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#0f0f0f', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: '#555', fontFamily: 'sans-serif' }}>Loading...</p>
    </div>
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
      <div style={{ position: 'fixed', left: 0, top: 0, bottom: 0, width: 260, background: '#070707', borderRight: '1px solid #111', padding: '28px 16px', display: 'flex', flexDirection: 'column', gap: '28px', zIndex: 20 }}>
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
            return (
              <button key={item.path + item.label} onClick={() => navigate(item.path)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 14px', borderRadius: '14px', border: 'none', cursor: 'pointer', textAlign: 'left', background: active ? '#0f2910' : 'transparent', color: active ? '#fff' : '#aaa', fontWeight: active ? 700 : 600, fontSize: '14px'
                }}>
                <span>{item.icon}</span>
                <span>{item.label}</span>
              </button>
            )
          })}
        </div>
        <div style={{ marginTop: 'auto' }}>
          <button onClick={() => { navigator.clipboard.writeText(storeLink); alert('Link copied!') }}
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
          <button onClick={() => { auth.signOut(); navigate('/') }}
            style={{ background: '#111', border: '1px solid #222', color: '#fff', borderRadius: '12px', padding: '10px 16px', cursor: 'pointer', fontSize: '13px' }}>
            Sign Out
          </button>
        </div>
        <div className="rt-container" style={{ maxWidth: '100%', margin: '0', padding: 0 }}>

        {unreadCount > 0 && (
          <div
            onClick={() => navigate('/inbox')}
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
                Tap to open Inbox and see who ordered what
              </p>
            </div>
            <span style={{ color: green, fontSize: '20px' }}>→</span>
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
  <button onClick={() => { navigator.clipboard.writeText(storeLink); alert('Link copied! Paste it everywhere you sell.') }}
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '32px' }}>
            {pendingOrders.map(o => (
  <div key={o.id} style={{ background: '#1a1a1a', borderRadius: '12px', padding: '16px 20px', border: '1px solid #222' }}>
    <div className="rt-order-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
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

    {/* Status Buttons */}
    <div className="rt-order-actions" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
      <button onClick={() => markFulfilled(o.id)}
        style={{ padding: '8px', background: green, color: '#000', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '11px', fontWeight: '700' }}>
        ✓ Confirm
      </button>
      <button onClick={() => updateOrderStatus(o.id, 'out_of_stock')}
        style={{ padding: '8px', background: 'transparent', color: '#ff4444', border: '1px solid #ff4444', borderRadius: '8px', cursor: 'pointer', fontSize: '11px', fontWeight: '600' }}>
        Out of Stock
      </button>
      <button onClick={() => updateOrderStatus(o.id, 'needs_details')}
        style={{ padding: '8px', background: 'transparent', color: '#888', border: '1px solid #333', borderRadius: '8px', cursor: 'pointer', fontSize: '11px', fontWeight: '600' }}>
        Need Details
      </button>
    </div>
  </div>
            ))}
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
                  <div style={{ marginTop: '10px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <button onClick={() => shareToWhatsApp(p)} style={{ flex: '1 1 48%', padding: '8px', background: '#25D366', border: 'none', color: '#000', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: '700' }}>WhatsApp</button>
                    <button onClick={() => shareToTelegram(p)} style={{ flex: '1 1 48%', padding: '8px', background: '#2CA5E0', border: 'none', color: '#000', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: '700' }}>Telegram</button>
                    <button onClick={() => shareToTwitter(p)} style={{ flex: '1 1 48%', padding: '8px', background: '#1DA1F2', border: 'none', color: '#000', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: '700' }}>Twitter</button>
                    <button onClick={() => shareToFacebook(p)} style={{ flex: '1 1 48%', padding: '8px', background: '#4267B2', border: 'none', color: '#fff', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: '700' }}>Facebook</button>
                    <button onClick={() => copyCaption(p)} style={{ width: '100%', padding: '10px', marginTop: '6px', background: '#444', border: 'none', color: '#fff', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: '700' }}>Copy caption</button>
                  </div>
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