import { useEffect, useState, useMemo, useRef } from 'react'
import { collection, getDocs, query, addDoc, serverTimestamp, doc, getDoc } from 'firebase/firestore'
import { onAuthStateChanged } from 'firebase/auth'
import { db, auth } from './firebase'
import { useNavigate } from 'react-router-dom'
import { track, detectSource } from './tracking'
import { useBag, getBagCounts } from './useBag'
import { createBuyerOrder, incrementProductOrderCount } from './createBuyerOrder'
import { useGuestOTP } from './useGuestOTP'
import { QUICK_REPLIES } from './quickReplies'
import { getMainCategories } from './categories'
import LoadingScreen from './LoadingScreen'
import Fuse from 'fuse.js'

interface Product {
  id: string
  name: string
  price: string
  description: string
  imageUrl: string
  images?: string[]
  sellerSlug: string
  sellerId: string
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
  const [recentSearches, setRecentSearches] = useState<string[]>([])
  const [userId, setUserId] = useState<string | null>(null)
  const [mySlug, setMySlug] = useState<string | null>(null)
  const [ownerFilter, setOwnerFilter] = useState<'all' | 'mine' | 'not-mine'>('all')
  const { addToBag, removeFromBag, isInBag, count: bagCount } = useBag()
  const navigate = useNavigate()
  const [bagCounts, setBagCounts] = useState<Record<string, number>>({})
  const [surveyProduct, setSurveyProduct] = useState<Product | null>(null)
  const [surveyImageIndex, setSurveyImageIndex] = useState(0)
  const [orderProduct, setOrderProduct] = useState<Product | null>(null)
  const [messageProduct, setMessageProduct] = useState<Product | null>(null)
  const [orderSuccess, setOrderSuccess] = useState(false)
  const [buyerName, setBuyerName] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [deliveryArea, setDeliveryArea] = useState('')
  const [orderMessage, setOrderMessage] = useState('')
  const [messageText, setMessageText] = useState('')
  const [showQuickReplies, setShowQuickReplies] = useState(false)
  const [guestName, setGuestName] = useState('')
  const [guestPhone, setGuestPhone] = useState('')
  const [guestOtpInput, setGuestOtpInput] = useState('')
  const [guestMessageSent, setGuestMessageSent] = useState(false)
  const { state: otpState, requestOTP, verifyOTP, reset: resetOTP } = useGuestOTP()
  const clickTimerRef = useRef<number | null>(null)
  const RECENT_SEARCH_LIMIT = 11

  // Load the signed-in user's store slug so the "Yours" badge + "Mine" filter work
  useEffect(() => {
    const u = auth.currentUser
    if (!u) {
      setMySlug(null)
      return
    }
    getDoc(doc(db, 'sellers', u.uid)).then(snap => {
      if (snap.exists()) setMySlug(snap.data().slug || null)
    }).catch(() => {})
  }, [])

  // Fetch bag counts for displayed products
  useEffect(() => {
    const ids = filtered.map(p => p.id)
    if (ids.length === 0) return
    getBagCounts(ids).then(setBagCounts)
  }, [filtered])

  const handleToggleBag = (p: Product) => {
    if (isInBag(p.id)) {
      removeFromBag(p.id)
      setBagCounts(prev => ({ ...prev, [p.id]: Math.max(0, (prev[p.id] || 0) - 1) }))
    } else {
      addToBag({ productId: p.id, productName: p.name, productPrice: p.price, imageUrl: p.imageUrl, sellerSlug: p.sellerSlug, sellerId: p.sellerId, businessName: p.businessName })
      setBagCounts(prev => ({ ...prev, [p.id]: (prev[p.id] || 0) + 1 }))
    }
  }

  const formatBagCount = (n: number) => {
    if (n < 1000) return String(n)
    if (n < 10000) return (n / 1000).toFixed(1) + 'K'
    if (n < 1000000) return Math.round(n / 1000) + 'K'
    return (n / 1000000).toFixed(1) + 'M'
  }

  const handleCardClick = (p: Product) => {
    if (clickTimerRef.current !== null) {
      // Second tap within window → double-tap, open survey
      clearTimeout(clickTimerRef.current)
      clickTimerRef.current = null
      setSurveyImageIndex(0)
      setSurveyProduct(p)
      track('product_surveyed', userId, detectSource(), { productId: p.id, productName: p.name, sellerSlug: p.sellerSlug })
      return
    }
    // First tap → wait for possible second tap
    clickTimerRef.current = window.setTimeout(() => {
      clickTimerRef.current = null
      track('product_viewed', userId, detectSource(), { productId: p.id, productName: p.name, sellerSlug: p.sellerSlug })
      navigate(`/store/${p.sellerSlug}`)
    }, 250)
  }

  const getSurveyImages = (p: Product) => {
    if (p.images && p.images.length > 0) return p.images
    return p.imageUrl ? [p.imageUrl] : []
  }

  const closeSurvey = () => {
    setSurveyProduct(null)
    if (clickTimerRef.current !== null) {
      clearTimeout(clickTimerRef.current)
      clickTimerRef.current = null
    }
  }

  const handleOrder = async () => {
    if (!auth.currentUser) {
      navigate('/', { state: { scrollToProviders: true } })
      return
    }
    if (!buyerName.trim() || !deliveryArea.trim() || !orderProduct) return
    const sourcePlatform = detectSource()
    try {
      await createBuyerOrder(orderProduct.sellerId, {
        buyerName: buyerName.trim(),
        buyerUid: auth.currentUser.uid,
        productName: orderProduct.name,
        productPrice: orderProduct.price,
        quantity,
        deliveryArea: deliveryArea.trim(),
        status: 'pending',
        read: false,
        sourcePlatform,
        createdAt: new Date(),
      })
      await incrementProductOrderCount(orderProduct.sellerId, orderProduct.id, orderProduct.orderCount || 0)
      track('order_placed', auth.currentUser.uid, sourcePlatform, { productId: orderProduct.id, productName: orderProduct.name, sellerId: orderProduct.sellerId })
      setOrderSuccess(true)
      setTimeout(() => {
        setBuyerName('')
        setQuantity('1')
        setDeliveryArea('')
        setOrderMessage('')
        setOrderProduct(null)
        setOrderSuccess(false)
      }, 2500)
    } catch (err) {
      console.error('Order failed:', err)
      alert('Failed to place order. Try again.')
    }
  }

  const handleSendMessage = async () => {
    if (!messageText.trim() || !messageProduct) return
    if (!auth.currentUser) {
      // Guest flow
      if (otpState.step === 'verified') {
        try {
          const guestId = `guest_${otpState.phone.replace(/\D/g, '')}`
          await addDoc(collection(db, 'sellers', messageProduct.sellerId, 'messages'), {
            senderName: guestName,
            senderUid: guestId,
            senderPhone: otpState.phone,
            productName: messageProduct.name,
            productPrice: messageProduct.price,
            text: messageText.trim(),
            read: false,
            sourcePlatform: detectSource(),
            verified: true,
            createdAt: serverTimestamp(),
          })
          setGuestMessageSent(true)
          setTimeout(() => {
            setMessageProduct(null)
            setMessageText('')
            setShowQuickReplies(false)
            setGuestName('')
            setGuestPhone('')
            setGuestOtpInput('')
            setGuestMessageSent(false)
            resetOTP()
          }, 1500)
        } catch (err) {
          console.error('Guest message error:', err)
          alert('Failed to send message. Try again.')
        }
      }
      return
    }
    // Signed-in flow
    try {
      await addDoc(collection(db, 'sellers', messageProduct.sellerId, 'messages'), {
        senderName: auth.currentUser.displayName || 'Buyer',
        senderUid: auth.currentUser.uid,
        receiverUid: messageProduct.sellerId,
        productName: messageProduct.name,
        productPrice: messageProduct.price,
        text: messageText.trim(),
        read: false,
        sourcePlatform: detectSource(),
        createdAt: serverTimestamp(),
      })
      track('message_sent', auth.currentUser.uid, detectSource(), { productId: messageProduct.id, productName: messageProduct.name, sellerId: messageProduct.sellerId })
      setMessageText('')
      setShowQuickReplies(false)
      setMessageProduct(null)
      alert('Message sent! The seller will reply soon.')
    } catch (err) {
      console.error('Message error:', err)
      alert('Failed to send message. Try again.')
    }
  }

  const closeMessageModal = () => {
    setMessageProduct(null)
    setMessageText('')
    setShowQuickReplies(false)
    setGuestName('')
    setGuestPhone('')
    setGuestOtpInput('')
    setGuestMessageSent(false)
    resetOTP()
  }

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUserId(user ? user.uid : null)
    })
    return () => unsubscribe()
  }, [])

  useEffect(() => {
    const storageKey = `rachett_recent_searches_${userId || 'guest'}`
    const raw = localStorage.getItem(storageKey)
    if (raw) {
      try {
        setRecentSearches(JSON.parse(raw) as string[])
      } catch {
        setRecentSearches([])
      }
    } else {
      setRecentSearches([])
    }
  }, [userId])

  const getSearchStorageKey = (uid: string | null) => `rachett_recent_searches_${uid || 'guest'}`

  const saveRecentSearch = (term: string) => {
    const trimmed = term.trim()
    if (!trimmed) return
    const storageKey = getSearchStorageKey(userId)
    setRecentSearches((prev) => {
      const next = [trimmed, ...prev.filter(item => item.toLowerCase() !== trimmed.toLowerCase())].slice(0, RECENT_SEARCH_LIMIT)
      localStorage.setItem(storageKey, JSON.stringify(next))
      return next
    })
  }

  const clearRecentSearches = () => {
    const storageKey = getSearchStorageKey(userId)
    localStorage.removeItem(storageKey)
    setRecentSearches([])
  }

  const handleRecentSearchClick = (term: string) => {
    setSearch(term)
    saveRecentSearch(term)
  }

  const handleSearchKeyDown = (e: { key: string }) => {
    if (e.key === 'Enter') {
      saveRecentSearch(search)
      track('search_performed', userId || null, detectSource(), { query: search.trim() })
    }
  }

  const storeMatches = useMemo(() => {
    const term = search.trim()
    if (!term) return []

    const storeMap = new Map<string, { sellerSlug: string; businessName: string; imageUrl: string; productCount: number; outOfStockCount: number }>()
    products.forEach((p) => {
      const existing = storeMap.get(p.sellerSlug)
      if (!existing) {
        storeMap.set(p.sellerSlug, {
          sellerSlug: p.sellerSlug,
          businessName: p.businessName,
          imageUrl: p.imageUrl,
          productCount: 1,
          outOfStockCount: p.outOfStock ? 1 : 0,
        })
      } else {
        existing.productCount += 1
        existing.outOfStockCount += p.outOfStock ? 1 : 0
      }
    })

    const stores = Array.from(storeMap.values())
    const fuse = new Fuse(stores, {
      keys: ['businessName'],
      threshold: 0.35,
      includeScore: true,
    })

    return fuse.search(term).map((r) => r.item).slice(0, 6)
  }, [products, search])

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
                sellerId: sellerDoc.id,
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

    // Apply owner filter (mine / not mine)
    if (ownerFilter === 'mine') {
      result = result.filter(p => p.sellerSlug === mySlug && mySlug)
    } else if (ownerFilter === 'not-mine') {
      result = result.filter(p => p.sellerSlug !== mySlug || !mySlug)
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
  }, [activeCategory, search, products, sortBy, priceRange, hideOutOfStock, ownerFilter, mySlug])

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f0f', fontFamily: 'sans-serif', color: '#fff' }}>

      {/* Navbar */}
      <nav className="rt-topnav" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px', borderBottom: '1px solid #1a1a1a' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }} onClick={() => navigate('/')}>
          <div style={{ background: green, width: '32px', height: '32px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '800', fontSize: '13px', color: '#000' }}>R</div>
          <span style={{ fontWeight: '800', fontSize: '18px' }}>rachett</span>
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
            onKeyDown={handleSearchKeyDown}
            style={{ width: '100%', padding: '14px 16px 14px 44px', borderRadius: '10px', border: '1px solid #333', background: '#1a1a1a', color: '#fff', fontSize: '15px', boxSizing: 'border-box', outline: 'none' }}
          />
        </div>
        {recentSearches.length > 0 && (
          <div style={{ maxWidth: '500px', margin: '12px auto 0', display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'center' }}>
            {recentSearches.map(term => (
              <button key={term} onClick={() => handleRecentSearchClick(term)}
                style={{ border: '1px solid #333', borderRadius: '20px', background: '#111', color: '#fff', padding: '8px 14px', fontSize: '13px', cursor: 'pointer' }}>
                {term}
              </button>
            ))}
            <button onClick={clearRecentSearches}
              style={{ border: '1px solid #333', borderRadius: '20px', background: '#111', color: '#999', padding: '8px 14px', fontSize: '13px', cursor: 'pointer' }}>
              Clear recents
            </button>
          </div>
        )}
      </div>

      {errorMsg && (
        <div style={{ padding: '12px 24px' }}>
          <div style={{ background: '#fee', border: '1px solid #fcc', color: '#c33', padding: '12px', borderRadius: '8px', maxWidth: '900px', margin: '0 auto' }}>
            {errorMsg}
          </div>
        </div>
      )}

      {search.trim() && storeMatches.length > 0 && (
        <div style={{ maxWidth: '900px', margin: '24px auto', padding: '16px', border: '1px solid #222', borderRadius: '16px', background: '#111' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <div>
              <p style={{ margin: 0, color: '#888', textTransform: 'uppercase', fontSize: '12px', letterSpacing: '0.12em' }}>Matching stores</p>
              <h2 style={{ margin: '6px 0 0', fontSize: '20px', fontWeight: '800', color: '#fff' }}>Search matched {storeMatches.length} store{storeMatches.length === 1 ? '' : 's'}</h2>
            </div>
            <p style={{ margin: 0, color: '#777', fontSize: '13px' }}>Tap a store to open its storefront</p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '14px' }}>
            {storeMatches.map(store => (
              <div key={store.sellerSlug} onClick={() => navigate(`/store/${store.sellerSlug}`)}
                style={{ background: '#151515', borderRadius: '14px', cursor: 'pointer', overflow: 'hidden', border: '1px solid #222', minHeight: '170px', display: 'flex', flexDirection: 'column' }}>
                <div style={{ backgroundImage: `url(${store.imageUrl || 'https://placehold.co/300x180/111111/555555'})`, backgroundSize: 'cover', backgroundPosition: 'center', height: '110px' }} />
                <div style={{ padding: '12px' }}>
                  <p style={{ margin: '0 0 6px', fontWeight: '800', color: '#fff', fontSize: '14px' }}>{store.businessName}</p>
                  <p style={{ margin: 0, color: '#888', fontSize: '12px' }}>{store.productCount} product{store.productCount === 1 ? '' : 's'} • {store.outOfStockCount} unavailable</p>
                </div>
              </div>
            ))}
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
      <select value={ownerFilter} onChange={e => setOwnerFilter(e.target.value as 'all' | 'mine' | 'not-mine')}
        style={{ padding: '8px 14px', borderRadius: '20px', border: '1px solid #333', background: ownerFilter !== 'all' ? green : 'transparent', color: ownerFilter !== 'all' ? '#000' : '#aaa', fontWeight: ownerFilter !== 'all' ? '700' : '500', cursor: 'pointer', fontSize: '14px', whiteSpace: 'nowrap', marginRight: '8px' }}>
        <option value="all">All Products</option>
        <option value="mine">Mine Only</option>
        <option value="not-mine">Hide Mine</option>
      </select>
        <div className="rt-filters" style={{ padding: '20px 24px', borderBottom: '1px solid #1a1a1a', display: 'flex', gap: '8px', overflowX: 'auto' }}>
        {categories.map(cat => (
          <button key={cat} onClick={() => { track('category_browsed', userId || null, detectSource(), { category: cat }); setActiveCategory(cat) }}
            style={{ padding: '8px 18px', borderRadius: '20px', border: `1px solid ${activeCategory === cat ? green : '#333'}`, background: activeCategory === cat ? green : 'transparent', color: activeCategory === cat ? '#000' : '#aaa', fontWeight: activeCategory === cat ? '700' : '500', cursor: 'pointer', fontSize: '14px', whiteSpace: 'nowrap' }}>
            {cat}
          </button>
        ))}
      </div>

      {/* Products */}
      <div className="rt-container" style={{ maxWidth: '800px', margin: '0 auto', padding: '32px 16px' }}>
        {loading ? (
          <LoadingScreen message="Fetching products for you..." />
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '80px 20px' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>🛍️</div>
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
                      {p.sellerSlug === mySlug && mySlug && (
                      <div style={{ position: 'absolute', top: '6px', left: '6px', background: green, color: '#000', padding: '1px 5px', borderRadius: '3px', fontSize: '9px', fontWeight: '800', zIndex: 2 }}>Yours</div>
                    )}
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
                <div key={p.id}
                  style={{ background: '#1a1a1a', borderRadius: '12px', overflow: 'hidden', border: '1px solid #222', position: 'relative', display: 'flex', flexDirection: 'column' }}>
                  <div onClick={() => handleCardClick(p)} style={{ cursor: 'pointer', position: 'relative' }}>
                    {p.sellerSlug === mySlug && mySlug && (<div style={{ position: 'absolute', top: '6px', left: '6px', background: green, color: '#000', padding: '1px 5px', borderRadius: '3px', fontSize: '9px', fontWeight: '800', zIndex: 2 }}>Yours</div>)}
                    <button onClick={(e) => { e.stopPropagation(); handleToggleBag(p) }}
                      style={{ position: 'absolute', top: '6px', right: '6px', background: isInBag(p.id) ? green : 'rgba(0,0,0,0.6)', color: isInBag(p.id) ? '#000' : '#fff', border: 'none', borderRadius: '8px', padding: '2px 7px', cursor: 'pointer', fontSize: '11px', fontWeight: '700', zIndex: 2, display: 'flex', alignItems: 'center', gap: '3px', backdropFilter: 'blur(4px)', lineHeight: 1.4 }}>
                      🛍️ {formatBagCount(bagCounts[p.id] || 0)}
                    </button>

                    <img src={p.imageUrl || 'https://placehold.co/300x200/1a1a1a/333333'} alt={p.name}
                      style={{ width: '100%', height: '160px', objectFit: 'cover', opacity: p.outOfStock ? 0.5 : 1 }} />
                    {getSurveyImages(p).length > 1 && (
                      <div style={{ position: 'absolute', bottom: '6px', right: '6px', background: 'rgba(0,0,0,0.6)', color: '#fff', padding: '2px 7px', borderRadius: '12px', fontSize: '10px', fontWeight: '700', zIndex: 2, backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', gap: '3px', lineHeight: 1.4 }}>
                        📷 {getSurveyImages(p).length}
                      </div>
                    )}
                    <div style={{ padding: '12px' }}>
                      <p style={{ margin: '0 0 4px', fontWeight: '700', fontSize: '14px', color: '#fff' }}>{p.name}</p>
                      <p style={{ margin: '0 0 8px', color: '#555', fontSize: '12px' }}>{p.businessName}</p>
                      <p style={{ margin: 0, fontWeight: '800', color: green, fontSize: '14px' }}>UGX {p.price}</p>
                    </div>
                  </div>
                  {!p.outOfStock && (
                    <div style={{ display: 'flex', gap: '6px', padding: '0 12px 12px' }}>
                      <button onClick={(e) => { e.stopPropagation(); setMessageProduct(p) }}
                        style={{ flex: 1, padding: '8px', background: '#222', color: '#fff', border: '1px solid #333', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '12px' }}>
                        💬 Message
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); setOrderProduct(p) }}
                        style={{ flex: 1, padding: '8px', background: green, color: '#000', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '12px' }}>
                        Buy Now
                      </button>
                    </div>
                  )}
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

      {/* Product Survey Modal */}
      {surveyProduct && (() => {
        const surveyImages = getSurveyImages(surveyProduct)
        const currentImg = surveyImages[surveyImageIndex] || surveyProduct.imageUrl || ''
        return (
          <div onClick={closeSurvey}
            style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.92)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', overflowY: 'auto' }}>
            <div onClick={e => e.stopPropagation()}
              style={{ background: '#1a1a1a', borderRadius: '16px', padding: '20px', width: '100%', maxWidth: '420px', border: '1px solid #222', maxHeight: '92vh', overflowY: 'auto' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <span style={{ color: '#888', fontSize: '12px', fontWeight: '600' }}>Product details</span>
                <button onClick={closeSurvey}
                  style={{ background: 'transparent', border: 'none', color: '#555', fontSize: '20px', cursor: 'pointer', padding: '0 4px' }}>✕</button>
              </div>

              {/* Survey Image */}
              <div style={{ position: 'relative', borderRadius: '12px', overflow: 'hidden', marginBottom: '14px' }}>
                <img src={currentImg || 'https://placehold.co/600x400/1a1a1a/333333'} alt={surveyProduct.name}
                  style={{ width: '100%', height: '280px', objectFit: 'cover', display: 'block' }} />
                {surveyImages.length > 1 && (
                  <>
                    <button onClick={() => setSurveyImageIndex(prev => (prev === 0 ? surveyImages.length - 1 : prev - 1))}
                      style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', background: 'rgba(0,0,0,0.6)', border: 'none', color: '#fff', borderRadius: '50%', width: '36px', height: '36px', cursor: 'pointer', fontSize: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      ‹
                    </button>
                    <button onClick={() => setSurveyImageIndex(prev => (prev === surveyImages.length - 1 ? 0 : prev + 1))}
                      style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'rgba(0,0,0,0.6)', border: 'none', color: '#fff', borderRadius: '50%', width: '36px', height: '36px', cursor: 'pointer', fontSize: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      ›
                    </button>
                    <div style={{ position: 'absolute', bottom: '10px', right: '10px', background: 'rgba(0,0,0,0.7)', color: '#fff', padding: '4px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: '700' }}>
                      {surveyImageIndex + 1}/{surveyImages.length}
                    </div>
                  </>
                )}
              </div>

              <h2 style={{ margin: '0 0 4px', fontSize: '18px', fontWeight: '800', color: '#fff' }}>{surveyProduct.name}</h2>
              <p style={{ margin: '0 0 8px', color: '#888', fontSize: '13px' }}>{surveyProduct.businessName}</p>
              <p style={{ margin: '0 0 12px', fontWeight: '800', fontSize: '18px', color: green }}>UGX {surveyProduct.price}</p>
              {surveyProduct.description && (
                <p style={{ margin: '0 0 16px', color: '#aaa', fontSize: '13px', lineHeight: 1.6 }}>{surveyProduct.description}</p>
              )}

              {/* Actions */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <button onClick={() => handleToggleBag(surveyProduct)}
                  style={{ padding: '12px', background: isInBag(surveyProduct.id) ? '#1a2a1a' : '#222', color: green, border: `1px solid ${green}`, borderRadius: '10px', fontWeight: '700', cursor: 'pointer', fontSize: '14px' }}>
                  {isInBag(surveyProduct.id) ? '✓ In Bag — Tap to Remove' : `🛍️ Add to Bag (${formatBagCount(bagCounts[surveyProduct.id] || 0)} bagged)`}
                </button>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={() => { setMessageProduct(surveyProduct); setSurveyProduct(null) }}
                    style={{ flex: 1, padding: '12px', background: '#222', color: '#fff', border: '1px solid #333', borderRadius: '10px', fontWeight: '700', cursor: 'pointer', fontSize: '14px' }}>
                    💬 Message
                  </button>
                  <button onClick={() => { setOrderProduct(surveyProduct); setSurveyProduct(null) }}
                    style={{ flex: 1, padding: '12px', background: green, color: '#000', border: 'none', borderRadius: '10px', fontWeight: '700', cursor: 'pointer', fontSize: '14px' }}>
                    Buy Now
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Order Modal */}
      {orderProduct && (
        <div onClick={() => { setOrderProduct(null); setOrderSuccess(false) }}
          style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', overflowY: 'auto' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: '#1a1a1a', borderRadius: '16px', padding: '28px', width: '100%', maxWidth: '400px', border: '1px solid #222', textAlign: 'center' }}>
            {orderSuccess ? (
              <div>
                <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: green, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', fontSize: '28px', color: '#000', fontWeight: '800' }}>
                  ✓
                </div>
                <h3 style={{ color: '#fff', fontWeight: '800', fontSize: '18px', margin: '0 0 8px' }}>Order Sent!</h3>
                <p style={{ color: '#888', fontSize: '14px', margin: 0 }}>The seller will contact you to confirm delivery.</p>
              </div>
            ) : (
              <>
                <h3 style={{ margin: '0 0 4px', fontSize: '18px', fontWeight: '800', color: '#fff', textAlign: 'left' }}>
                  Order {orderProduct.name}
                </h3>
                <p style={{ margin: '0 0 24px', color: green, fontSize: '14px', fontWeight: '700', textAlign: 'left' }}>
                  UGX {orderProduct.price} each
                </p>
                <input placeholder="Your name" value={buyerName} onChange={e => setBuyerName(e.target.value)}
                  style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #333', marginBottom: '12px', boxSizing: 'border-box', fontSize: '14px', background: '#111', color: '#fff' }} />
                <input placeholder="Quantity" value={quantity} onChange={e => setQuantity(e.target.value)} type="number" min="1"
                  style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #333', marginBottom: '12px', boxSizing: 'border-box', fontSize: '14px', background: '#111', color: '#fff' }} />
                <input placeholder="Delivery area e.g. Nakawa, Kampala" value={deliveryArea} onChange={e => setDeliveryArea(e.target.value)}
                  style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #333', marginBottom: '12px', boxSizing: 'border-box', fontSize: '14px', background: '#111', color: '#fff' }} />
                <textarea placeholder="Write a message to the seller (optional)" value={orderMessage} onChange={e => setOrderMessage(e.target.value)}
                  style={{ width: '100%', minHeight: '80px', padding: '12px', borderRadius: '8px', border: '1px solid #333', marginBottom: '20px', boxSizing: 'border-box', fontSize: '14px', background: '#111', color: '#fff', resize: 'vertical' }} />
                <button onClick={handleOrder}
                  style={{ width: '100%', padding: '14px', background: green, color: '#000', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '15px', marginBottom: '12px' }}>
                  Send Order
                </button>
                <button onClick={() => { setOrderProduct(null); setOrderSuccess(false) }}
                  style={{ width: '100%', padding: '12px', background: 'transparent', color: '#555', border: '1px solid #222', borderRadius: '8px', cursor: 'pointer', fontSize: '14px' }}>
                  Cancel
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Message Modal */}
      {messageProduct && (
        <div onClick={closeMessageModal}
          style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', overflowY: 'auto' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: '#1a1a1a', borderRadius: '16px', padding: '28px', width: '100%', maxWidth: '400px', border: '1px solid #222', textAlign: 'center' }}>
            <h3 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: '800', color: '#fff', textAlign: 'left' }}>
              Message about {messageProduct.name}
            </h3>
            <div style={{ marginBottom: '20px', padding: '12px', background: '#111', borderRadius: '8px', border: '1px solid #333' }}>
              <img src={messageProduct.imageUrl || 'https://placehold.co/300x120/1a1a1a/333333'} alt={messageProduct.name}
                style={{ width: '100%', height: '120px', objectFit: 'cover', borderRadius: '6px', marginBottom: '8px' }} />
              <p style={{ margin: '0 0 4px', fontWeight: '700', fontSize: '13px', color: '#fff', textAlign: 'left' }}>{messageProduct.name}</p>
              <p style={{ margin: 0, color: green, fontSize: '13px', fontWeight: '700', textAlign: 'left' }}>UGX {messageProduct.price}</p>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: showQuickReplies ? '12px' : '16px' }}>
              <button onClick={() => setShowQuickReplies(!showQuickReplies)}
                style={{ padding: '6px 12px', background: showQuickReplies ? '#1a2a1a' : '#111', color: green, border: `1px solid ${green}`, borderRadius: '20px', cursor: 'pointer', fontSize: '12px', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '5px' }}>
                ⚡ Quick replies {showQuickReplies ? '▲' : '▼'}
              </button>
            </div>
            {showQuickReplies && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '16px', background: '#111', borderRadius: '10px', padding: '10px', border: '1px solid #2a2a2a' }}>
                {QUICK_REPLIES.map(q => (
                  <button key={q} onClick={() => { setMessageText(q); setShowQuickReplies(false) }}
                    style={{ textAlign: 'left', padding: '9px 12px', background: '#1a1a1a', color: '#ddd', border: '1px solid #2a2a2a', borderRadius: '8px', cursor: 'pointer', fontSize: '13px' }}>
                    {q}
                  </button>
                ))}
              </div>
            )}


            {auth.currentUser ? (
              <>
                <textarea placeholder="Write your message..." value={messageText} onChange={e => setMessageText(e.target.value)}
                  style={{ width: '100%', minHeight: '100px', padding: '12px', borderRadius: '8px', border: '1px solid #333', marginBottom: '20px', boxSizing: 'border-box', fontSize: '14px', background: '#111', color: '#fff', resize: 'vertical' }} />
                <button onClick={handleSendMessage}
                  style={{ width: '100%', padding: '14px', background: green, color: '#000', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '15px', marginBottom: '12px' }}>
                  Send Message
                </button>
              </>
            ) : (
              <>
                {guestMessageSent ? (
                  <div>
                    <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: green, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px', fontSize: '24px', color: '#000', fontWeight: '800' }}>
                      ✓
                    </div>
                    <p style={{ color: '#fff', fontSize: '15px', fontWeight: '700', margin: '0 0 4px' }}>Message Sent!</p>
                    <p style={{ color: '#888', fontSize: '13px', margin: 0 }}>The seller will reply soon.</p>
                  </div>
                ) : otpState.step === 'idle' || otpState.step === 'error' ? (
                  <>
                    <p style={{ color: '#888', fontSize: '13px', marginBottom: '16px', textAlign: 'left' }}>
                      No account needed. Just verify your phone to message the seller.
                    </p>
                    <input placeholder="Your name" value={guestName} onChange={e => setGuestName(e.target.value)}
                      style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #333', marginBottom: '12px', boxSizing: 'border-box', fontSize: '14px', background: '#111', color: '#fff' }} />
                    <input placeholder="Phone number e.g. 0771234567" value={guestPhone} onChange={e => setGuestPhone(e.target.value)}
                      style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #333', marginBottom: '12px', boxSizing: 'border-box', fontSize: '14px', background: '#111', color: '#fff' }} />
                    <textarea placeholder="Write your message..." value={messageText} onChange={e => setMessageText(e.target.value)}
                      style={{ width: '100%', minHeight: '80px', padding: '12px', borderRadius: '8px', border: '1px solid #333', marginBottom: '20px', boxSizing: 'border-box', fontSize: '14px', background: '#111', color: '#fff', resize: 'vertical' }} />
                    {otpState.error && <p style={{ color: '#ff4444', fontSize: '12px', marginBottom: '12px' }}>{otpState.error}</p>}
                    <button onClick={() => requestOTP(guestPhone)} disabled={otpState.loading || !guestName.trim() || !guestPhone.trim()}
                      style={{ width: '100%', padding: '14px', background: (otpState.loading || !guestName.trim() || !guestPhone.trim()) ? '#333' : green, color: '#000', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: (otpState.loading || !guestName.trim() || !guestPhone.trim()) ? 'not-allowed' : 'pointer', fontSize: '15px', marginBottom: '12px' }}>
                      {otpState.loading ? 'Sending code...' : 'Send Verification Code'}
                    </button>
                  </>
                ) : otpState.step === 'otp' ? (
                  <>
                    <p style={{ color: '#888', fontSize: '13px', marginBottom: '16px', textAlign: 'left' }}>
                      A 6-digit code was sent to <strong style={{ color: '#fff' }}>{otpState.phone}</strong>. Enter it below.
                    </p>
                    <input placeholder="Enter 6-digit code" value={guestOtpInput} onChange={e => setGuestOtpInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #333', marginBottom: '12px', boxSizing: 'border-box', fontSize: '20px', background: '#111', color: '#fff', textAlign: 'center', letterSpacing: '8px' }} />
                    {otpState.error && <p style={{ color: '#ff4444', fontSize: '12px', marginBottom: '12px' }}>{otpState.error}</p>}
                    <button onClick={async () => {
                      const verified = await verifyOTP(guestOtpInput, guestName)
                      if (verified) await handleSendMessage()
                    }} disabled={otpState.loading || guestOtpInput.length !== 6}
                      style={{ width: '100%', padding: '14px', background: (otpState.loading || guestOtpInput.length !== 6) ? '#333' : green, color: '#000', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: (otpState.loading || guestOtpInput.length !== 6) ? 'not-allowed' : 'pointer', fontSize: '15px', marginBottom: '12px' }}>
                      {otpState.loading ? 'Verifying...' : 'Verify & Send'}
                    </button>
                    <button onClick={resetOTP}
                      style={{ width: '100%', padding: '8px', background: 'transparent', color: '#888', border: 'none', cursor: 'pointer', fontSize: '13px', marginBottom: '12px' }}>
                      ← Use a different number
                    </button>
                  </>
                ) : null}

                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: '16px 0' }}>
                  <div style={{ flex: 1, height: '1px', background: '#222' }} />
                  <span style={{ color: '#555', fontSize: '12px' }}>OR</span>
                  <div style={{ flex: 1, height: '1px', background: '#222' }} />
                </div>
                <button onClick={() => { navigate('/', { state: { scrollToProviders: true } }); closeMessageModal() }}
                  style={{ width: '100%', padding: '12px', background: 'transparent', color: '#aaa', border: '1px solid #333', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', marginBottom: '12px' }}>
                  Sign in with Google
                </button>
              </>
            )}

            <button onClick={closeMessageModal}
              style={{ width: '100%', padding: '12px', background: 'transparent', color: '#555', border: '1px solid #222', borderRadius: '8px', cursor: 'pointer', fontSize: '14px' }}>
              Cancel
            </button>


          </div>
        </div>
      )}

      <button onClick={() => navigate('/bag')}
        style={{ position: 'fixed', bottom: '24px', right: '24px', width: '56px', height: '56px', borderRadius: '50%', background: green, color: '#000', border: 'none', cursor: 'pointer', fontSize: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, boxShadow: '0 4px 16px rgba(173,255,47,0.4)' }}>
        🛍️
        {bagCount > 0 && (
          <span style={{ position: 'absolute', top: '-4px', right: '-4px', background: '#ff4444', color: '#fff', borderRadius: '50%', width: '22px', height: '22px', fontSize: '11px', fontWeight: '800', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid #0f0f0f' }}>
            {bagCount}
          </span>
        )}
      </button>
    </div>
  )
}

export default BrowsePage