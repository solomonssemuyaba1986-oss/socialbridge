import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { doc, getDoc, collection, getDocs, query, orderBy } from 'firebase/firestore'
import { auth, db } from './firebase'
import { onAuthStateChanged } from 'firebase/auth'

function Dashboard() {
  const [seller, setSeller] = useState<any>(null)
  const [products, setProducts] = useState<any[]>([])
  const [orders, setOrders] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) { navigate('/'); return }
      const docSnap = await getDoc(doc(db, 'sellers', user.uid))
      if (docSnap.exists()) {
        const data = docSnap.data()
        setSeller(data)
        const prodSnap = await getDocs(collection(db, 'sellers', user.uid, 'products'))
        setProducts(prodSnap.docs.map(d => ({ id: d.id, ...d.data() })))
        const ordSnap = await getDocs(query(collection(db, 'sellers', user.uid, 'orders'), orderBy('createdAt', 'desc')))
        setOrders(ordSnap.docs.map(d => ({ id: d.id, ...d.data() })))
      }
      setLoading(false)
    })
    return () => unsubscribe()
  }, [])

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
  const green = '#adff2f'

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
            { label: 'Pending Orders', value: orders.length.toString() },
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

        {/* Orders */}
        <h2 style={{ fontSize: '18px', fontWeight: '700', marginBottom: '16px', color: '#fff' }}>Orders</h2>
        {orders.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', background: '#1a1a1a', borderRadius: '12px', border: '1px dashed #333', marginBottom: '32px' }}>
            <p style={{ color: '#444', margin: 0 }}>No orders yet. Share your store link to start receiving orders.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '32px' }}>
            {orders.map(o => (
              <div key={o.id} style={{ background: '#1a1a1a', borderRadius: '12px', padding: '16px 20px', border: '1px solid #222', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <p style={{ margin: '0 0 4px', fontWeight: '700', fontSize: '15px', color: '#fff' }}>{o.buyerName}</p>
                  <p style={{ margin: '0 0 4px', color: '#888', fontSize: '13px' }}>{o.productName} × {o.quantity}</p>
                  <p style={{ margin: 0, color: green, fontSize: '13px', fontWeight: '700' }}>UGX {o.productPrice}</p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span style={{ background: '#222', color: '#aaa', padding: '4px 10px', borderRadius: '20px', fontSize: '12px' }}>Pending</span>
                  <p style={{ margin: '8px 0 0', color: '#444', fontSize: '12px' }}>
                    {o.createdAt?.toDate?.()?.toLocaleDateString() || 'Just now'}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Products */}
        <h2 style={{ fontSize: '18px', fontWeight: '700', marginBottom: '16px', color: '#fff' }}>Products</h2>
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