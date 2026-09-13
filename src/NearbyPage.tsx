import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, getDocs } from 'firebase/firestore'
import { onAuthStateChanged } from 'firebase/auth'
import Fuse from 'fuse.js'
import { db, auth } from './firebase'
import { haversineKm } from './geo'
import { formatDistance, isApproximatePin, placeLabel, type GeoSource, type Place } from './place'
import { useBuyerLocation } from './useBuyerLocation'
import { useBag, getBagCounts, type BagCountData } from './useBag'
import ProductCard from './ProductCard'
import ProductCardSkeleton from './ProductCardSkeleton'
import ProductActions from './ProductActions'
import ProductPreview from './ProductPreview'
import { getMainCategories } from './categories'
import { green, productImages, seededShuffle, toMillis, type CardProduct } from './productCardUtils'
import { detectSource, track } from './tracking'

interface NearbySeller {
  id: string
  businessName: string
  slug: string
  logoUrl?: string
  location?: string
  place?: Place
  geoSource?: GeoSource
  geo?: { lat: number; lng: number }
  distanceKm?: number
}

interface DiscoveryProduct extends CardProduct {
  /** Distance to the seller — undefined when we don't know the buyer's area. */
  distanceKm?: number
  /** When the seller listed it, in ms. Missing on older products. */
  createdAtMs?: number
}

const RANGE_PRESETS = [5, 10, 25, 40]
const CATEGORIES = ['All', ...getMainCategories()]
/** One query per seller — capped so the page stays fast at any radius. */
const MAX_NEAR_SELLERS = 20
const MAX_EXTRA_SELLERS = 12
/** Below this many in-range sellers we top up so the page is never empty. */
const MIN_DISCOVERY_POOL = 8
const RAIL_LIMIT = 10
const CLOSEST_GRID_LIMIT = 30
const STORE_RAIL_LIMIT = 8
const SKELETON_COUNT = 6

/** Small local building blocks for the discovery feed. */
function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', margin: '0 0 12px' }}>
      <h2 style={{ margin: 0, fontSize: '17px', fontWeight: '800', color: '#fff' }}>{title}</h2>
      {action}
    </div>
  )
}

function Rail({ children }: { children: ReactNode }) {
  return (
    <div className="rt-rail" style={{ display: 'flex', gap: '14px', overflowX: 'auto', paddingBottom: '8px', marginBottom: '26px' }}>
      {children}
    </div>
  )
}

function RailItem({ children }: { children: ReactNode }) {
  return <div style={{ flex: '0 0 190px', minWidth: 0 }}>{children}</div>
}

function Grid({ children }: { children: ReactNode }) {
  return (
    <div className="rt-products" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '16px' }}>
      {children}
    </div>
  )
}


function NearbyPage() {
  const navigate = useNavigate()
  const {
    area,
    label: areaLabel,
    status,
    error: locationError,
    detect,
    setManualArea,
    clear,
  } = useBuyerLocation()

  const [manualText, setManualText] = useState('')
  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState('All')
  const [range, setRange] = useState(10)
  const [showRange, setShowRange] = useState(false)
  const [customRange, setCustomRange] = useState('')
  const [loadError, setLoadError] = useState('')
  const [allSellers, setAllSellers] = useState<NearbySeller[]>([])
  const [sellersLoaded, setSellersLoaded] = useState(false)
  const [pool, setPool] = useState<{ key: string; items: DiscoveryProduct[] }>({ key: '', items: [] })
  const [bagCounts, setBagCounts] = useState<Record<string, BagCountData>>({})
  const [orderProduct, setOrderProduct] = useState<CardProduct | null>(null)
  const [messageProduct, setMessageProduct] = useState<CardProduct | null>(null)
  const [preview, setPreview] = useState<{ images: string[]; index: number } | null>(null)
  const [userId, setUserId] = useState<string | null>(auth.currentUser?.uid || null)
  const [shuffleSeed, setShuffleSeed] = useState(() => Date.now())
  const rangeWrapRef = useRef<HTMLDivElement | null>(null)
  const { addToBag, removeFromBag, isInBag } = useBag()

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, u => setUserId(u?.uid || null))
    return () => unsub()
  }, [])

  // Load every seller once. The buyer's own location never leaves their device.
  useEffect(() => {
    let cancelled = false
    getDocs(collection(db, 'sellers'))
      .then(snap => {
        if (cancelled) return
        setAllSellers(snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<NearbySeller, 'id'>) })))
      })
      .catch(err => {
        if (!cancelled) {
          console.error('Nearby load error:', err)
          setLoadError('Could not load sellers. Try again.')
        }
      })
      .finally(() => {
        if (!cancelled) setSellersLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Close the range dropdown when tapping anywhere else.
  useEffect(() => {
    if (!showRange) return
    const onDown = (e: MouseEvent) => {
      if (rangeWrapRef.current && !rangeWrapRef.current.contains(e.target as Node)) setShowRange(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [showRange])

  const sellerById = useMemo(() => new Map(allSellers.map(s => [s.id, s])), [allSellers])

  /** Sellers inside the chosen range, nearest first. */
  const nearbySellers = useMemo(() => {
    return allSellers
      .filter(s => s.geo && typeof s.geo.lat === 'number' && typeof s.geo.lng === 'number')
      .filter(s => s.id !== userId) // your own store isn't "near you"
      .map(s => ({
        ...s,
        distanceKm: area ? haversineKm(area.lat, area.lng, s.geo!.lat, s.geo!.lng) : undefined,
      }))
      .filter(s => s.distanceKm === undefined || s.distanceKm <= range)
      .sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0))
  }, [allSellers, area, range, userId])

  const withoutLocation = useMemo(
    () => allSellers.filter(s => !s.geo && s.id !== userId),
    [allSellers, userId],
  )

  // Which area + range the held products belong to. Changing either invalidates
  // them immediately, so stale results never linger.
  const poolKey = area ? `${area.lat.toFixed(3)},${area.lng.toFixed(3)},${range}` : 'no-area'

  // Load products: nearby sellers first, topped up with a small sample from further
  // away when the nearby pool is thin — so the page always has something to show.
  useEffect(() => {
    if (!sellersLoaded) return
    const chosen: NearbySeller[] = nearbySellers.slice(0, MAX_NEAR_SELLERS)
    if (chosen.length < MIN_DISCOVERY_POOL) {
      const targetIds = new Set(chosen.map(s => s.id))
      chosen.push(
        ...allSellers.filter(s => !targetIds.has(s.id) && s.id !== userId).slice(0, MAX_EXTRA_SELLERS),
      )
    }

    let cancelled = false
    Promise.all(
      chosen.map(async seller => {
        try {
          const snap = await getDocs(collection(db, 'sellers', seller.id, 'products'))
          return snap.docs.map(d => {
            const data = d.data() as Record<string, unknown>
            const product: DiscoveryProduct = {
              id: d.id,
              name: (data.name as string) || 'Product',
              price: (data.price as string) || '',
              description: (data.description as string) || '',
              imageUrl: (data.imageUrl as string) || '',
              images: Array.isArray(data.images) ? (data.images as string[]) : undefined,
              category: data.category as string | undefined,
              subCategory: data.subCategory as string | undefined,
              outOfStock: Boolean(data.outOfStock),
              orderCount: Number(data.orderCount) || 0,
              salesCount: Number(data.salesCount) || 0,
              createdAtMs: toMillis(data.createdAt),
              sellerId: seller.id,
              sellerSlug: seller.slug,
              businessName: seller.businessName,
              // Only claim a distance when we know both points.
              distanceKm:
                seller.geo && area
                  ? haversineKm(area.lat, area.lng, seller.geo.lat, seller.geo.lng)
                  : undefined,
            }
            return product
          })
        } catch (err) {
          console.warn('Nearby products failed for', seller.businessName, err)
          return [] as DiscoveryProduct[]
        }
      }),
    )
      .then(groups => {
        if (cancelled) return
        setPool({ key: poolKey, items: groups.flat() })
      })
      .catch(err => {
        if (cancelled) return
        console.error('Nearby products error:', err)
        setPool({ key: poolKey, items: [] })
      })
    return () => {
      cancelled = true
    }
  }, [allSellers, area, nearbySellers, poolKey, sellersLoaded, userId])

  const products = useMemo(() => (pool.key === poolKey ? pool.items : []), [pool, poolKey])
  const loadingPool = sellersLoaded && pool.key !== poolKey

  const matching = useMemo(
    () => (activeCategory === 'All' ? products : products.filter(p => p.category === activeCategory)),
    [products, activeCategory],
  )

  /** Everything we can rank by distance, then only what's inside the chosen range. */
  const nearby = useMemo(
    () =>
      matching
        .filter(p => p.distanceKm !== undefined && (p.distanceKm as number) <= range)
        .sort((a, b) => (a.distanceKm || 0) - (b.distanceKm || 0)),
    [matching, range],
  )

  /** Ranked by what's actually moving — both the hero and the rail draw from this. */
  const popularRanked = useMemo(() => {
    const score = (p: DiscoveryProduct) => (p.orderCount || 0) * 2 + (p.salesCount || 0)
    const hot = matching.filter(p => score(p) > 0).sort((a, b) => score(b) - score(a))
    const rest = matching.filter(p => score(p) === 0)
    return [...hot, ...rest]
  }, [matching])

  const hero = nearby[0] || popularRanked[0] || matching[0] || null
  /** Rails only make sense once there's enough to fill them without repeating. */
  const showRails = matching.length >= 6
  /** True once at least one product carries a listing date. */
  const hasNewest = matching.some(p => p.createdAtMs !== undefined)

  // The hero already leads the page — keep it out of the rails and grids so a
  // small catalogue doesn't feel like the same products on repeat.
  const popular = useMemo(
    () => popularRanked.filter(p => p.id !== hero?.id).slice(0, RAIL_LIMIT),
    [popularRanked, hero],
  )
  const nearbyGrid = useMemo(
    () => nearby.filter(p => p.id !== hero?.id),
    [nearby, hero],
  )
  const others = useMemo(
    () => matching.filter(p => p.id !== hero?.id),
    [matching, hero],
  )

  const fresh = useMemo(() => {
    if (hasNewest) {
      // Real "newest" — newest listing first, items without a date last.
      return [...matching]
        .sort((a, b) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0))
        .filter(p => p.id !== hero?.id)
        .slice(0, RAIL_LIMIT)
    }
    // No createdAt anywhere yet → shuffled picks, reshuffled on demand.
    const seen = new Set<string>()
    if (hero) seen.add(hero.id)
    popular.forEach(p => seen.add(p.id))
    const rest = matching.filter(p => !seen.has(p.id))
    const pool = rest.length >= 4 ? rest : matching
    return seededShuffle(pool, shuffleSeed).slice(0, RAIL_LIMIT)
  }, [matching, popular, hero, shuffleSeed, hasNewest])

  const searchResults = useMemo(() => {
    const term = search.trim()
    if (!term) return []
    const fuse = new Fuse(matching, {
      keys: ['name', 'description', 'businessName', 'category', 'subCategory'],
      threshold: 0.4,
      ignoreLocation: true,
    })
    return fuse.search(term).map(r => r.item)
  }, [matching, search])

  const searching = search.trim().length > 0

  const displayedIds = useMemo(() => {
    const ids = new Set<string>()
    const add = (list: DiscoveryProduct[]) => list.forEach(p => ids.add(p.id))
    if (searching) {
      add(searchResults)
    } else {
      if (hero) ids.add(hero.id)
      add(popular)
      add(fresh)
      add(nearbyGrid.slice(0, CLOSEST_GRID_LIMIT))
      add(others.slice(0, CLOSEST_GRID_LIMIT))
    }
    return [...ids]
  }, [searching, searchResults, hero, popular, fresh, nearbyGrid, others])

  useEffect(() => {
    if (displayedIds.length === 0) return
    getBagCounts(displayedIds).then(setBagCounts).catch(() => {})
  }, [displayedIds])

  const handleToggleBag = (p: DiscoveryProduct) => {
    if (isInBag(p.id)) {
      removeFromBag(p.id)
      setBagCounts(prev => ({
        ...prev,
        [p.id]: { count: Math.max(0, (prev[p.id]?.count || 0) - 1), baggedCount: prev[p.id]?.baggedCount || 0 },
      }))
    } else {
      addToBag({
        productId: p.id,
        productName: p.name,
        productPrice: p.price,
        imageUrl: p.imageUrl,
        images: p.images?.length ? p.images : (p.imageUrl ? [p.imageUrl] : []),
        sellerSlug: p.sellerSlug,
        sellerId: p.sellerId,
        businessName: p.businessName,
      })
      setBagCounts(prev => ({
        ...prev,
        [p.id]: { count: (prev[p.id]?.count || 0) + 1, baggedCount: (prev[p.id]?.baggedCount || 0) + 1 },
      }))
    }
  }

  const applyCustomRange = () => {
    const n = Math.round(Number(customRange))
    if (!isFinite(n) || n <= 0) return
    setRange(Math.min(200, n))
    setShowRange(false)
    setCustomRange('')
  }

  const openProduct = (p: DiscoveryProduct) => {
    track('product_viewed', userId, detectSource(), {
      productId: p.id,
      productName: p.name,
      sellerSlug: p.sellerSlug,
      distanceKm: p.distanceKm,
    })
    navigate(`/store/${p.sellerSlug}`)
  }

  const cardFor = (p: DiscoveryProduct) => {
    const seller = sellerById.get(p.sellerId)
    const label =
      p.distanceKm === undefined
        ? undefined
        : formatDistance(p.distanceKm, { approximate: isApproximatePin(seller?.geoSource) })
    return (
      <ProductCard
        key={p.id}
        p={p}
        distanceLabel={label}
        inBag={isInBag(p.id)}
        bagged={bagCounts[p.id]?.baggedCount || 0}
        isMine={p.sellerId === userId}
        onOpen={() => openProduct(p)}
        onPreview={() => {
          const imgs = productImages(p)
          if (imgs.length > 0) setPreview({ images: imgs, index: 0 })
        }}
        onToggleBag={() => handleToggleBag(p)}
        onMessage={() => setMessageProduct(p)}
        onOrder={() => setOrderProduct(p)}
      />
    )
  }

  const locating = status === 'locating'
  const error = locationError || loadError
  const widerRange = RANGE_PRESETS.find(r => r > range) || range * 2

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f0f', fontFamily: 'sans-serif', color: '#fff', padding: '20px' }}>
      <div style={{ maxWidth: '980px', margin: '0 auto' }}>
        {/* Header — title left, my location top right */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', marginBottom: '14px', flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ margin: '0 0 4px', fontSize: '23px', fontWeight: '800' }}>📍 Nearby</h1>
            <p style={{ margin: 0, color: '#888', fontSize: '13px' }}>
              Discover what you can buy around you — from neighbourhood sellers.
            </p>
          </div>
          {area && (
            <div style={{ textAlign: 'right' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#12210d', border: `1px solid ${green}`, color: green, borderRadius: '999px', padding: '6px 12px', fontSize: '13px', fontWeight: '700' }}>
                📍 {areaLabel || 'Your area'}
              </span>
              <button onClick={() => { clear(); setManualText('') }}
                style={{ display: 'block', marginLeft: 'auto', marginTop: '6px', padding: '4px 8px', background: 'transparent', border: 'none', color: '#888', cursor: 'pointer', fontSize: '12px', textDecoration: 'underline' }}>
                Change
              </button>
            </div>
          )}
        </div>

        {/* Location stays a soft banner — it never blocks the feed */}
        {!area && (
          <div style={{ background: '#141414', border: '1px solid #262626', borderRadius: '12px', padding: '14px', marginBottom: '14px' }}>
            <p style={{ margin: '0 0 10px', color: '#bbb', fontSize: '13px', fontWeight: 600 }}>
              📍 Set your area to sort by distance — meanwhile, here's what's selling.
            </p>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button onClick={detect} disabled={locating}
                style={{ padding: '10px 14px', background: locating ? '#333' : green, color: locating ? '#888' : '#000', border: 'none', borderRadius: '10px', fontWeight: '800', cursor: locating ? 'not-allowed' : 'pointer', fontSize: '13px', whiteSpace: 'nowrap' }}>
                {locating ? '⏳ Locating…' : 'Use my location'}
              </button>
              <input value={manualText} onChange={e => setManualText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') setManualArea(manualText) }}
                placeholder="Or type your area e.g. Kampala"
                style={{ flex: 1, minWidth: '160px', padding: '10px 12px', borderRadius: '10px', border: '1px solid #333', background: '#111', color: '#fff', fontSize: '14px', boxSizing: 'border-box' }} />
              <button onClick={() => setManualArea(manualText)} disabled={locating}
                style={{ padding: '10px 14px', background: '#222', color: '#fff', border: '1px solid #333', borderRadius: '10px', cursor: locating ? 'not-allowed' : 'pointer', fontWeight: '700', fontSize: '13px' }}>
                Find
              </button>
            </div>
            <p style={{ margin: '10px 0 0', color: '#555', fontSize: '11px' }}>Your location is used only on this screen — never saved.</p>
          </div>
        )}

        {/* Search bar */}
        <div style={{ position: 'relative', marginBottom: '10px' }}>
          <input
            value={search}
            onChange={e => {
              const value = e.target.value
              setSearch(value)
              // Search looks across every category — otherwise a category tapped
              // earlier silently hides the results the buyer just asked for.
              if (value.trim() && activeCategory !== 'All') setActiveCategory('All')
            }}
            placeholder="Search products near you — shoes, charger, dress…"
            style={{ width: '100%', padding: '14px 16px', borderRadius: '12px', border: '1px solid #333', background: '#111', color: '#fff', fontSize: '15px', boxSizing: 'border-box' }}
          />
          {search && (
            <button onClick={() => setSearch('')}
              style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: '#666', cursor: 'pointer', fontSize: '16px' }}>
              ✕
            </button>
          )}
        </div>

        {/* Range dropdown — right end, under the search bar */}
        <div ref={rangeWrapRef} style={{ position: 'relative', display: 'flex', justifyContent: 'flex-end', marginBottom: '10px' }}>
          <button onClick={() => setShowRange(v => !v)}
            style={{ padding: '9px 14px', borderRadius: '999px', border: `1px solid ${showRange ? green : '#333'}`, background: showRange ? '#1a2a1a' : '#1a1a1a', color: showRange ? green : '#ddd', fontWeight: '700', fontSize: '13px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
            Within {range} km ▾
          </button>
          {showRange && (
            <div style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, background: '#1a1a1a', border: '1px solid #333', borderRadius: '12px', padding: '8px', minWidth: '230px', zIndex: 40, boxShadow: '0 12px 32px rgba(0,0,0,0.6)' }}>
              {RANGE_PRESETS.map(r => (
                <button key={r} onClick={() => { setRange(r); setShowRange(false) }}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '10px 12px', background: range === r ? '#12210d' : 'transparent', color: range === r ? green : '#ddd', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '14px', fontWeight: range === r ? 800 : 500 }}>
                  <span>Within {r} km</span>
                  {range === r && <span>✓</span>}
                </button>
              ))}
              <div style={{ borderTop: '1px solid #262626', marginTop: '6px', paddingTop: '8px' }}>
                <p style={{ margin: '0 0 6px 4px', color: '#888', fontSize: '12px', fontWeight: 700 }}>Add your own</p>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <input
                    value={customRange}
                    onChange={e => setCustomRange(e.target.value.replace(/[^\d]/g, '').slice(0, 3))}
                    onKeyDown={e => { if (e.key === 'Enter') applyCustomRange() }}
                    placeholder="3"
                    inputMode="numeric"
                    style={{ flex: 1, minWidth: 0, padding: '9px 10px', borderRadius: '8px', border: '1px solid #333', background: '#111', color: '#fff', fontSize: '14px', boxSizing: 'border-box' }}
                  />
                  <span style={{ alignSelf: 'center', color: '#888', fontSize: '13px' }}>km</span>
                  <button onClick={applyCustomRange} disabled={!customRange}
                    style={{ padding: '9px 14px', background: customRange ? green : '#2a2a2a', color: customRange ? '#000' : '#666', border: 'none', borderRadius: '8px', fontWeight: '800', cursor: customRange ? 'pointer' : 'not-allowed', fontSize: '15px' }}>
                    →
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Category chips — discover by tapping */}
        {!searching && (
          <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '4px', marginBottom: '12px' }}>
            {CATEGORIES.map(cat => (
              <button key={cat} onClick={() => setActiveCategory(cat)}
                style={{ padding: '7px 14px', borderRadius: '999px', border: `1px solid ${activeCategory === cat ? green : '#333'}`, background: activeCategory === cat ? green : '#1a1a1a', color: activeCategory === cat ? '#000' : '#aaa', fontWeight: activeCategory === cat ? '800' : '500', fontSize: '13px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                {cat}
              </button>
            ))}
          </div>
        )}

        {/* The reassurance line */}
        <p style={{ margin: '0 0 16px', color: '#888', fontSize: '13px' }}>
          {searching ? (
            <>Showing results for <strong style={{ color: '#fff' }}>“{search.trim()}”</strong></>
          ) : (
            <>Showing products near <strong style={{ color: '#fff' }}>{areaLabel || 'you'}</strong></>
          )}
          {area && <> · within <strong style={{ color: green }}>{range} km</strong></>}
          {!loadingPool && (
            <>
              {' — '}
              {searching ? searchResults.length : area ? nearby.length : matching.length} product
              {(searching ? searchResults.length : area ? nearby.length : matching.length) === 1 ? '' : 's'}
              {searching || area ? '' : ' available'}
            </>
          )}
        </p>

        {loadingPool ? (
          <Grid>
            {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
              <ProductCardSkeleton key={i} />
            ))}
          </Grid>
        ) : searching ? (
          searchResults.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px 20px', border: '1px dashed #222', borderRadius: '12px' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>🔍</div>
              <p style={{ color: '#888', fontSize: '14px', margin: '0 0 4px' }}>
                Nothing matching “{search.trim()}”{area ? ` within ${range} km` : ' yet'}.
              </p>
              <p style={{ color: '#555', fontSize: '12px', margin: '0 0 16px' }}>
                Try another word{activeCategory !== 'All' ? ', another category' : ''}, or widen your range.
              </p>
              <button onClick={() => setRange(widerRange)}
                style={{ padding: '10px 18px', background: green, color: '#000', border: 'none', borderRadius: '10px', fontWeight: '800', cursor: 'pointer', fontSize: '14px' }}>
                Widen to {widerRange} km
              </button>
            </div>
          ) : (
            <Grid>{searchResults.map(p => cardFor(p))}</Grid>
          )
        ) : products.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 20px', border: '1px dashed #222', borderRadius: '12px' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🛍️</div>
            <p style={{ color: '#888', fontSize: '14px', margin: '0 0 4px' }}>
              Nothing is listed here yet{activeCategory !== 'All' ? ` in ${activeCategory}` : ''}.
            </p>
            <p style={{ color: '#555', fontSize: '12px', margin: '0 0 16px' }}>
              {activeCategory !== 'All'
                ? 'Try “All”, or check back soon — sellers are joining every day.'
                : 'Sellers are joining every day. Set a wider range or check back soon.'}
            </p>
            {activeCategory !== 'All' ? (
              <button onClick={() => setActiveCategory('All')}
                style={{ padding: '10px 18px', background: green, color: '#000', border: 'none', borderRadius: '10px', fontWeight: '800', cursor: 'pointer', fontSize: '14px' }}>
                Show all categories
              </button>
            ) : (
              <button onClick={() => setRange(widerRange)}
                style={{ padding: '10px 18px', background: green, color: '#000', border: 'none', borderRadius: '10px', fontWeight: '800', cursor: 'pointer', fontSize: '14px' }}>
                Widen to {widerRange} km
              </button>
            )}
          </div>
        ) : (
          <>
            {/* Hero — the lead item, so the page never opens flat */}
            {hero && (
              <div style={{ background: '#1a1a1a', border: '1px solid #262626', borderRadius: '16px', overflow: 'hidden', marginBottom: '26px' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap' }}>
                  <img
                    src={productImages(hero)[0] || 'https://placehold.co/600x400/1a1a1a/333333'}
                    alt={hero.name}
                    onClick={() => openProduct(hero)}
                    style={{ flex: '1 1 300px', width: '100%', maxWidth: '460px', height: '240px', objectFit: 'cover', cursor: 'pointer' }}
                  />
                  <div style={{ flex: '1 1 260px', padding: '20px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                    <span style={{ alignSelf: 'flex-start', background: '#12210d', border: `1px solid ${green}`, color: green, borderRadius: '999px', padding: '5px 12px', fontSize: '12px', fontWeight: '800', marginBottom: '12px' }}>
                      {hero.distanceKm !== undefined
                        ? `📍 ${formatDistance(hero.distanceKm, { approximate: isApproximatePin(sellerById.get(hero.sellerId)?.geoSource) })} away`
                        : '⭐ Top pick right now'}
                    </span>
                    <h2 style={{ margin: '0 0 6px', fontSize: '20px', fontWeight: '800', color: '#fff' }}>{hero.name}</h2>
                    <p style={{ margin: '0 0 10px', color: '#888', fontSize: '13px' }}>by {hero.businessName}</p>
                    <p style={{ margin: '0 0 16px', color: green, fontSize: '19px', fontWeight: '800' }}>UGX {hero.price}</p>
                    {!hero.outOfStock && hero.sellerId !== userId ? (
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        <button onClick={() => setOrderProduct(hero)}
                          style={{ padding: '11px 18px', background: green, color: '#000', border: 'none', borderRadius: '10px', fontWeight: '800', cursor: 'pointer', fontSize: '14px' }}>
                          Buy Now
                        </button>
                        <button onClick={() => setMessageProduct(hero)}
                          style={{ padding: '11px 18px', background: '#222', color: '#fff', border: '1px solid #333', borderRadius: '10px', fontWeight: '700', cursor: 'pointer', fontSize: '14px' }}>
                          💬 Message
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => openProduct(hero)}
                        style={{ alignSelf: 'flex-start', padding: '11px 18px', background: '#222', color: '#fff', border: '1px solid #333', borderRadius: '10px', fontWeight: '700', cursor: 'pointer', fontSize: '14px' }}>
                        View store
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* 🔥 What's actually moving */}
            {showRails && popular.length > 1 && (
              <section>
                <SectionHeader title="🔥 Popular right now" />
                <Rail>
                  {popular.map(p => (
                    <RailItem key={p.id}>{cardFor(p)}</RailItem>
                  ))}
                </Rail>
              </section>
            )}

            {/* 🆕 Newest when we have dates, 🎲 shuffled when we don't */}
            {showRails && fresh.length > 1 && (
              <section>
                <SectionHeader
                  title={hasNewest ? '🆕 New near you' : '🎲 Fresh picks near you'}
                  action={
                    hasNewest ? undefined : (
                      <button onClick={() => setShuffleSeed(Date.now())}
                        style={{ padding: '7px 13px', background: '#1a1a1a', border: '1px solid #333', color: '#ddd', borderRadius: '999px', fontWeight: '700', fontSize: '12px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                        🔀 Shuffle
                      </button>
                    )
                  }
                />
                <Rail>
                  {fresh.map(p => (
                    <RailItem key={p.id}>{cardFor(p)}</RailItem>
                  ))}
                </Rail>
              </section>
            )}

            {/* 📍 Nearest first — or simply everything, before an area is set */}
            {area ? (
              nearby.length === 0 ? (
                <p style={{ color: '#888', fontSize: '13px', border: '1px dashed #262626', borderRadius: '12px', padding: '14px', marginBottom: '26px' }}>
                  Nothing inside {range} km{activeCategory !== 'All' ? ` in ${activeCategory}` : ''} yet — showing picks from further out.{' '}
                  <button onClick={() => setRange(widerRange)}
                    style={{ background: 'transparent', border: 'none', color: green, fontWeight: '800', cursor: 'pointer', fontSize: '13px', textDecoration: 'underline', padding: 0 }}>
                    Widen to {widerRange} km
                  </button>
                </p>
              ) : nearbyGrid.length > 0 ? (
                <section style={{ marginBottom: '26px' }}>
                  <SectionHeader title={`📍 Closest to you · within ${range} km`} />
                  <Grid>{nearbyGrid.slice(0, CLOSEST_GRID_LIMIT).map(p => cardFor(p))}</Grid>
                </section>
              ) : null
            ) : (
              <section style={{ marginBottom: '26px' }}>
                <SectionHeader title="🛍️ Explore products" />
                <Grid>{others.slice(0, CLOSEST_GRID_LIMIT).map(p => cardFor(p))}</Grid>
              </section>
            )}
          </>
        )}

        {/* Stores near you — kept below the products */}
        {!searching && nearbySellers.length > 0 && (
          <section style={{ marginTop: '6px' }}>
            <SectionHeader title={area ? '🏪 Stores near you' : '🏪 Sellers on rachett'} />
            <div style={{ display: 'flex', gap: '12px', overflowX: 'auto', paddingBottom: '8px' }}>
              {nearbySellers.slice(0, STORE_RAIL_LIMIT).map(s => (
                <div key={s.id} onClick={() => navigate(`/store/${s.slug}`)}
                  style={{ flex: '0 0 190px', background: '#1a1a1a', border: '1px solid #222', borderRadius: '12px', padding: '14px', cursor: 'pointer', textAlign: 'center' }}>
                  {s.logoUrl ? (
                    <img src={s.logoUrl} alt={s.businessName} style={{ width: 54, height: 54, borderRadius: '50%', objectFit: 'cover', margin: '0 auto 8px', display: 'block' }} />
                  ) : (
                    <div style={{ width: 54, height: 54, borderRadius: '50%', background: '#333', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 20, margin: '0 auto 8px' }}>
                      {(s.businessName || 'S').charAt(0).toUpperCase()}
                    </div>
                  )}
                  <p style={{ margin: '0 0 2px', fontWeight: '700', fontSize: '14px', color: '#fff' }}>{s.businessName}</p>
                  <p style={{ margin: '0 0 8px', color: '#888', fontSize: '12px' }}>{placeLabel(s.place) || s.location || 'Location not set'}</p>
                  <span style={{ display: 'inline-block', background: '#12210d', border: `1px solid ${green}`, color: green, borderRadius: '999px', padding: '3px 10px', fontSize: '11px', fontWeight: '800' }}>
                    {s.distanceKm !== undefined
                      ? formatDistance(s.distanceKm, { approximate: isApproximatePin(s.geoSource) })
                      : 'Set your area'}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {!searching && sellersLoaded && withoutLocation.length > 0 && (
          <p style={{ color: '#555', fontSize: '12px', textAlign: 'center', marginTop: '10px' }}>
            {withoutLocation.length} seller{withoutLocation.length === 1 ? '' : 's'} haven't added a location yet, so their products can't be sorted by distance.
          </p>
        )}

        {error && <p style={{ color: '#ff4444', fontSize: '13px', marginTop: '12px' }}>{error}</p>}
      </div>

      <ProductActions
        orderProduct={orderProduct}
        messageProduct={messageProduct}
        onCloseOrder={() => setOrderProduct(null)}
        onCloseMessage={() => setMessageProduct(null)}
      />

      {preview && (
        <ProductPreview images={preview.images} startIndex={preview.index} onClose={() => setPreview(null)} />
      )}
    </div>
  )
}

export default NearbyPage
