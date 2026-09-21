import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { auth, db } from './firebase'
import { doc, getDoc, updateDoc } from 'firebase/firestore'
import { COUNTRIES } from './countries'
import { COUNTRY_CODES, type CountryCode } from './countryCodes'
import { notify } from './notifications'
import ConfirmDialog from './ConfirmDialog'
import StoreLogoPicker from './StoreLogoPicker'
import {
  placeLabel,
  resolveSellerLocation,
  reverseGeocode,
  type GeoPoint,
  type GeoSource,
  type Place,
} from './place'

function EditStore() {
  const originalNameRef = useRef('')
  const aliasesRef = useRef<string[]>([])
  const [businessName, setBusinessName] = useState('')
  const [bio, setBio] = useState('')
  const [whatsapp, setWhatsapp] = useState('')
  const [selectedCountry, setSelectedCountry] = useState<CountryCode>(() =>
    COUNTRY_CODES.find(c => c.dialCode === '+256') || COUNTRY_CODES[0]
  )
  const [whatsappCountrySearch, setWhatsappCountrySearch] = useState('')
  const [showWhatsappCountryDropdown, setShowWhatsappCountryDropdown] = useState(false)
  const [email, setEmail] = useState('')
  const [instagram, setInstagram] = useState('')
  const [tiktok, setTiktok] = useState('')
  const [showWhatsapp, setShowWhatsapp] = useState(true)
  const [logoUrl, setLogoUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [confirmSignOut, setConfirmSignOut] = useState(false)

  // Location
  const [location, setLocation] = useState('')
  const [geo, setGeo] = useState<GeoPoint | null>(null)
  const [place, setPlace] = useState<Place | null>(null)
  const [geoSource, setGeoSource] = useState<GeoSource | null>(null)
  const [locationLoading, setLocationLoading] = useState(false)

  // Nationality
  const [nationality, setNationality] = useState('')
  const [nationalitySearch, setNationalitySearch] = useState('')
  const [showCountryDropdown, setShowCountryDropdown] = useState(false)

  const navigate = useNavigate()

  // Strip '+'/dashes from a dial code (e.g. '+1-684' -> '1684') for storage & matching
  const dialStripped = (c: CountryCode) => c.dialCode.replace(/[^+\d]/g, '')
  const getStoredFullNumber = () => (whatsapp ? `${dialStripped(selectedCountry)}${whatsapp}` : '')

  useEffect(() => {
    const load = async () => {
      const user = auth.currentUser
      if (!user) { navigate('/'); return }
      try {
        const docRef = doc(db, 'sellers', user.uid)
        const snap = await getDoc(docRef)
        if (snap.exists()) {
          const data = snap.data() as any
          originalNameRef.current = data.businessName || ''
          aliasesRef.current = Array.isArray(data.aliases) ? data.aliases.filter((a: unknown) => typeof a === 'string') : []
          setBusinessName(data.businessName || '')
          setBio(data.bio || '')
          const stored = (data.whatsapp || '').replace(/^0/, '')
          const country = [...COUNTRY_CODES].sort((a, b) => dialStripped(b).length - dialStripped(a).length)
            .find(c => stored.startsWith(dialStripped(c)))
            || COUNTRY_CODES.find(c => c.dialCode === '+256')
            || COUNTRY_CODES[0]
          setSelectedCountry(country)
          setWhatsapp(stored.slice(dialStripped(country).length))
          setEmail(data.email || '')
          setInstagram((data.instagram || '').replace(/^@+/, ''))
          setTiktok((data.tiktok || '').replace(/^@+/, ''))
          setLogoUrl(data.logoUrl || '')
          setNationality(data.nationality || '')
          setShowWhatsapp(data.showWhatsapp !== false)
          setLocation(data.location || '')
          setGeo(data.geo || null)
          setPlace(data.place || null)
          setGeoSource(data.geoSource || (data.geo ? 'gps' : null))
        }
      } catch (err) {
        console.error('Load store failed', err)
      }
    }
    load()
  }, [navigate])

  // -- Geolocation --
  const handleUseMyLocation = () => {
    if (!navigator.geolocation) {
      alert(notify.geolocationUnavailable)
      return
    }
    setLocationLoading(true)
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const point = { lat: position.coords.latitude, lng: position.coords.longitude }
        setGeo(point) // exact pin for the Nearby feature
        setGeoSource('gps')
        // Keep the whole place (city *and* area) — that's what gives "Kampala, Nakawa".
        const hit = await reverseGeocode(point)
        if (hit) {
          setPlace(hit.place)
          setLocation(placeLabel(hit.place) || hit.label)
        } else {
          setLocation(`${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}`)
        }
        setLocationLoading(false)
      },
      (err) => {
        console.error('Geolocation error:', err)
        setLocationLoading(false)
        alert(err.code === 1 ? notify.geolocationDenied : notify.geolocationUnavailable)
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
    )
  }

  // Filter countries for dropdown
  const filteredCountries = nationalitySearch
    ? COUNTRIES.filter(c => c.toLowerCase().includes(nationalitySearch.toLowerCase()))
    : COUNTRIES

  const handleSave = async () => {
    const user = auth.currentUser
    if (!user) { navigate('/'); return }
    setLoading(true)
    try {
      // The photo is cropped and uploaded the moment it is picked (StoreLogoPicker), so
      // there is nothing left to process here — just the URL the seller already saw.
      const finalLogoUrl = logoUrl.trim()

      const fullNumber = getStoredFullNumber()
      // Typed an area but never dropped a pin? Geocode it so the store can still
      // show up on Nearby (with an honestly-labelled approximate distance).
      const resolved = await resolveSellerLocation({ locationText: location, geo, place, geoSource })
      const updates: Record<string, any> = {
        businessName: businessName.trim(),
        bio: bio.trim(),
        whatsapp: fullNumber,
        email: email.trim(),
        instagram: instagram.trim().replace(/^@+/, ''),
        tiktok: tiktok.trim().replace(/^@+/, ''),
        logoUrl: finalLogoUrl,
        nationality: nationality.trim(),
        location: resolved.label || location.trim(),
        geo: resolved.geo,
        place: resolved.place,
        geoSource: resolved.geoSource,
        showWhatsapp,
      }
      // Remember the old name so buyers searching it still find the store under its new name.
      if (originalNameRef.current && businessName.trim() !== originalNameRef.current && !aliasesRef.current.includes(originalNameRef.current)) {
        updates.aliases = [...aliasesRef.current, originalNameRef.current].slice(-8)
      }

      await updateDoc(doc(db, 'sellers', user.uid), updates)
      navigate('/dashboard')
    } catch (err) {
      console.error('Save failed', err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ padding: 20 }}>
      <h2>Edit Store</h2>
      <div style={{ maxWidth: 480 }}>
        <label>Business name</label>
        <input value={businessName} onChange={e => setBusinessName(e.target.value)} style={{ width: '100%', padding: 8, marginBottom: 8 }} />

        <label>Bio</label>
        <textarea value={bio} onChange={e => setBio(e.target.value)} rows={3} style={{ width: '100%', padding: 8, marginBottom: 8 }} />

        <label>WhatsApp number</label>
        <div style={{ display: 'flex', alignItems: 'center', border: '1px solid #ccc', borderRadius: 4, overflow: 'visible', marginBottom: 8, position: 'relative' }}>
          <div onClick={() => setShowWhatsappCountryDropdown(!showWhatsappCountryDropdown)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#f5f5f5', padding: '8px 10px', borderRight: '1px solid #ccc', cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap' }}>
            <span>{selectedCountry.flag} {selectedCountry.dialCode}</span>
            <span style={{ color: '#999', fontSize: 10 }}>{showWhatsappCountryDropdown ? '▲' : '▼'}</span>
          </div>
          {showWhatsappCountryDropdown && (
            <div style={{ position: 'absolute', top: '100%', left: 0, background: '#fff', border: '1px solid #ccc', borderRadius: 4, maxHeight: 220, overflow: 'auto', zIndex: 20, boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
              <input value={whatsappCountrySearch} onChange={e => setWhatsappCountrySearch(e.target.value)} placeholder="Search country..." autoFocus
                style={{ width: '100%', padding: '8px 10px', border: 'none', borderBottom: '1px solid #eee', fontSize: 13, boxSizing: 'border-box', outline: 'none' }} />
              {COUNTRY_CODES.filter(c => !whatsappCountrySearch || c.name.toLowerCase().includes(whatsappCountrySearch.toLowerCase()) || c.dialCode.includes(whatsappCountrySearch)).map(c => (
                <div key={c.dialCode} onClick={() => { setSelectedCountry(c); setShowWhatsappCountryDropdown(false); setWhatsappCountrySearch('') }}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', cursor: 'pointer', fontSize: 13 }}>
                  <span>{c.flag}</span>
                  <span style={{ flex: 1 }}>{c.name}</span>
                  <span style={{ color: '#999' }}>{c.dialCode}</span>
                </div>
              ))}
            </div>
          )}
          <input value={whatsapp} onChange={e => setWhatsapp(e.target.value.replace(/\D/g, '').slice(0, 14))} placeholder="your number"
            style={{ flex: 1, padding: 8, border: 'none', outline: 'none', fontSize: 14 }} />
        </div>

        <label>Email (optional)</label>
        <input value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" style={{ width: '100%', padding: 8, marginBottom: 8 }} />

        <label>Instagram username</label>
        <input value={instagram} onChange={e => setInstagram(e.target.value.replace(/^@+/, ''))} placeholder="yourhandle" style={{ width: '100%', padding: 8, marginBottom: 8 }} />

        <label>TikTok username</label>
        <input value={tiktok} onChange={e => setTiktok(e.target.value.replace(/^@+/, ''))} placeholder="yourhandle" style={{ width: '100%', padding: 8, marginBottom: 8 }} />

        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', cursor: 'pointer', fontSize: '13px', color: '#333' }}>
          <input type="checkbox" checked={showWhatsapp} onChange={e => { setShowWhatsapp(e.target.checked); (e.target as HTMLInputElement).style.accentColor = '' }} style={{ cursor: 'pointer' }} />
          Show my WhatsApp on my store (buyers can reach me directly via WhatsApp)
        </label>

        {/* Nationality Dropdown */}
        <label>Nationality</label>
        <p style={{ fontSize: '12px', color: '#666', margin: '4px 0 4px' }}>Your country of citizenship</p>
        <div style={{ position: 'relative', marginBottom: '8px' }}>
          <div
            onClick={() => setShowCountryDropdown(!showCountryDropdown)}
            style={{ width: '100%', padding: '10px 12px', borderRadius: '6px', border: '1px solid #ddd', fontSize: '14px', boxSizing: 'border-box', background: '#fff', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: nationality ? '#333' : '#999' }}>{nationality || 'Select your country'}</span>
            <span style={{ color: '#999', fontSize: '12px' }}>{showCountryDropdown ? '▲' : '▼'}</span>
          </div>
          {showCountryDropdown && (
            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid #ddd', borderRadius: '6px', maxHeight: '200px', overflow: 'hidden', zIndex: 10, boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
              <input
                value={nationalitySearch}
                onChange={e => setNationalitySearch(e.target.value)}
                placeholder="Search countries..."
                autoFocus
                style={{ width: '100%', padding: '8px 10px', border: 'none', borderBottom: '1px solid #eee', fontSize: '13px', boxSizing: 'border-box', outline: 'none' }}
              />
              <div style={{ maxHeight: '160px', overflowY: 'auto' }}>
                {filteredCountries.map(country => (
                  <div
                    key={country}
                    onClick={() => {
                      setNationality(country)
                      setNationalitySearch('')
                      setShowCountryDropdown(false)
                    }}
                    style={{
                      padding: '8px 10px',
                      cursor: 'pointer',
                      fontSize: '13px',
                      color: '#333',
                      background: nationality === country ? '#f0f0f0' : '#fff',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#f5f5f5')}
                    onMouseLeave={e => (e.currentTarget.style.background = nationality === country ? '#f0f0f0' : '#fff')}
                  >
                    {country}
                  </div>
                ))}
                {filteredCountries.length === 0 && (
                  <div style={{ padding: '10px', color: '#999', fontSize: '13px', textAlign: 'center' }}>No countries found</div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Location */}
        <label>Location</label>
        <p style={{ fontSize: '12px', color: '#666', margin: '4px 0 4px' }}>Your city or district — helps buyers find you. Type manually or use auto-detect.</p>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
          <input value={location} onChange={e => { setLocation(e.target.value); setGeo(null); setPlace(null); setGeoSource(null) }}
            placeholder="e.g. Kampala, Uganda"
            style={{ flex: 1, padding: '10px 12px', borderRadius: '6px', border: '1px solid #ddd', fontSize: '14px', boxSizing: 'border-box' }} />
          <button onClick={handleUseMyLocation} disabled={locationLoading}
            style={{ padding: '10px 14px', background: locationLoading ? '#eee' : '#f0f0f0', color: '#333', border: '1px solid #ddd', borderRadius: '6px', cursor: locationLoading ? 'not-allowed' : 'pointer', fontSize: '14px', whiteSpace: 'nowrap' }}>
            {locationLoading ? '⏳' : '📍 Detect'}
          </button>
        </div>
        {locationLoading && <p style={{ fontSize: '12px', color: '#888', margin: '0 0 8px' }}>Detecting your location…</p>}
        {!locationLoading && geoSource === 'gps' && <p style={{ fontSize: '12px', color: '#2e7d32', fontWeight: '700', margin: '0 0 8px' }}>✓ Exact pin saved — buyers nearby will see how far you are.</p>}
        {!locationLoading && geoSource !== 'gps' && !!location.trim() && <p style={{ fontSize: '12px', color: '#888', margin: '0 0 8px' }}>📍 We'll place your store using this area (approximate). Tap Detect for an exact pin.</p>}

        {/* Identity checks aren't live yet — say so instead of asking for a document
            nobody can review. */}
        <div style={{ background: '#f5f5f5', border: '1px dashed #ddd', borderRadius: '8px', padding: '12px', marginBottom: '8px' }}>
          <p style={{ fontSize: '12px', fontWeight: '800', color: '#999', letterSpacing: '0.4px', margin: '0 0 6px' }}>COMING SOON</p>
          <p style={{ fontSize: '13px', color: '#666', margin: 0, lineHeight: 1.55 }}>
            <strong style={{ color: '#333' }}>🪪 Verified badge</strong> — send us your National ID and get a ✓ on your shop.
            It isn't open yet, so there's nothing to do here today.
          </p>
        </div>

        <label>Shop photo (optional)</label>
        <div style={{ marginBottom: 12 }}>
          <StoreLogoPicker
            businessName={businessName}
            value={logoUrl}
            source="edit"
            onChange={setLogoUrl}
            compact
          />
        </div>

        <button onClick={handleSave} disabled={loading} style={{ padding: 10 }}>
          {loading ? 'Saving...' : 'Save'}
        </button>

        <button onClick={() => setConfirmSignOut(true)}
          style={{ width: '100%', padding: '10px', marginTop: '16px', background: '#ff4444', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: '600', cursor: 'pointer', fontSize: '14px' }}>
          Sign Out
        </button>

        <ConfirmDialog
          open={confirmSignOut}
          title="Sign out of rachett?"
          message="You'll need to sign in again to manage your store. Are you sure you want to leave?"
          confirmLabel="Sign out"
          cancelLabel="Stay signed in"
          onConfirm={async () => {
            setConfirmSignOut(false)
            try {
              await auth.signOut()
              window.location.href = '/'
            } catch (err) {
              console.error('Sign out failed:', err)
              alert('Could not sign out. Try again.')
            }
          }}
          onClose={() => setConfirmSignOut(false)}
        />
      </div>
    </div>
  )
}

export default EditStore