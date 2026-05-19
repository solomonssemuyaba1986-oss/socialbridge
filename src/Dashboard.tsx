import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { doc, getDoc, collection, getDocs, query, orderBy, updateDoc } from 'firebase/firestore'
import { auth, db } from './firebase'
import { onAuthStateChanged } from 'firebase/auth'

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

interface Order {
  id: string
  buyerName: string
  productName: string
  productPrice: string
  quantity: number
  createdAt: any
  status?: string
  deliveryArea?: string
  orderId?: string
}

function Dashboard() {
  const [seller, setSeller] = useState<Seller | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState<string>('')
  const navigate = useNavigate()
  const green = '#adff2f'
  const prevOrderCount = useRef(0)

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
          const ordSnap = await getDocs(query(collection(db, 'sellers', user.uid, 'orders'), orderBy('createdAt', 'desc')))
         const newOrders = ordSnap.docs.map(d => ({ id: d.id, ...d.data() }))as any[]
          setOrders(newOrders)
          if (prevOrderCount.current > 0 && newOrders.length > prevOrderCount.current) {
           const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3')
           audio.volume = 0.7
          audio.play()
       }
       prevOrderCount.current = newOrders.length
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Failed to load dashboard'
        console.error('Dashboard error:', errorMsg, err)
      } finally {
        setLoading(false)
      }
    })
    return () => unsubscribe()
  }, [])

  const markFulfilled = async (orderId: string) => {
    await updateDoc(doc(db, 'sellers', userId, 'orders', orderId), {
      status: 'fulfilled'
    })
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: 'fulfilled' } : o))
  }

  const updateOrderStatus = async (orderId: string, status: string) => {
    await updateDoc(doc(db, 'sellers', userId, 'orders', orderId), { status })
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status } : o))
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

  const storeLink = `https://socialbridge-dun.vercel.app/store/${seller.slug}`
  const pendingOrders = orders.filter(o => !['fulfilled', 'out_of_stock'].includes(o.status || ''))
  const fulfilledOrders = orders.filter(o => o.status === 'fulfilled')
  const outOfStockOrders = orders.filter(o => o.status === 'out_of_stock')

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f0f', fontFamily: 'sans-serif', color: '#fff' }}>

      {/* Top Nav */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px', borderBottom: '1px solid #1a1a1a' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ background: green, width: '36px', height: '36px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '800', fontSize: '14px', color: '#000' }}>SB</div>
          <span style={{ fontWeight: '700', fontSize: '16px' }}>SocialBridge</span>
          <span style={{ background: '#1a1a1a', padding: '4px 10px', borderRadius: '20px', fontSize: '13px', color: '#aaa', border: '1px solid #222' }}>{seller.businessName}</span>
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <button onClick={() => { navigator.clipboard.writeText(storeLink); alert('Link copied!') }}
            style={{ background: green, color: '#000', border: 'none', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: '700' }}>
            Copy Link
          </button>
          <button onClick={() => navigate(`/store/${seller.slug}`)}
            style={{ background: 'transparent', border: '1px solid #333', color: '#fff', padding: '8px 14px', borderRadius: '8px', cursor: 'pointer', fontSize: '13px' }}>
            View Store
          </button>
          <button onClick={() => { auth.signOut(); navigate('/') }}
            style={{ background: 'transparent', border: '1px solid #333', color: '#aaa', padding: '8px 14px', borderRadius: '8px', cursor: 'pointer', fontSize: '13px' }}>
            Sign Out
          </button>
        </div>
      </div>

      <div style={{ maxWidth: '800px', margin: '0 auto', padding: '32px 20px' }}>

        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px', marginBottom: '32px' }}>
          {[
            { label: 'Total Orders', value: orders.length.toString() },
            { label: 'Products', value: products.length.toString() },
            { label: 'Pending Orders', value: pendingOrders.length.toString() },
          ].map(stat => (
            <div key={stat.label} style={{ background: '#1a1a1a', borderRadius: '12px', padding: '24px', border: '1px solid #222' }}>
              <p style={{ fontSize: '32px', fontWeight: '800', margin: '0 0 4px', color: green }}>{stat.value}</p>
              <p style={{ fontSize: '13px', color: '#888', margin: 0 }}>{stat.label}</p>
            </div>
          ))}
        </div>

        {/* Store Link */}
        <div style={{ background: '#1a1a1a', borderRadius: '12px', padding: '20px 24px', border: '1px solid #222', marginBottom: '32px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <p style={{ margin: '0 0 4px', fontWeight: '600', fontSize: '14px' }}>Your Store Link</p>
            <p style={{ margin: 0, color: green, fontSize: '13px' }}>{storeLink}</p>
          </div>
          <button onClick={() => { navigator.clipboard.writeText(storeLink); alert('Link copied!') }}
            style={{ background: green, color: '#000', border: 'none', padding: '10px 20px', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '13px' }}>
            Copy & Share
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
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
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
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
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

        {/* Fulfilled Orders */}
        {fulfilledOrders.length > 0 && (
          <>
            <h2 style={{ fontSize: '18px', fontWeight: '700', marginBottom: '16px', color: '#555' }}>
              Fulfilled Orders ({fulfilledOrders.length})
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '32px' }}>
              {fulfilledOrders.map(o => (
                <div key={o.id} style={{ background: '#111', borderRadius: '12px', padding: '16px 20px', border: '1px solid #1a1a1a', display: 'flex', justifyContent: 'space-between', alignItems: 'center', opacity: 0.6 }}>
                  <div>
                    <p style={{ margin: '0 0 4px', fontWeight: '700', fontSize: '15px', color: '#fff' }}>{o.buyerName}</p>
                    <p style={{ margin: '0 0 4px', color: '#666', fontSize: '13px' }}>{o.productName} × {o.quantity}</p>
                    <p style={{ margin: 0, color: '#555', fontSize: '13px' }}>UGX {o.productPrice}</p>
                  </div>
                  <span style={{ background: '#1a2a1a', color: green, padding: '4px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: '700' }}>✓ Done</span>
                </div>
              ))}
            </div>
          </>
        )}

        {outOfStockOrders.length > 0 && (
          <>
            <h2 style={{ fontSize: '18px', fontWeight: '700', marginBottom: '16px', color: '#555' }}>
              Out of Stock ({outOfStockOrders.length})
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '32px' }}>
              {outOfStockOrders.map(o => (
                <div key={o.id} style={{ background: '#111', borderRadius: '12px', padding: '16px 20px', border: '1px solid #1a1a1a', opacity: 0.6 }}>
                  <p style={{ margin: '0 0 4px', fontWeight: '700', fontSize: '15px', color: '#fff' }}>{o.buyerName}</p>
                  <p style={{ margin: '0 0 4px', color: '#666', fontSize: '13px' }}>{o.productName} × {o.quantity}</p>
                  <span style={{ background: '#2a1a1a', color: '#ff4444', padding: '4px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: '700' }}>Out of Stock</span>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Products */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
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
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
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
  )
}

export default Dashboard