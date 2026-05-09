import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { doc, getDoc, collection, getDocs } from 'firebase/firestore'
import { auth, db } from './firebase'
import { onAuthStateChanged } from 'firebase/auth'

function Dashboard() {
  const [seller, setSeller] = useState<any>(null)
  const [products, setProducts] = useState<any[]>([])
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
      }
      setLoading(false)
    })
    return () => unsubscribe()
  }, [])

  if (loading) return <p style={{ textAlign: 'center', marginTop: '40px' }}>Loading...</p>
  if (!seller) return <p style={{ textAlign: 'center', marginTop: '40px' }}>No store found.</p>

  const storeLink = `${window.location.origin}/store/${seller.slug}`

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f0f', fontFamily: 'sans-serif', color: '#fff' }}>
      
      {/* Top Nav */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px', borderBottom: '1px solid #222' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ background: '#22c55e', width: '36px', height: '36px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '700', fontSize: '14px' }}>SB</div>
          <span style={{ fontWeight: '700', fontSize: '16px' }}>SocialBridge</span>
          <span style={{ background: '#222', padding: '4px 10px', borderRadius: '20px', fontSize: '13px', color: '#aaa' }}>{seller.businessName}</span>
        </div>
        <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
          <button onClick={() => { navigator.clipboard.writeText(storeLink); alert('Link copied!') }}
            style={{ background: 'transparent', border: '1px solid #333', color: '#fff', padding: '8px 14px', borderRadius: '8px', cursor: 'pointer', fontSize: '13px' }}>
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

      {/* Stats */}
      <div style={{ maxWidth: '800px', margin: '0 auto', padding: '32px 20px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px', marginBottom: '32px' }}>
          {[
            { label: 'Total Orders', value: '0' },
            { label: 'Products', value: products.length.toString() },
            { label: 'Pending Orders', value: '0' },
          ].map(stat => (
            <div key={stat.label} style={{ background: '#1a1a1a', borderRadius: '12px', padding: '24px', border: '1px solid #222' }}>
              <p style={{ fontSize: '32px', fontWeight: '800', margin: '0 0 4px', color: '#fff' }}>{stat.value}</p>
              <p style={{ fontSize: '13px', color: '#888', margin: 0 }}>{stat.label}</p>
            </div>
          ))}
        </div>

        {/* Store Link Banner */}
        <div style={{ background: '#1a1a1a', borderRadius: '12px', padding: '20px 24px', border: '1px solid #222', marginBottom: '32px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <p style={{ margin: '0 0 4px', fontWeight: '600', fontSize: '14px' }}>Your Store Link</p>
            <p style={{ margin: 0, color: '#22c55e', fontSize: '13px' }}>{storeLink}</p>
          </div>
          <button onClick={() => { navigator.clipboard.writeText(storeLink); alert('Link copied!') }}
            style={{ background: '#22c55e', color: '#000', border: 'none', padding: '10px 20px', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '13px' }}>
            Copy & Share
          </button>
        </div>

        {/* Products Section */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: '700' }}>Products</h2>
          <button onClick={() => navigate(`/store/${seller.slug}`)}
            style={{ background: '#fff', color: '#000', border: 'none', padding: '10px 18px', borderRadius: '8px', fontWeight: '600', cursor: 'pointer', fontSize: '13px' }}>
            + Add Product
          </button>
        </div>

        {products.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', background: '#1a1a1a', borderRadius: '12px', border: '1px dashed #333' }}>
            <p style={{ color: '#555' }}>No products yet. Go to your store to add your first product.</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            {products.map(p => (
              <div key={p.id} style={{ background: '#1a1a1a', borderRadius: '12px', overflow: 'hidden', border: '1px solid #222' }}>
                <img src={p.imageUrl || 'https://placehold.co/300x200'} alt={p.name}
                  style={{ width: '100%', height: '140px', objectFit: 'cover' }} />
                <div style={{ padding: '12px' }}>
                  <p style={{ margin: '0 0 4px', fontWeight: '600', fontSize: '14px' }}>{p.name}</p>
                  <p style={{ margin: 0, fontWeight: '700', color: '#22c55e', fontSize: '14px' }}>UGX {p.price}</p>
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