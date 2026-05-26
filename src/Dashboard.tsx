import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
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
  const green = '#adff2f'

  const handleShareProduct = async (product: Product) => {
    const storeLink = `${window.location.origin}/store/${seller?.slug}?productId=${product.id}`
    const storeHandle = seller?.businessName ? `@${seller.businessName.replace(/\s+/g, '')}` : ''
    const shareText = `${product.name}\nUGX ${product.price}\n\nAvailable now\n${storeHandle}\n\n🟢 Order instantly\n${storeLink}\n\nPowered by Ratchet`
    try {
      if (navigator.share) {
        await navigator.share({
          title: product.name,
          text: shareText,
          url: storeLink
        })
        return
      }
      await navigator.clipboard.writeText(shareText)
      alert('Product share copy ready. Paste it into your status or chat.')
    } catch (err) {
      console.error('Share failed', err)
      try {
        await navigator.clipboard.writeText(shareText)
        alert('Could not open share sheet — text copied instead')
      } catch {
        alert('Could not share. Please copy your store link manually.')
      }
    }
  }

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
    <div style={{ minHeight: '100vh', background: '#0f0f0f', fontFamily: 'sans-serif', color: '#fff' }}>

      {/* Top Nav */}
      <div className="rt-topnav" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px', borderBottom: '1px solid #1a1a1a' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ background: green, width: '36px', height: '36px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '800', fontSize: '14px', color: '#000' }}>R</div>
          <span style={{ fontWeight: '700', fontSize: '16px' }}>Rachett</span>
          <span className="rt-store-name" style={{ background: '#1a1a1a', padding: '4px 10px', borderRadius: '20px', fontSize: '13px', color: '#aaa', border: '1px solid #222' }}>{seller.businessName}</span>
        </div>
        <div className="rt-topnav-actions" style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <button onClick={() => { navigator.clipboard.writeText(storeLink); alert('Link copied!') }}
            style={{ background: green, color: '#000', border: 'none', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: '700' }}>
            Copy Link
          </button>
          <button onClick={() => navigate(`/store/${seller.slug}`)}
            style={{ background: 'transparent', border: '1px solid #333', color: '#fff', padding: '8px 14px', borderRadius: '8px', cursor: 'pointer', fontSize: '13px' }}>
            View Store
          </button>
          <button
            onClick={() => navigate('/inbox')}
            style={{ background: unreadCount > 0 ? '#1a2a1a' : 'transparent', border: `1px solid ${unreadCount > 0 ? green : '#333'}`, color: '#fff', padding: '8px 14px', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', position: 'relative', display: 'flex', alignItems: 'center', gap: '8px' }}>
            📭 Inbox
            {unreadCount > 0 && (
              <span style={{
                background: green,
                color: '#000',
                borderRadius: '50%',
                minWidth: '22px',
                height: '22px',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '12px',
                fontWeight: '800',
                padding: '0 6px',
              }}>
                {unreadCount}
              </span>
            )}
          </button>
          <button onClick={() => { auth.signOut(); navigate('/') }}
            style={{ background: 'transparent', border: '1px solid #333', color: '#aaa', padding: '8px 14px', borderRadius: '8px', cursor: 'pointer', fontSize: '13px' }}>
            Sign Out
          </button>
        </div>
      </div>

      <div className="rt-container" style={{ maxWidth: '800px', margin: '0 auto', padding: '32px 20px' }}>

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
  <button onClick={() => navigate('/bulk-upload')}
    style={{ background: green, color: '#000', border: 'none', padding: '10px 18px', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '13px' }}>
    + Bulk Upload
  </button>
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
                  <button onClick={() => handleShareProduct(p)}
                    style={{ marginTop: '10px', width: '100%', padding: '10px', background: 'transparent', border: '1px solid #333', color: '#fff', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: '700' }}>
                    Share Product
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default Dashboard