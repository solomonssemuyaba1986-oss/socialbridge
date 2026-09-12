import { useEffect, useMemo, useRef, useState } from 'react'
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
import { green, productImages, type CardProduct } from './productCardUtils'
import ProductActions from './ProductActions'
import ProductPreview from './ProductPreview'
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

interface NearbyProduct extends CardProduct {
  distanceKm: number
}

const RANGE_PRESETS = [5, 10, 25, 40]
/** One query per nearby seller — cap it so a huge radius stays fast. */
const MAX_SELLERS = 20
const STORE_ROW_LIMIT = 8

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
  const [range, setRange] = useState(10)
  const [showRange, setShowRange] = useState(false)
  const [customRange, setCustomRange] = useState('')
  const [loadError, setLoadError] = useState('')
  const [allSellers, setAllSellers] = useState<NearbySeller[]>([])
  const [productData, setProductData] = useState<{ key: string; items: NearbyProduct[] }>({ key: '', items: [] })
  const [loadingSellers, setLoadingSellers] = useState(true)
  const [bagCounts, setBagCounts] = useState<Record<string, BagCountData>>({})
  const [orderProduct, setOrderProduct] = useState<CardProduct | null>(null)
  const [messageProduct, setMessageProduct] = useState<CardProduct | null>(null)
  const [preview, setPreview] = useState<{ images: string[]; index: number } | null>(null)
  const [userId, setUserId] = useState<string | null>(auth.currentUser?.uid || null)
  const rangeWrapRef = useRef<HTMLDivElement | null>(null)
  const { addToBag, removeFromBag, isInBag } = useBag()

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, u => setUserId(u?.uid || null))
    return () => unsub()
  }, [])

  // Load every seller once. The buyer's own location is never written anywhere.
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
        if (!cancelled) setLoadingSellers(false)
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

  /** Sellers inside the chosen range, nearest first. */
  const nearbySellers = useMemo(() => {
    if (!area) return []
    return allSellers
      .filter(s => s.geo && typeof s.geo.lat === 'number' && typeof s.geo.lng === 'number')
      .filter(s => s.id !== userId) // your own store isn't "near you"
      .map(s => ({ ...s, distanceKm: haversineKm(area.lat, area.lng, s.geo!.lat, s.geo!.lng) }))
      .filter(s => (s.distanceKm || 0) <= range)
      .sort((a, b) => (a.distanceKm || 0) - (b.distanceKm || 0))
  }, [allSellers, area, range, userId])

  const withoutLocation = useMemo(
    () => allSellers.filter(s => !s.geo && s.id !== userId),
    [allSellers, userId],
  )

  const sellerById = useMemo(
    () => new Map(nearbySellers.map(s => [s.id, s])),
    [nearbySellers],
  )

  // Which area + range the held products belong to. Changing the range invalidates
  // them immediately, so a buyer never sees stale "10 km" results after picking 5 km.
  const productKey = area ? `${area.lat.toFixed(3)},${area.lng.toFixed(3)},${range}` : ''

  // Pull the products of the nearby sellers — this is what makes Nearby answer
  // "what can I buy near me?" instead of just listing stores.
  useEffect(() => {
    if (!area) return
    const targets = nearbySellers.slice(0, MAX_SELLERS)
    if (targets.length === 0) return
    let cancelled = false
    Promise.all(
      targets.map(async seller => {
        try {
          const snap = await getDocs(collection(db, 'sellers', seller.id, 'products'))
          return snap.docs.map(d => {
            const data = d.data() as Record<string, unknown>
            const product: NearbyProduct = {
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
              sellerId: seller.id,
              sellerSlug: seller.slug,
              businessName: seller.businessName,
              distanceKm: seller.distanceKm || 0,
            }
            return product
          })
        } catch (err) {
          console.warn('Nearby products failed for', seller.businessName, err)
          return [] as NearbyProduct[]
        }
      }),
    )
      .then(groups => {
        if (cancelled) return
        setProductData({
          key: productKey,
          items: groups.flat().sort((a, b) => a.distanceKm - b.distanceKm),
        })
      })
      .catch(err => {
        if (cancelled) return
        console.error('Nearby products error:', err)
        setProductData({ key: productKey, items: [] })
      })
    return () => {
      cancelled = true
    }
  }, [area, nearbySellers, productKey])

  const products = useMemo(
    () => (productData.key === productKey ? productData.items : []),
    [productData, productKey],
  )
  const loadingProducts = !!area && nearbySellers.length > 0 && productData.key !== productKey

  /** Search only ever looks inside the products already filtered by range. */
  const visible = useMemo(() => {
    const term = search.trim()
    if (!term) return products
    const fuse = new Fuse(products, {
      keys: ['name', 'description', 'businessName', 'category', 'subCategory'],
      threshold: 0.4,
      ignoreLocation: true,
    })
    return fuse
      .search(term)
      .map(r => r.item)
      .sort((a, b) => a.distanceKm - b.distanceKm)
  }, [products, search])

  useEffect(() => {
    const ids = visible.map(p => p.id)
    if (ids.length === 0) return
    getBagCounts(ids).then(setBagCounts).catch(() => {})
  }, [visible])

  const handleToggleBag = (p: NearbyProduct) => {
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

  const locating = status === 'locating'
  const error = locationError || loadError
  const widerRange = RANGE_PRESETS.find(r => r > range) || range * 2

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f0f', fontFamily: 'sans-serif', color: '#fff', padding: '20px' }}>
      <div style={{ maxWidth: '900px', margin: '0 auto' }}>
        {/* Header — title on the left, my location on the top right */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ margin: '0 0 4px', fontSize: '22px', fontWeight: '800' }}>📍 Nearby</h1>
            <p style={{ margin: 0, color: '#888', fontSize: '13px' }}>
              What can you buy near you? Everything here is inside your range.
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

        {!area ? (
          <div style={{ background: '#1a1a1a', borderRadius: '12px', padding: '16px', border: '1px solid #222', marginBottom: '16px' }}>
            <button onClick={detect} disabled={locating}
              style={{ width: '100%', padding: '14px', background: locating ? '#333' : green, color: locating ? '#888' : '#000', border: 'none', borderRadius: '10px', fontWeight: '800', cursor: locating ? 'not-allowed' : 'pointer', fontSize: '15px', marginBottom: '12px' }}>
              {locating ? '⏳ Locating…' : '📍 Use my location'}
            </button>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input value={manualText} onChange={e => setManualText(e.target.value)} placeholder="Or type your area e.g. Kampala"
                style={{ flex: 1, padding: '12px', borderRadius: '10px', border: '1px solid #333', background: '#111', color: '#fff', fontSize: '14px', boxSizing: 'border-box' }} />
              <button onClick={() => setManualArea(manualText)} disabled={locating}
                style={{ padding: '12px 16px', background: '#222', color: '#fff', border: '1px solid #333', borderRadius: '10px', cursor: locating ? 'not-allowed' : 'pointer', fontWeight: '700', fontSize: '13px', whiteSpace: 'nowrap' }}>
                {locating ? '…' : 'Find'}
              </button>
            </div>
            <p style={{ margin: '10px 0 0', color: '#555', fontSize: '11px' }}>Your location is used only on this screen — never saved.</p>
          </div>
        ) : (
          <>
            {/* Search bar */}
            <div style={{ position: 'relative', marginBottom: '10px' }}>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
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

            {/* The reassurance line */}
            <p style={{ margin: '0 0 16px', color: '#888', fontSize: '13px' }}>
              Showing products near <strong style={{ color: '#fff' }}>{areaLabel || 'you'}</strong> · within{' '}
              <strong style={{ color: green }}>{range} km</strong>
              {!loadingProducts && (
                <> — {visible.length} product{visible.length === 1 ? '' : 's'} found</>
              )}
            </p>

            {loadingProducts ? (
              <p style={{ color: '#666', fontSize: '13px' }}>Finding products near you…</p>
            ) : visible.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '48px 20px', border: '1px dashed #222', borderRadius: '12px' }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>{search.trim() ? '🔍' : '🗺️'}</div>
                <p style={{ color: '#888', fontSize: '14px', margin: '0 0 4px' }}>
                  {search.trim()
                    ? `Nothing matching “${search.trim()}” within ${range} km.`
                    : `No products within ${range} km yet.`}
                </p>
                <p style={{ color: '#555', fontSize: '12px', margin: '0 0 16px' }}>
                  {search.trim() ? 'Try another word, or widen your range.' : 'Widen the range, or check back soon.'}
                </p>
                <button onClick={() => setRange(widerRange)}
                  style={{ padding: '10px 18px', background: green, color: '#000', border: 'none', borderRadius: '10px', fontWeight: '800', cursor: 'pointer', fontSize: '14px' }}>
                  Widen to {widerRange} km
                </button>
              </div>
            ) : (
              <div className="rt-products" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '16px' }}>
                {visible.map(p => {
                  const seller = sellerById.get(p.sellerId)
                  return (
                    <ProductCard
                      key={p.id}
                      p={p}
                      distanceLabel={formatDistance(p.distanceKm, { approximate: isApproximatePin(seller?.geoSource) })}
                      inBag={isInBag(p.id)}
                      bagged={bagCounts[p.id]?.baggedCount || 0}
                      isMine={p.sellerId === userId}
                      onOpen={() => {
                        track('product_viewed', userId, detectSource(), {
                          productId: p.id,
                          productName: p.name,
                          sellerSlug: p.sellerSlug,
                          distanceKm: p.distanceKm,
                        })
                        navigate(`/store/${p.sellerSlug}`)
                      }}
                      onPreview={() => {
                        const imgs = productImages(p)
                        if (imgs.length > 0) setPreview({ images: imgs, index: 0 })
                      }}
                      onToggleBag={() => handleToggleBag(p)}
                      onMessage={() => setMessageProduct(p)}
                      onOrder={() => setOrderProduct(p)}
                    />
                  )
                })}
              </div>
            )}

            {/* Stores near you — kept below the products */}
            {nearbySellers.length > 0 && (
              <div style={{ marginTop: '28px' }}>
                <h2 style={{ margin: '0 0 10px', fontSize: '15px', fontWeight: '800', color: '#fff' }}>Stores near you</h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {nearbySellers.slice(0, STORE_ROW_LIMIT).map(s => (
                    <div key={s.id} onClick={() => navigate(`/store/${s.slug}`)}
                      style={{ display: 'flex', alignItems: 'center', gap: '12px', background: '#1a1a1a', borderRadius: '12px', padding: '14px', border: '1px solid #222', cursor: 'pointer' }}>
                      {s.logoUrl ? (
                        <img src={s.logoUrl} alt={s.businessName} style={{ width: 48, height: 48, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                      ) : (
                        <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#333', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 18, flexShrink: 0 }}>
                          {(s.businessName || 'S').charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ margin: '0 0 2px', fontWeight: '700', fontSize: '15px', color: '#fff' }}>{s.businessName}</p>
                        <p style={{ margin: 0, color: '#888', fontSize: '12px' }}>
                          📍 {placeLabel(s.place) || s.location || 'Location not set'}
                        </p>
                      </div>
                      <div style={{ background: '#12210d', border: `1px solid ${green}`, color: green, borderRadius: '999px', padding: '4px 10px', fontSize: '12px', fontWeight: '800', whiteSpace: 'nowrap' }}>
                        {formatDistance(s.distanceKm || 0, { approximate: isApproximatePin(s.geoSource) })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!loadingSellers && withoutLocation.length > 0 && (
              <p style={{ margin: '18px 0 0', color: '#555', fontSize: '12px', textAlign: 'center' }}>
                {withoutLocation.length} seller{withoutLocation.length === 1 ? '' : 's'} haven't added a location yet, so their products can't show up here.
              </p>
            )}
          </>
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

