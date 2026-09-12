import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, getDocs } from 'firebase/firestore'
import { db, auth } from './firebase'
import { haversineKm } from './geo'
import { formatDistance, isApproximatePin, placeLabel, type GeoSource, type Place } from './place'
import { useBuyerLocation } from './useBuyerLocation'

const green = '#adff2f'

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

const RADII = [5, 10, 25]

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
  const [radius, setRadius] = useState(10)
  const [loadError, setLoadError] = useState('')
  const [allSellers, setAllSellers] = useState<NearbySeller[]>([])
  const [loadingSellers, setLoadingSellers] = useState(true)

  // Load every seller once (sellers don't see their own store here).
  // The buyer's location is never written anywhere — it stays on their device.
  useEffect(() => {
    let cancelled = false
    getDocs(collection(db, 'sellers'))
      .then(snap => {
        if (cancelled) return
        const uid = auth.currentUser?.uid
        const list = snap.docs
          .map(d => ({ id: d.id, ...(d.data() as Omit<NearbySeller, 'id'>) }))
          .filter(s => s.id !== uid)
        setAllSellers(list)
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

  const withPin = useMemo(
    () =>
      allSellers.filter(
        s => s.geo && typeof s.geo.lat === 'number' && typeof s.geo.lng === 'number',
      ),
    [allSellers],
  )
  const withoutPin = useMemo(() => allSellers.filter(s => !s.geo), [allSellers])

  const nearby = useMemo(() => {
    if (!area) return []
    return withPin
      .map(s => ({ ...s, distanceKm: haversineKm(area.lat, area.lng, s.geo!.lat, s.geo!.lng) }))
      .filter(s => (s.distanceKm || 0) <= radius)
      .sort((a, b) => (a.distanceKm || 0) - (b.distanceKm || 0))
  }, [area, radius, withPin])

  const locating = status === 'locating'
  const error = locationError || loadError
  const widerRadius = RADII.find(r => r > radius) || 25

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f0f', fontFamily: 'sans-serif', color: '#fff', padding: '20px' }}>
      <div style={{ maxWidth: '680px', margin: '0 auto' }}>
        <h1 style={{ margin: '0 0 4px', fontSize: '22px', fontWeight: '800' }}>📍 Sellers near you</h1>
        <p style={{ margin: '0 0 16px', color: '#888', fontSize: '13px' }}>
          Find trusted sellers close by — your order won't travel far.
        </p>

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
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px', flexWrap: 'wrap' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#12210d', border: `1px solid ${green}`, color: green, borderRadius: '999px', padding: '6px 12px', fontSize: '13px', fontWeight: '700' }}>
                📍 {areaLabel || 'Your area'}
              </span>
              <button onClick={() => { clear(); setManualText('') }}
                style={{ padding: '8px 12px', borderRadius: '999px', border: '1px solid #333', background: 'transparent', color: '#888', cursor: 'pointer', fontSize: '12px' }}>
                Change location
              </button>
            </div>

            <div style={{ display: 'flex', gap: '8px', marginBottom: '10px', flexWrap: 'wrap' }}>
              {RADII.map(r => (
                <button key={r} onClick={() => setRadius(r)}
                  style={{ padding: '8px 16px', borderRadius: '999px', border: `1px solid ${radius === r ? green : '#333'}`, background: radius === r ? '#1a2a1a' : '#1a1a1a', color: radius === r ? green : '#aaa', fontWeight: '700', fontSize: '13px', cursor: 'pointer' }}>
                  {r} km
                </button>
              ))}
            </div>

            {loadingSellers ? (
              <p style={{ color: '#666', fontSize: '13px' }}>Finding sellers…</p>
            ) : (
              <p style={{ margin: '0 0 14px', color: '#888', fontSize: '12px' }}>
                {nearby.length} seller{nearby.length === 1 ? '' : 's'} within {radius} km
              </p>
            )}

            {!loadingSellers && nearby.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '48px 20px', border: '1px dashed #222', borderRadius: '12px' }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>🗺️</div>
                <p style={{ color: '#888', fontSize: '14px', margin: '0 0 4px' }}>No sellers within {radius} km yet.</p>
                <p style={{ color: '#555', fontSize: '12px', margin: '0 0 16px' }}>Try a wider radius, or check back soon.</p>
                {radius < 25 && (
                  <button onClick={() => setRadius(widerRadius)}
                    style={{ padding: '10px 18px', background: green, color: '#000', border: 'none', borderRadius: '10px', fontWeight: '800', cursor: 'pointer', fontSize: '14px' }}>
                    Widen to {widerRadius} km
                  </button>
                )}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {nearby.map(s => (
                  <div key={s.id} onClick={() => navigate(`/store/${s.slug}`)}
                    style={{ display: 'flex', alignItems: 'center', gap: '12px', background: '#1a1a1a', borderRadius: '12px', padding: '14px', border: '1px solid #222', cursor: 'pointer' }}>
                    {s.logoUrl ? (
                      <img src={s.logoUrl} alt={s.businessName} style={{ width: 52, height: 52, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                    ) : (
                      <div style={{ width: 52, height: 52, borderRadius: '50%', background: '#333', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 20, flexShrink: 0 }}>
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
            )}

            {!loadingSellers && withoutPin.length > 0 && (
              <p style={{ margin: '18px 0 0', color: '#555', fontSize: '12px', textAlign: 'center' }}>
                {withoutPin.length} seller{withoutPin.length === 1 ? '' : 's'} haven't added a location yet, so we can't sort them by distance.
              </p>
            )}
          </>
        )}

        {error && <p style={{ color: '#ff4444', fontSize: '13px', marginTop: '12px' }}>{error}</p>}
      </div>
    </div>
  )
}

export default NearbyPage
