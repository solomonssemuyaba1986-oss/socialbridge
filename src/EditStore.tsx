import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { auth, db, storage } from './firebase'
import { doc, getDoc, updateDoc } from 'firebase/firestore'
import { ref, uploadBytes } from 'firebase/storage'
import { COUNTRIES } from './countries'
import { notify } from './notifications'

function EditStore() {
  const [businessName, setBusinessName] = useState('')
  const [bio, setBio] = useState('')
  const [whatsapp, setWhatsapp] = useState('')
  const [email, setEmail] = useState('')
  const [instagram, setInstagram] = useState('')
  const [tiktok, setTiktok] = useState('')
  const [showWhatsapp, setShowWhatsapp] = useState(true)
  const [logoUrl, setLogoUrl] = useState('')
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)

  // Location
  const [location, setLocation] = useState('')
  const [locationLoading, setLocationLoading] = useState(false)

  // Nationality
  const [nationality, setNationality] = useState('')
  const [nationalitySearch, setNationalitySearch] = useState('')
  const [showCountryDropdown, setShowCountryDropdown] = useState(false)

  // National ID
  const [idFileName, setIdFileName] = useState('')
  const [idFile, setIdFile] = useState<File | null>(null)
  const [uploadingId, setUploadingId] = useState(false)

  const navigate = useNavigate()

  useEffect(() => {
    const load = async () => {
      const user = auth.currentUser
      if (!user) { navigate('/'); return }
      try {
        const docRef = doc(db, 'sellers', user.uid)
        const snap = await getDoc(docRef)
        if (snap.exists()) {
          const data = snap.data() as any
          setBusinessName(data.businessName || '')
          setBio(data.bio || '')
          setWhatsapp((data.whatsapp || '').replace(/^256/, ''))
          setEmail(data.email || '')
          setInstagram((data.instagram || '').replace(/^@+/, ''))
          setTiktok((data.tiktok || '').replace(/^@+/, ''))
          setLogoUrl(data.logoUrl || '')
          setNationality(data.nationality || '')
          setShowWhatsapp(data.showWhatsapp !== false)
          setLocation(data.location || '')
          if (data.idDocumentPath) {
            // Extract filename from path
            const parts = data.idDocumentPath.split('/')
            setIdFileName(parts[parts.length - 1] || 'national-id')
          }
        }
      } catch (err) {
        console.error('Load store failed', err)
      }
    }
    load()
  }, [navigate])

  const handleFile = (f?: File | null) => {
    if (!f) { setLogoFile(null); setLogoUrl(''); return }
    setLogoFile(f)
    setLogoUrl(URL.createObjectURL(f))
  }

  // -- National ID upload --
  const handleIdFileChange = (file: File | null) => {
    if (!file) {
      setIdFile(null)
      setIdFileName('')
      return
    }
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
    if (!allowedTypes.includes(file.type)) {
      alert(notify.fileTypeInvalid)
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      alert(notify.fileTooLarge)
      return
    }
    setIdFile(file)
    setIdFileName(file.name)
  }

  // -- Geolocation --
  const handleUseMyLocation = () => {
    if (!navigator.geolocation) {
      alert(notify.geolocationUnavailable)
      return
    }
    setLocationLoading(true)
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`
          )
          const data = await res.json()
          if (data && data.display_name) {
            const city = data.address?.city || data.address?.town || data.address?.county || data.address?.state_district || ''
            const country = data.address?.country || ''
            const fallback = data.display_name.split(',')[0]?.trim() || ''
            const result = [city, country].filter(Boolean).join(', ')
            setLocation(result || fallback)
          } else {
            setLocation(`${latitude.toFixed(4)}, ${longitude.toFixed(4)}`)
          }
        } catch {
          setLocation(`${latitude.toFixed(4)}, ${longitude.toFixed(4)}`)
        } finally {
          setLocationLoading(false)
        }
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
      let finalLogoUrl = logoUrl || ''
      if (logoFile) {
        try {
          const resizeImage = (file: File, maxWidth = 1024, quality = 0.8): Promise<Blob> => {
            return new Promise((resolve, reject) => {
              const img = new Image()
              img.onload = () => {
                try {
                  const scale = Math.min(1, maxWidth / img.width)
                  const w = Math.round(img.width * scale)
                  const h = Math.round(img.height * scale)
                  const canvas = document.createElement('canvas')
                  canvas.width = w
                  canvas.height = h
                  const ctx = canvas.getContext('2d')!
                  ctx.drawImage(img, 0, 0, w, h)
                  canvas.toBlob((blob) => {
                    if (blob) resolve(blob)
                    else reject(new Error('Image resize failed'))
                  }, 'image/jpeg', quality)
                } catch (err) {
                  reject(err)
                }
              }
              img.onerror = (e) => reject(e)
              img.src = URL.createObjectURL(file)
            })
          }

          const processedBlob = await resizeImage(logoFile, 1024, 0.8)
          const processedFile = new File([processedBlob], 'logo.jpg', { type: 'image/jpeg' })
          const formData = new FormData()
          formData.append('file', processedFile)
          formData.append('upload_preset', 'p2z65zrv')
          const res = await fetch('https://api.cloudinary.com/v1_1/dzudmmuxg/image/upload', { method: 'POST', body: formData })
          const cloudData = await res.json()
          finalLogoUrl = cloudData.secure_url
        } catch (err) {
          console.error('Logo upload failed', err)
        }
      }

      // Upload National ID to Firebase Storage (private)
      let idDocumentPath: string | undefined
      if (idFile) {
        setUploadingId(true)
        try {
          const ext = idFile.name.split('.').pop() || 'jpg'
          const storageRef = ref(storage, `sellers/${user.uid}/private/national-id.${ext}`)
          const snapshot = await uploadBytes(storageRef, idFile)
          idDocumentPath = snapshot.ref.fullPath
        } catch (err) {
          console.error('ID upload error', err)
        } finally {
          setUploadingId(false)
        }
      }

      const fullNumber = whatsapp ? `256${whatsapp}` : ''
      const updates: Record<string, any> = {
        businessName: businessName.trim(),
        bio: bio.trim(),
        whatsapp: fullNumber,
        email: email.trim(),
        instagram: instagram.trim().replace(/^@+/, ''),
        tiktok: tiktok.trim().replace(/^@+/, ''),
        logoUrl: finalLogoUrl,
        nationality: nationality.trim(),
        location: location.trim(),
        showWhatsapp,
      }
      if (idDocumentPath) {
        updates.idDocumentPath = idDocumentPath
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

        <label>WhatsApp (local)</label>
        <input value={whatsapp} onChange={e => setWhatsapp(e.target.value.replace(/\D/g, '').slice(0,9))} placeholder="771234567" style={{ width: '100%', padding: 8, marginBottom: 8 }} />

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
          <input value={location} onChange={e => setLocation(e.target.value)}
            placeholder="e.g. Kampala, Uganda"
            style={{ flex: 1, padding: '10px 12px', borderRadius: '6px', border: '1px solid #ddd', fontSize: '14px', boxSizing: 'border-box' }} />
          <button onClick={handleUseMyLocation} disabled={locationLoading}
            style={{ padding: '10px 14px', background: locationLoading ? '#eee' : '#f0f0f0', color: '#333', border: '1px solid #ddd', borderRadius: '6px', cursor: locationLoading ? 'not-allowed' : 'pointer', fontSize: '14px', whiteSpace: 'nowrap' }}>
            {locationLoading ? '⏳' : '📍 Detect'}
          </button>
        </div>

        {/* National ID Upload */}
        <label>National ID</label>
        <p style={{ fontSize: '12px', color: '#666', margin: '4px 0 4px' }}>
          Photo or scan of your ID. This is <strong>private</strong> — only you can see it. JPG, PNG, or PDF — max 10MB.
        </p>
        <div style={{ marginBottom: '8px' }}>
          {!idFileName ? (
            <label style={{ display: 'block', padding: '30px 16px', border: '2px dashed #ddd', borderRadius: '6px', textAlign: 'center', cursor: 'pointer', background: '#fafafa' }}>
              <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={e => handleIdFileChange(e.target.files?.[0] || null)} style={{ display: 'none' }} />
              <span style={{ fontSize: '13px', color: '#999' }}>Click to upload your National ID</span>
            </label>
          ) : (
            <div style={{ padding: '10px 12px', background: '#f0f8f0', borderRadius: '6px', border: '1px solid #c8e6c9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '18px' }}>📎</span>
                <span style={{ fontSize: '13px', color: '#2e7d32', fontWeight: '600' }}>{idFileName}</span>
              </div>
              <button onClick={() => handleIdFileChange(null)}
                style={{ background: 'transparent', border: 'none', color: '#999', cursor: 'pointer', fontSize: '16px' }}>
                ✕
              </button>
            </div>
          )}
        </div>

        <label>Logo (optional)</label>
        <div style={{ marginBottom: 8 }}>
          <input type="file" accept="image/*" onChange={e => { if (e.target.files && e.target.files[0]) handleFile(e.target.files[0]) }} />
        </div>
        {logoUrl && (
          <div style={{ marginBottom: 8 }}>
            <img src={logoUrl} alt="logo" style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 8 }} />
          </div>
        )}

        <button onClick={handleSave} disabled={loading || uploadingId} style={{ padding: 10 }}>
          {loading || uploadingId ? 'Saving...' : 'Save'}
        </button>

        <button onClick={() => {
          if (window.confirm('Are you sure you want to sign out from Rachett?')) {
            auth.signOut()
            navigate('/')
          }
        }}
          style={{ width: '100%', padding: '10px', marginTop: '16px', background: '#ff4444', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: '600', cursor: 'pointer', fontSize: '14px' }}>
          Sign Out
        </button>
      </div>
    </div>
  )
}

export default EditStore