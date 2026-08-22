import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, getDocs } from 'firebase/firestore'
import { db, auth } from './firebase'
import { haversineKm } from './geo'

const green = '#adff2f'

interface NearbySeller {
  id: string
  businessName: string
  slug: string
  logoUrl?: string
  location?: string
  geo?: { lat: number; lng: number }
  distanceKm?: number
}

const RADII = [5, 10, 25]

function NearbyPage() {
  const navigate = useNavigate()
  const [myLocation, setMyLocation] = useState<{ lat: number; lng: number } | null>(null)
  const [manualText, setManualText] = useState('')
  const [detecting, setDetecting] = useState(false)
  const [loading, setLoading] = useState(false)
  const [radius, setRadius] = useState(10)
  const [error, setError] = useState('')
  const [sellers, setSellers] = useState<NearbySeller[]>([])
  const [allSellers, setAllSellers] = useState<NearbySeller[]>([])

  // Load all sellers that have coordinates (buyer location is never stored)
  useEffect(() => {
    let cancelled = false
    getDocs(collection(db, 'sellers'))
      .then(snap => {
        if (cancelled) return
        const list = snap.docs
          .map(d => ({ id: d.id, ...(d.data() as Omit<NearbySeller, 'id'>) }))
          .filter(s => s.geo && typeof s.geo.lat === 'number' && typeof s.geo.lng === 'number')
        setAllSellers(list)
      })
      .catch(err => {
        if (!cancelled) { console.error('Nearby load error:', err); setError('Could not load sellers. Try again.') }
      })
    return () => { cancelled = true }
  }, [])

  // Compute nearby list whenever location or radius changes
  useEffect(() => {
    if (!myLocation) { setSellers([]); return }
    const uid = auth.currentUser?.uid
    const list = allSellers
      .filter(s => s.id !== uid) // sellers don't see their own store here
      .map(s => ({ ...s, distanceKm: haversineKm(myLocation.lat, myLocation.lng, s.geo!.lat, s.geo!.lng) }))
      .filter(s => (s.distanceKm || 0) <= radius)
      .sort((a, b) => (a.distanceKm || 0) - (b.distanceKm || 0))
    setSellers(list)
  }, [myLocation, radius, allSellers])

  const detectLocation = () => {
    if (!navigator.geolocation) { setError('Geolocation not supported in your browser. Type your area instead.'); return }
    setDetecting(true); setError('')
    navigator.geolocation.getCurrentPosition(
      (pos) => { setMyLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setDetecting(false) },
      (err) => {
        setDetecting(false)
        setError(err.code === 1
          ? 'Location access denied. Enable it in your browser settings (iPhone: Settings → Safari → Location), then try again.'
          : 'Could not get your location. Type your area instead.')
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
    )
  }

  const useManualLocation = async () => {
    const q = manualText.trim()
    if (!q) { setError('Enter a city or area first.'); return }
    setLoading(true); setError('')
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=1`)
      const data = await res.json()
      if (data && data[0]) {
        setMyLocation({ lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) })
      } else {
        setError('Could not find that place. Try "Kampala, Uganda".')
      }
    } catch {
      setError('Could not reach the location service. Check your connection.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f0f', fontFamily: 'sans-serif', color: '#fff', padding: '20px' }}>
      <div style={{ maxWidth: '640px', margin: '0 auto' }}>
        <h1 style={{ margin: '0 0 4px', fontSize: '22px', fontWeight: '800' }}>📍 Sellers near you</h1>
        <p style={{ margin: '0 0 20px', color: '#888', fontSize: '13px' }}>Find trusted sellers close by — your order won't travel far.</p>

        {!myLocation ? (
          <div style={{ background: '#1a1a1a', borderRadius: '12px', padding: '16px', border: '1px solid #222', marginBottom: '16px' }}>
            <button onClick={detectLocation} disabled={detecting}
              style={{ width: '100%', padding: '14px', background: detecting ? '#333' : green, color: detecting ? '#888' : '#000', border: 'none', borderRadius: '10px', fontWeight: '800', cursor: detecting ? 'not-allowed' : 'pointer', fontSize: '15px', marginBottom: '12px' }}>
              {detecting ? '⏳ Locating…' : '📍 Use my location'}
            </button>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input value={manualText} onChange={e => setManualText(e.target.value)} placeholder="Or type your area e.g. Kampala"
                style={{ flex: 1, padding: '12px', borderRadius: '10px', border: '1px solid #333', background: '#111', color: '#fff', fontSize: '14px', boxSizing: 'border-box' }} />
              <button onClick={useManualLocation} disabled={loading}
                style={{ padding: '12px 16px', background: '#222', color: '#fff', border: '1px solid #333', borderRadius: '10px', cursor: loading ? 'not-allowed' : 'pointer', fontWeight: '700', fontSize: '13px', whiteSpace: 'nowrap' }}>
                {loading ? '…' : 'Find'}
              </button>
            </div>
            <p style={{ margin: '10px 0 0', color: '#555', fontSize: '11px' }}>Your location is used only on this screen — never saved.</p>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
              {RADII.map(r => (
                <button key={r} onClick={() => setRadius(r)}
                  style={{ padding: '8px 16px', borderRadius: '999px', border: `1px solid ${radius === r ? green : '#333'}`, background: radius === r ? '#1a2a1a' : '#1a1a1a', color: radius === r ? green : '#aaa', fontWeight: '700', fontSize: '13px', cursor: 'pointer' }}>
                  {r} km
                </button>
              ))}
              <button onClick={() => setMyLocation(null)} style={{ marginLeft: 'auto', padding: '8px 12px', borderRadius: '999px', border: '1px solid #333', background: 'transparent', color: '#888', cursor: 'pointer', fontSize: '12px' }}>Change location</button>
            </div>

            {sellers.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px 20px', border: '1px dashed #222', borderRadius: '12px' }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>🗺️</div>
                <p style={{ color: '#888', fontSize: '14px' }}>No sellers within {radius} km yet.</p>
                <p style={{ color: '#555', fontSize: '12px' }}>Try a wider radius, or check back soon.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {sellers.map(s => (
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
                      <p style={{ margin: 0, color: '#888', fontSize: '12px' }}>{s.location || 'Location set'}</p>
                    </div>
                    <div style={{ background: '#12210d', border: `1px solid ${green}`, color: green, borderRadius: '999px', padding: '4px 10px', fontSize: '12px', fontWeight: '800', whiteSpace: 'nowrap' }}>
                      📍 {s.distanceKm!.toFixed(1)} km
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {error && <p style={{ color: '#ff4444', fontSize: '13px', marginTop: '12px' }}>{error}</p>}
      </div>
    </div>
  )
}

export default NearbyPage
