import { useEffect, useState } from 'react'
import { collection, getDocs, query } from 'firebase/firestore'
import { db } from './firebase'
import { useNavigate } from 'react-router-dom'
import { getMainCategories } from './categories'

interface Product {
  id: string
  name: string
  price: string
  description: string
  imageUrl: string
  sellerSlug: string
  businessName: string
  category?: string
  subCategory?: string
}

const categories = ['All', ...getMainCategories()]
const green = '#adff2f'

function BrowsePage() {
  const [products, setProducts] = useState<Product[]>([])
  const [filtered, setFiltered] = useState<Product[]>([])
  const [activeCategory, setActiveCategory] = useState('All')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    const fetchAll = async () => {
      try {
        const sellersSnap = await getDocs(collection(db, 'sellers'))
        const allProducts: Product[] = []
        
        // Limit to first 50 sellers for MVP performance
        const limitedSellers = sellersSnap.docs.slice(0, 50)
        
        for (const sellerDoc of limitedSellers) {
          try {
            const sellerData = sellerDoc.data()
            const productsSnap = await getDocs(query(collection(db, 'sellers', sellerDoc.id, 'products')))
            productsSnap.docs.forEach(p => {
              const productData = p.data() as Product
              allProducts.push({
                ...productData,
                id: p.id,
                sellerSlug: sellerData.slug,
                businessName: sellerData.businessName
              })
            })
          } catch (err) {
            console.error(`Error fetching products for seller ${sellerDoc.id}:`, err)
          }
        }
        
        setProducts(allProducts)
        setFiltered(allProducts)
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Failed to load products'
        console.error('Browse page error:', errorMsg, err)
      } finally {
        setLoading(false)
      }
    }
    fetchAll()
  }, [])

  useEffect(() => {
    let result = products
    if (activeCategory !== 'All') {
      result = result.filter(p => p.category === activeCategory)
    }
    if (search.trim()) {
      result = result.filter(p =>
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.businessName.toLowerCase().includes(search.toLowerCase())
      )
    }
    setFiltered(result)
  }, [activeCategory, search, products])

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f0f', fontFamily: 'sans-serif', color: '#fff' }}>

      {/* Navbar */}
      <nav className="rt-topnav" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px', borderBottom: '1px solid #1a1a1a' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }} onClick={() => navigate('/')}>
          <div style={{ background: green, width: '32px', height: '32px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '800', fontSize: '13px', color: '#000' }}>R</div>
          <span style={{ fontWeight: '800', fontSize: '18px' }}>Rachett</span>
        </div>
        <button onClick={() => navigate('/')}
          style={{ background: 'transparent', border: '1px solid #333', color: '#aaa', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer', fontSize: '13px' }}>
          Sign in
        </button>
      </nav>

      {/* Hero */}
      <div style={{ textAlign: 'center', padding: '48px 20px 32px', borderBottom: '1px solid #1a1a1a' }}>
        <h1 className="rt-title-md" style={{ fontSize: '32px', fontWeight: '900', margin: '0 0 8px', letterSpacing: '-1px' }}>
          Shop from real sellers — <span style={{ color: green }}>safely.</span>
        </h1>
        <p style={{ color: '#666', fontSize: '15px', margin: '0 0 24px' }}>
          Every store here is run by a real social media seller. Browse, order, and they'll reach out to complete your purchase.
        </p>

        {/* Search */}
        <div style={{ maxWidth: '500px', margin: '0 auto', position: 'relative' }}>
          <span style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', color: '#555', fontSize: '16px' }}>🔍</span>
          <input
            placeholder="Search products, stores..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width: '100%', padding: '14px 16px 14px 44px', borderRadius: '10px', border: '1px solid #333', background: '#1a1a1a', color: '#fff', fontSize: '15px', boxSizing: 'border-box', outline: 'none' }}
          />
        </div>
      </div>

      {/* Categories */}
      <div className="rt-filters" style={{ padding: '20px 24px', borderBottom: '1px solid #1a1a1a', display: 'flex', gap: '8px', overflowX: 'auto' }}>
        {categories.map(cat => (
          <button key={cat} onClick={() => setActiveCategory(cat)}
            style={{ padding: '8px 18px', borderRadius: '20px', border: `1px solid ${activeCategory === cat ? green : '#333'}`, background: activeCategory === cat ? green : 'transparent', color: activeCategory === cat ? '#000' : '#aaa', fontWeight: activeCategory === cat ? '700' : '500', cursor: 'pointer', fontSize: '14px', whiteSpace: 'nowrap' }}>
            {cat}
          </button>
        ))}
      </div>

      {/* Products */}
      <div className="rt-container" style={{ maxWidth: '800px', margin: '0 auto', padding: '32px 16px' }}>
        {loading ? (
          <p style={{ textAlign: 'center', color: '#555' }}>Loading products...</p>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '80px 20px' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>📦</div>
            <h3 style={{ fontWeight: '700', margin: '0 0 8px' }}>No products found</h3>
            <p style={{ color: '#555', margin: 0 }}>Try a different search or check back soon</p>
          </div>
        ) : (
          <>
            <p style={{ color: '#555', fontSize: '13px', marginBottom: '20px' }}>{filtered.length} products available</p>
            <div className="rt-products" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '16px' }}>
              {filtered.map(p => (
                <div key={p.id} onClick={() => navigate(`/store/${p.sellerSlug}`)}
                  style={{ background: '#1a1a1a', borderRadius: '12px', overflow: 'hidden', border: '1px solid #222', cursor: 'pointer' }}>
                  <img src={p.imageUrl || 'https://placehold.co/300x200/1a1a1a/333333'} alt={p.name}
                    style={{ width: '100%', height: '160px', objectFit: 'cover' }} />
                  <div style={{ padding: '12px' }}>
                    <p style={{ margin: '0 0 4px', fontWeight: '700', fontSize: '14px', color: '#fff' }}>{p.name}</p>
                    <p style={{ margin: '0 0 8px', color: '#555', fontSize: '12px' }}>{p.businessName}</p>
                    <p style={{ margin: 0, fontWeight: '800', color: green, fontSize: '14px' }}>UGX {p.price}</p>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default BrowsePage