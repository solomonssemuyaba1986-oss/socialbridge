import { useEffect, useState, useMemo } from 'react'
import { collection, getDocs, query } from 'firebase/firestore'
import { db } from './firebase'
import { useNavigate } from 'react-router-dom'
import { getMainCategories } from './categories'
import Fuse from 'fuse.js'

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
  outOfStock?: boolean
  orderCount?: number
}

const categories = ['All', ...getMainCategories()]
const green = '#adff2f'

function BrowsePage() {
  const [products, setProducts] = useState<Product[]>([])
  const [filtered, setFiltered] = useState<Product[]>([])
  const [activeCategory, setActiveCategory] = useState('All')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [sortBy, setSortBy] = useState<'relevance' | 'price-asc' | 'price-desc' | 'newest' | 'popular'>('relevance')
  const [priceRange, setPriceRange] = useState<[number, number]>([0, 10000000])
  const [hideOutOfStock, setHideOutOfStock] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string>('')
  const navigate = useNavigate()

  // Popular products fallback (top 5 by order count)
  const popularProducts = useMemo(() => {
    return [...products].sort((a, b) => (b.orderCount || 0) - (a.orderCount || 0)).slice(0, 5)
  }, [products])

  useEffect(() => {
    const fetchAll = async () => {
      try {
        const sellersSnap = await getDocs(collection(db, 'sellers'))
        console.log('BrowsePage: seller document count', sellersSnap.size)
        const allProducts: Product[] = []
        
        // Limit to first 50 sellers for MVP performance
        const limitedSellers = sellersSnap.docs.slice(0, 50)
        
        for (const sellerDoc of limitedSellers) {
          try {
            const sellerData = sellerDoc.data()
            console.log('BrowsePage: fetching products for seller', sellerDoc.id)
            const productsSnap = await getDocs(query(collection(db, 'sellers', sellerDoc.id, 'products')))
            console.log('BrowsePage: seller', sellerDoc.id, 'product count', productsSnap.size)
            productsSnap.docs.forEach(p => {
              const productData = p.data() as Product
              allProducts.push({
                ...productData,
                id: p.id,
                sellerSlug: sellerData.slug,
                businessName: sellerData.businessName,
                outOfStock: productData.outOfStock || false,
                orderCount: productData.orderCount || 0
              })
            })
          } catch (err) {
            console.error(`Error fetching products for seller ${sellerDoc.id}:`, err)
          }
        }
        
        setProducts(allProducts)
        setFiltered(allProducts)
      } catch (err: any) {
        const errorText = err instanceof Error ? err.message : 'Failed to load products'
        console.error('Browse page error:', errorText, err)
        if (err?.code === 'permission-denied') {
          setErrorMsg('Permission denied when loading products. Check Firestore rules and authentication.')
        } else {
          setErrorMsg('Failed to load products. Check network or Firestore permissions.')
        }
      } finally {
        setLoading(false)
      }
    }
    fetchAll()
  }, [])

  // Fuzzy search with Fuse.js + category + price + out-of-stock filters + sorting
  useEffect(() => {
    let result = products

    // Apply category filter
    if (activeCategory !== 'All') {
      result = result.filter(p => p.category === activeCategory)
    }

    // Apply out-of-stock filter
    if (hideOutOfStock) {
      result = result.filter(p => !p.outOfStock)
    }

    // Apply price range filter
    result = result.filter(p => {
      const price = Number(String(p.price).replace(/,/g, '')) || 0
      return price >= priceRange[0] && price <= priceRange[1]
    })

    // Fuzzy search
    if (search.trim()) {
      const fuse = new Fuse(result, {
        keys: ['name', 'description', 'businessName', 'subCategory'],
        threshold: 0.3,
        includeScore: true
      })
      const searchResults = fuse.search(search)
      result = searchResults.map(r => r.item)
    }

    // Apply sorting
    if (sortBy === 'price-asc') {
      result.sort((a, b) => {
        const priceA = Number(String(a.price).replace(/,/g, '')) || 0
        const priceB = Number(String(b.price).replace(/,/g, '')) || 0
        return priceA - priceB
      })
    } else if (sortBy === 'price-desc') {
      result.sort((a, b) => {
        const priceA = Number(String(a.price).replace(/,/g, '')) || 0
        const priceB = Number(String(b.price).replace(/,/g, '')) || 0
        return priceB - priceA
      })
    } else if (sortBy === 'newest') {
      // Assume products are already in newest-first order from Firestore
      // If we had createdAt, we'd sort by that
    } else if (sortBy === 'popular') {
      result.sort((a, b) => (b.orderCount || 0) - (a.orderCount || 0))
    }

    setFiltered(result)
  }, [activeCategory, search, products, sortBy, priceRange, hideOutOfStock])

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

      {errorMsg && (
        <div style={{ padding: '12px 24px' }}>
          <div style={{ background: '#fee', border: '1px solid #fcc', color: '#c33', padding: '12px', borderRadius: '8px', maxWidth: '900px', margin: '0 auto' }}>
            {errorMsg}
          </div>
        </div>
      )}

      {/* Sort, Price Range, Out-of-Stock Controls */}
      <div style={{ padding: '16px 24px', borderBottom: '1px solid #1a1a1a', display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', fontSize: '13px' }}>
        <select
          value={sortBy}
          onChange={e => setSortBy(e.target.value as typeof sortBy)}
          style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid #333', background: '#1a1a1a', color: '#fff', cursor: 'pointer', fontSize: '13px' }}>
          <option value="relevance">Sort: Relevance</option>
          <option value="price-asc">Sort: Price (Low → High)</option>
          <option value="price-desc">Sort: Price (High → Low)</option>
          <option value="popular">Sort: Most Popular</option>
          <option value="newest">Sort: Newest</option>
        </select>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <label style={{ color: '#888' }}>Price: UGX</label>
          <input
            type="number"
            placeholder="Min"
            value={priceRange[0]}
            onChange={e => setPriceRange([Number(e.target.value) || 0, priceRange[1]])}
            style={{ width: '80px', padding: '6px', borderRadius: '6px', border: '1px solid #333', background: '#1a1a1a', color: '#fff', fontSize: '13px' }}
          />
          <span style={{ color: '#555' }}>—</span>
          <input
            type="number"
            placeholder="Max"
            value={priceRange[1]}
            onChange={e => setPriceRange([priceRange[0], Number(e.target.value) || 10000000])}
            style={{ width: '80px', padding: '6px', borderRadius: '6px', border: '1px solid #333', background: '#1a1a1a', color: '#fff', fontSize: '13px' }}
          />
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', color: hideOutOfStock ? green : '#888' }}>
          <input
            type="checkbox"
            checked={hideOutOfStock}
            onChange={e => setHideOutOfStock(e.target.checked)}
            style={{ cursor: 'pointer' }}
          />
          Hide out of stock
        </label>
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
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>�</div>
            <h3 style={{ fontWeight: '700', margin: '0 0 8px', fontSize: '16px' }}>No products found</h3>
            <p style={{ color: '#555', margin: '0 0 24px', fontSize: '14px' }}>
              {search ? `Try a different search term, or check similar products below` : 'Try a different category or check trending items'}
            </p>
            
            {search && (
              <div style={{ marginBottom: '32px', paddingTop: '24px', borderTop: '1px solid #222' }}>
                <p style={{ color: '#888', fontSize: '12px', fontWeight: '600', textTransform: 'uppercase', marginBottom: '16px' }}>💡 Tips</p>
                <ul style={{ color: '#666', fontSize: '13px', margin: 0, paddingLeft: '20px', textAlign: 'left', maxWidth: '300px', marginLeft: 'auto', marginRight: 'auto' }}>
                  <li>Check spelling: "laptop" vs "lapto"</li>
                  <li>Try broader terms: "laptop" instead of "gaming laptop"</li>
                  <li>Browse by category instead</li>
                  <li>Check price & availability filters</li>
                </ul>
              </div>
            )}

            {popularProducts.length > 0 && (
              <div style={{ marginTop: '32px', paddingTop: '24px', borderTop: '1px solid #222' }}>
                <p style={{ color: '#888', fontSize: '12px', fontWeight: '600', textTransform: 'uppercase', marginBottom: '16px' }}>⭐ Popular products</p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '12px' }}>
                  {popularProducts.map(p => (
                    <div key={p.id} onClick={() => navigate(`/store/${p.sellerSlug}`)}
                      style={{ background: '#1a1a1a', borderRadius: '12px', overflow: 'hidden', border: '1px solid #222', cursor: 'pointer', position: 'relative' }}>
                      <img src={p.imageUrl || 'https://placehold.co/300x200/1a1a1a/333333'} alt={p.name}
                        style={{ width: '100%', height: '120px', objectFit: 'cover', opacity: p.outOfStock ? 0.5 : 1 }} />
                      <div style={{ padding: '10px' }}>
                        <p style={{ margin: '0 0 4px', fontWeight: '700', fontSize: '12px', color: '#fff', lineHeight: '1.2' }}>{p.name}</p>
                        <p style={{ margin: 0, fontWeight: '800', color: green, fontSize: '12px' }}>UGX {p.price}</p>
                      </div>
                      {p.outOfStock && (
                        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: '700', fontSize: '12px', textAlign: 'center', padding: '8px' }}>
                          Out of Stock
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <>
            <p style={{ color: '#555', fontSize: '13px', marginBottom: '20px' }}>{filtered.length} products available</p>
            <div className="rt-products" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '16px' }}>
              {filtered.map(p => (
                <div key={p.id} onClick={() => navigate(`/store/${p.sellerSlug}`)}
                  style={{ background: '#1a1a1a', borderRadius: '12px', overflow: 'hidden', border: '1px solid #222', cursor: 'pointer', position: 'relative' }}>
                  <img src={p.imageUrl || 'https://placehold.co/300x200/1a1a1a/333333'} alt={p.name}
                    style={{ width: '100%', height: '160px', objectFit: 'cover', opacity: p.outOfStock ? 0.5 : 1 }} />
                  <div style={{ padding: '12px' }}>
                    <p style={{ margin: '0 0 4px', fontWeight: '700', fontSize: '14px', color: '#fff' }}>{p.name}</p>
                    <p style={{ margin: '0 0 8px', color: '#555', fontSize: '12px' }}>{p.businessName}</p>
                    <p style={{ margin: 0, fontWeight: '800', color: green, fontSize: '14px' }}>UGX {p.price}</p>
                  </div>
                  {p.outOfStock && (
                    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: '700', fontSize: '13px', textAlign: 'center', padding: '8px' }}>
                      Out of Stock
                    </div>
                  )}
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