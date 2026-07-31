import { useState } from 'react'
import { auth, db, storage } from './firebase'
import { collection, doc, getDocs, query, setDoc, where } from 'firebase/firestore'
import { ref, uploadBytes } from 'firebase/storage'
import { useNavigate } from 'react-router-dom'
import { COUNTRIES } from './countries'

const OTP_SERVER_URL = import.meta.env.VITE_OTP_SERVER_URL || 'http://localhost:3001'

interface SetupFormErrors {
  businessName?: string
  bio?: string
  whatsapp?: string
  email?: string
  nationality?: string
  idDocument?: string
  submit?: string
}

function SetupStore() {
  const [businessName, setBusinessName] = useState('')
  const [storeHandle, setStoreHandle] = useState('')
  const [handleAvailable, setHandleAvailable] = useState<boolean | null>(null)
  const [handleChecking, setHandleChecking] = useState(false)
  const [bio, setBio] = useState('')
  const [whatsapp, setWhatsapp] = useState(
    // Pre-fill from Firebase Phone Auth if available
    auth.currentUser?.phoneNumber 
      ? auth.currentUser.phoneNumber.replace(/^\+256/, '') 
      : ''
  )
  const [email, setEmail] = useState(auth.currentUser?.email || '')
  const [instagram, setInstagram] = useState('')
  const [tiktok, setTiktok] = useState('')
  const [nationality, setNationality] = useState('')
  const [nationalitySearch, setNationalitySearch] = useState('')
  const [showCountryDropdown, setShowCountryDropdown] = useState(false)
  const [location, setLocation] = useState('')
  const [locationLoading, setLocationLoading] = useState(false)
  const [errors, setErrors] = useState<SetupFormErrors>({})
  const [loading, setLoading] = useState(false)
  const [showWhatsapp, setShowWhatsapp] = useState(true)
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [logoPreview, setLogoPreview] = useState('')
  const [uploadingLogo, setUploadingLogo] = useState(false)

  // National ID upload
  const [idFile, setIdFile] = useState<File | null>(null)
  const [idFileName, setIdFileName] = useState('')
  const [uploadingId, setUploadingId] = useState(false)

  // Phone OTP verification
  // If user signed in via Firebase Phone Auth, phone is already verified
  const [phoneVerified, setPhoneVerified] = useState(!!auth.currentUser?.phoneNumber)
  const [phoneOtpSent, setPhoneOtpSent] = useState(false)
  const [phoneOtpInput, setPhoneOtpInput] = useState('')
  const [phoneOtpLoading, setPhoneOtpLoading] = useState(false)
  const [phoneOtpError, setPhoneOtpError] = useState('')

  const navigate = useNavigate()

  const sanitizeInput = (input: string, maxLength: number = 100): string => {
    return input.trim().slice(0, maxLength).replace(/<[^>]*>/g, '')
  }

  const sanitizeHandle = (input: string): string => {
    return input.toLowerCase().trim().replace(/[^a-z0-9_-]/g, '').replace(/-+/g, '-').replace(/_+/g, '_').slice(0, 30)
  }

  // Debounced handle availability check
  let handleCheckTimer: ReturnType<typeof setTimeout> | null = null
  const checkHandleAvailability = async (handle: string) => {
    if (handle.length < 3) {
      setHandleAvailable(null)
      return
    }
    setHandleChecking(true)
    try {
      const q = query(collection(db, 'sellers'), where('slug', '==', handle))
      const snapshot = await getDocs(q)
      setHandleAvailable(snapshot.empty)
    } catch {
      setHandleAvailable(null)
    } finally {
      setHandleChecking(false)
    }
  }

  const handleHandleChange = (val: string) => {
    const cleaned = sanitizeHandle(val)
    setStoreHandle(cleaned)
    setHandleAvailable(null)
    if (handleCheckTimer) clearTimeout(handleCheckTimer)
    if (cleaned.length >= 3) {
      handleCheckTimer = setTimeout(() => checkHandleAvailability(cleaned), 500)
    }
  }

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

  // -- Phone OTP verification --
  const sendPhoneOtp = async () => {
    if (!whatsapp || whatsapp.length !== 9) {
      setPhoneOtpError('Enter a valid phone number first')
      return
    }
    setPhoneOtpLoading(true)
    setPhoneOtpError('')
    const normalized = `+256${whatsapp}`
    try {
      const res = await fetch(`${OTP_SERVER_URL}/api/otp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: normalized }),
      })
      const data = await res.json()
      if (!res.ok) {
        setPhoneOtpError(data.error || 'Failed to send OTP')
      } else {
        setPhoneOtpSent(true)
        if (data.debugOtp) {
          console.log(`[OTP Debug] Seller verification code: ${data.debugOtp}`)
        }
      }
    } catch {
      setPhoneOtpError('Network error. Check your connection.')
    } finally {
      setPhoneOtpLoading(false)
    }
  }

  const verifyPhoneOtp = async () => {
    if (!phoneOtpInput || phoneOtpInput.length < 6) {
      setPhoneOtpError('Enter the 6-digit code')
      return
    }
    const normalized = `+256${whatsapp}`
    setPhoneOtpLoading(true)
    setPhoneOtpError('')
    try {
      const res = await fetch(`${OTP_SERVER_URL}/api/otp/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: normalized, otp: phoneOtpInput }),
      })
      const data = await res.json()
      if (!res.ok) {
        setPhoneOtpError(data.error || 'Invalid code')
      } else {
        setPhoneVerified(true)
      }
    } catch {
      setPhoneOtpError('Network error. Try again.')
    } finally {
      setPhoneOtpLoading(false)
    }
  }

  // -- National ID upload --
  const handleIdFileChange = (file: File | null) => {
    if (!file) {
      setIdFile(null)
      setIdFileName('')
      setErrors(e => ({ ...e, idDocument: undefined }))
      return
    }
    // Accept images and PDFs
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
    if (!allowedTypes.includes(file.type)) {
      setErrors(e => ({ ...e, idDocument: 'Please upload a JPG, PNG, or PDF file' }))
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setErrors(e => ({ ...e, idDocument: 'File must be under 10MB' }))
      return
    }
    setIdFile(file)
    setIdFileName(file.name)
    setErrors(e => ({ ...e, idDocument: undefined }))
  }

  const validateForm = (): boolean => {
    const newErrors: SetupFormErrors = {}
    const cleanedName = sanitizeInput(businessName)
    if (!cleanedName) {
      newErrors.businessName = 'Business name is required'
    } else if (cleanedName.length < 2) {
      newErrors.businessName = 'Business name must be at least 2 characters'
    }
    const cleanedBio = sanitizeInput(bio, 500)
    if (cleanedBio.length > 500) {
      newErrors.bio = 'Bio must be 500 characters or less'
    }
    if (whatsapp.length !== 9) {
      newErrors.whatsapp = 'Enter a valid 9-digit Uganda phone number'
    } else if (!/^7\d{8}$/.test(whatsapp)) {
      newErrors.whatsapp = 'Uganda number must start with 7'
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sanitizeInput(email))) {
      newErrors.email = 'Enter a valid email address'
    }
    if (!nationality) {
      newErrors.nationality = 'Please select your nationality'
    }
    if (!phoneVerified) {
      newErrors.submit = 'Please verify your phone number before creating your store'
    }
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleWhatsappChange = (val: string) => {
    const digits = val.replace(/\D/g, '').slice(0, 9)
    setWhatsapp(digits)
    setErrors(e => ({ ...e, whatsapp: undefined }))
    // Reset OTP state when number changes
    if (digits !== whatsapp) {
      setPhoneOtpSent(false)
      setPhoneVerified(false)
      setPhoneOtpInput('')
      setPhoneOtpError('')
    }
  }

  // -- Geolocation --
  const handleUseMyLocation = () => {
    if (!navigator.geolocation) {
      setErrors(e => ({ ...e, submit: 'Geolocation not supported in your browser.' }))
      return
    }
    setLocationLoading(true)
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords
        try {
          // Reverse geocode with OpenStreetMap Nominatim (free, no key required)
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`
          )
          const data = await res.json()
          if (data && data.display_name) {
            // Extract city/district + country from the display name
            const city = data.address?.city || data.address?.town || data.address?.county || data.address?.state_district || ''
            const country = data.address?.country || ''
            const fallback = data.display_name.split(',')[0]?.trim() || ''
            const result = [city, country].filter(Boolean).join(', ')
            setLocation(result || fallback)
          } else {
            setLocation(`${latitude.toFixed(4)}, ${longitude.toFixed(4)}`)
          }
        } catch {
          // Fall back to coordinates if reverse geocoding fails
          setLocation(`${latitude.toFixed(4)}, ${longitude.toFixed(4)}`)
        } finally {
          setLocationLoading(false)
        }
      },
      (err) => {
        console.error('Geolocation error:', err)
        setLocationLoading(false)
        if (err.code === 1) {
          setErrors(e => ({ ...e, submit: 'Location access denied. Please enter your location manually.' }))
        } else {
          setErrors(e => ({ ...e, submit: 'Could not get location. Please enter manually.' }))
        }
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
    )
  }

  // Filter countries for dropdown
  const filteredCountries = nationalitySearch
    ? COUNTRIES.filter(c => c.toLowerCase().includes(nationalitySearch.toLowerCase()))
    : COUNTRIES

  const handleSubmit = async () => {
    if (!validateForm()) return
    const user = auth.currentUser
    if (!user) {
      setErrors({ submit: 'Not signed in. Please sign in again.' })
      return
    }
    setLoading(true)
    setErrors({})
    try {
      const cleanedName = sanitizeInput(businessName)
      const cleanedBio = sanitizeInput(bio, 500)
      const cleanedEmail = email ? sanitizeInput(email) : ''
      const cleanedInstagram = instagram ? sanitizeInput(instagram, 50).replace(/^@+/, '') : ''
      const cleanedTiktok = tiktok ? sanitizeInput(tiktok, 50).replace(/^@+/, '') : ''
      if (!storeHandle || storeHandle.length < 3) {
        setErrors({ submit: 'Please choose a store handle (at least 3 characters).' })
        setLoading(false)
        return
      }
      if (handleAvailable !== true) {
        setErrors({ submit: 'This store handle is already taken. Please choose another.' })
        setLoading(false)
        return
      }
      const slug = storeHandle
      const fullNumber = `256${whatsapp}`

      // Upload logo (optional)
      let finalLogoUrl = user.photoURL || ''
      if (logoFile) {
        try {
          setUploadingLogo(true)
          const processedBlob = await resizeImage(logoFile, 1024, 0.8)
          const processedFile = new File([processedBlob], 'logo.jpg', { type: 'image/jpeg' })
           const formData = new FormData()
           formData.append('file', processedFile)
           formData.append('upload_preset', 'p2z65zrv')
           const res = await fetch('https://api.cloudinary.com/v1_1/dzudmmuxg/image/upload', { method: 'POST', body: formData })
           const cloudData = await res.json()
           finalLogoUrl = cloudData.secure_url
           setUploadingLogo(false)
        } catch (err) {
          console.error('Logo upload failed', err)
        } finally {
          setUploadingLogo(false)
        }
      }

      // Upload National ID to Firebase Storage (private)
      let idDocumentPath = ''
      if (idFile) {
        setUploadingId(true)
        const ext = idFile.name.split('.').pop() || 'jpg'
        const idStorageRef = ref(storage, `sellers/${user.uid}/private/national-id.${ext}`)
        const idSnap = await uploadBytes(idStorageRef, idFile)
        idDocumentPath = idSnap.ref.fullPath
        setUploadingId(false)
      }

      // Phone-only sign-in (no email): prompt for recovery email later
      const isPhoneSignIn = !!user.phoneNumber && !user.email
      const recoveryEmail = isPhoneSignIn ? '' : (cleanedEmail || user.email || '')

      await setDoc(doc(db, 'sellers', user.uid), {
        businessName: cleanedName,
        bio: cleanedBio,
        whatsapp: fullNumber,
        logoUrl: finalLogoUrl,
        slug,
        email: cleanedEmail || user.email || '',
        instagram: cleanedInstagram,
        tiktok: cleanedTiktok,
        nationality,
        location: location.trim(),
        phoneVerified,
        showWhatsapp,
        idDocumentPath,
        idStatus: 'pending',
        recoveryEmail,
        recoveryEmailVerified: !isPhoneSignIn,
        recoveryEmailPromptCount: isPhoneSignIn ? 0 : -1,
        recoveryEmailLastPrompted: isPhoneSignIn ? null : null,
        createdAt: new Date(),
      })
      navigate('/dashboard')
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to create store'
      if ((error as any)?.code === 'permission-denied') {
        setErrors({ submit: 'Permission denied: cannot create store. Check authentication or Firestore rules.' })
      } else {
        setErrors({ submit: errorMessage })
      }
      console.error('Setup error:', error)
    } finally {
      setLoading(false)
    }
  }

  const isFormReady = businessName && bio && whatsapp.length === 9 && phoneVerified && nationality

  return (
    <div style={{ minHeight: '100vh', background: '#f9f9f9', fontFamily: 'sans-serif', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <h1 style={{ fontSize: '24px', fontWeight: '700', marginBottom: '8px' }}>Set up your store</h1>
      <p style={{ color: '#666', marginBottom: '32px' }}>Your store will be live in seconds</p>

      <div style={{ background: '#fff', borderRadius: '12px', padding: '32px', width: '100%', maxWidth: '480px', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
        {errors.submit && (
          <div style={{ background: '#fee', border: '1px solid #fcc', borderRadius: '8px', padding: '12px', marginBottom: '16px', color: '#c33', fontSize: '14px' }}>
            {errors.submit}
          </div>
        )}

        <label style={{ fontSize: '14px', fontWeight: '600', color: '#333' }}>Business Name</label>
        <input value={businessName} onChange={e => setBusinessName(e.target.value)}
          placeholder="e.g. Zara Cosmetics"
          style={{ width: '100%', padding: '12px', borderRadius: '8px', border: errors.businessName ? '2px solid #c33' : '1px solid #ddd', marginTop: '8px', marginBottom: '4px', fontSize: '15px', boxSizing: 'border-box' }} />
        {errors.businessName && <p style={{ color: '#c33', fontSize: '12px', margin: '4px 0 16px' }}>{errors.businessName}</p>}
        {!errors.businessName && <div style={{ marginBottom: '16px' }} />}

        <label style={{ fontSize: '14px', fontWeight: '600', color: '#333' }}>Store Handle</label>
        <p style={{ fontSize: '12px', color: '#888', margin: '4px 0 8px' }}>
          Choose a unique handle — like Instagram/TikTok usernames. This is your store URL: rachett.com/store/<strong style={{ color: '#333' }}>{storeHandle || 'your-handle'}</strong>
        </p>
        <div style={{ display: 'flex', alignItems: 'center', border: '1px solid #ddd', borderRadius: '8px', overflow: 'hidden', marginBottom: '4px' }}>
          <div style={{ background: '#f5f5f5', padding: '12px 14px', fontSize: '14px', borderRight: '1px solid #ddd', color: '#888', whiteSpace: 'nowrap' }}>
            rachett.com/store/
          </div>
          <input
            value={storeHandle}
            onChange={e => handleHandleChange(e.target.value)}
            placeholder="your-store-name"
            maxLength={30}
            style={{ flex: 1, padding: '12px', border: 'none', outline: 'none', fontSize: '15px', background: '#fff' }}
          />
        </div>
        {handleChecking && <p style={{ color: '#888', fontSize: '12px', margin: '4px 0 16px' }}>Checking availability...</p>}
        {!handleChecking && handleAvailable === true && (
          <p style={{ color: '#4a4', fontSize: '12px', margin: '4px 0 16px' }}>✓ Available! @{storeHandle}</p>
        )}
        {!handleChecking && handleAvailable === false && (
          <p style={{ color: '#c33', fontSize: '12px', margin: '4px 0 16px' }}>✗ Sorry, @{storeHandle} is already taken. Try another.</p>
        )}
        {!handleChecking && handleAvailable === null && storeHandle.length >= 3 && (
          <p style={{ color: '#888', fontSize: '12px', margin: '4px 0 16px' }}>Click "Create" to check availability</p>
        )}
        {storeHandle.length === 0 && <div style={{ marginBottom: '16px' }} />}

        <label style={{ fontSize: '14px', fontWeight: '600', color: '#333' }}>Bio</label>
        <textarea value={bio} onChange={e => setBio(e.target.value)}
          placeholder="Tell customers what you sell..."
          rows={3}
          style={{ width: '100%', padding: '12px', borderRadius: '8px', border: errors.bio ? '2px solid #c33' : '1px solid #ddd', marginTop: '8px', marginBottom: '4px', fontSize: '15px', boxSizing: 'border-box', resize: 'none' }} />
        {errors.bio && <p style={{ color: '#c33', fontSize: '12px', margin: '4px 0 16px' }}>{errors.bio}</p>}
        {!errors.bio && <div style={{ marginBottom: '16px' }} />}

        {/* Phone OTP Verification */}
        <label style={{ fontSize: '14px', fontWeight: '600', color: '#333' }}>WhatsApp Number</label>
        <p style={{ fontSize: '12px', color: '#888', margin: '4px 0 8px' }}>Uganda number — we add 256 automatically. You must verify this number.</p>

        <div style={{ display: 'flex', alignItems: 'center', border: errors.whatsapp ? '2px solid #c33' : '1px solid #ddd', borderRadius: '8px', overflow: 'hidden', marginBottom: '4px' }}>
          <div style={{ background: '#f5f5f5', padding: '12px 14px', fontSize: '15px', borderRight: errors.whatsapp ? '2px solid #c33' : '1px solid #ddd', color: '#333', fontWeight: '600', whiteSpace: 'nowrap' }}>
            🇺🇬 +256
          </div>
          <input
            value={whatsapp}
            onChange={e => handleWhatsappChange(e.target.value)}
            placeholder="771234567"
            maxLength={9}
            style={{ flex: 1, padding: '12px', border: 'none', outline: 'none', fontSize: '15px', background: '#fff' }}
          />
        </div>

        {errors.whatsapp && <p style={{ color: '#c33', fontSize: '12px', margin: '4px 0 8px' }}>{errors.whatsapp}</p>}

        {/* OTP Verification UI */}
        {whatsapp.length === 9 && !phoneVerified && (
          <div style={{ marginBottom: '16px', padding: '12px', background: '#f8f8f8', borderRadius: '8px', border: '1px solid #eee' }}>
            {!phoneOtpSent ? (
              <>
                <p style={{ fontSize: '13px', color: '#666', margin: '0 0 8px' }}>Verify your phone number to continue</p>
                <button onClick={sendPhoneOtp} disabled={phoneOtpLoading}
                  style={{ width: '100%', padding: '10px', background: phoneOtpLoading ? '#ccc' : '#1a1a1a', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: '600', cursor: phoneOtpLoading ? 'not-allowed' : 'pointer', fontSize: '14px' }}>
                  {phoneOtpLoading ? 'Sending...' : 'Send Verification Code'}
                </button>
              </>
            ) : (
              <>
                <p style={{ fontSize: '13px', color: '#666', margin: '0 0 8px' }}>A 6-digit code was sent to <strong>+256{whatsapp}</strong></p>
                <input
                  value={phoneOtpInput}
                  onChange={e => setPhoneOtpInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #ddd', marginBottom: '8px', fontSize: '18px', textAlign: 'center', letterSpacing: '8px', boxSizing: 'border-box' }}
                />
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={verifyPhoneOtp} disabled={phoneOtpLoading || phoneOtpInput.length < 6}
                    style={{ flex: 1, padding: '10px', background: (phoneOtpLoading || phoneOtpInput.length < 6) ? '#ccc' : '#4CAF50', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: '600', cursor: (phoneOtpLoading || phoneOtpInput.length < 6) ? 'not-allowed' : 'pointer', fontSize: '14px' }}>
                    {phoneOtpLoading ? 'Verifying...' : 'Verify Code'}
                  </button>
                  <button onClick={() => { setPhoneOtpSent(false); setPhoneOtpInput(''); setPhoneOtpError('') }}
                    style={{ padding: '10px 16px', background: 'transparent', color: '#888', border: '1px solid #ddd', borderRadius: '8px', cursor: 'pointer', fontSize: '13px' }}>
                    Resend
                  </button>
                </div>
              </>
            )}
            {phoneOtpError && <p style={{ color: '#c33', fontSize: '12px', margin: '8px 0 0' }}>{phoneOtpError}</p>}
          </div>
        )}

        {phoneVerified && (
          <div style={{ marginBottom: '16px', padding: '10px 12px', background: '#e8f5e9', borderRadius: '8px', border: '1px solid #c8e6c9', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ color: '#2e7d32', fontSize: '16px' }}>✓</span>
            <span style={{ color: '#2e7d32', fontSize: '13px', fontWeight: '600' }}>Phone verified — +256{whatsapp}</span>
          </div>
        )}

        {/* Show WhatsApp Toggle */}
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px', cursor: 'pointer', fontSize: '13px', color: '#555' }}>
          <input type="checkbox" checked={showWhatsapp} onChange={e => setShowWhatsapp(e.target.checked)} style={{ cursor: 'pointer', width: '16px', height: '16px' }} />
          Show my WhatsApp on my store (buyers can reach me directly via WhatsApp)
        </label>
        <p style={{ fontSize: '11px', color: '#888', margin: '-12px 0 16px 24px' }}>
          Your number is for verification only — never shared without your permission.
        </p>

        {/* Nationality Dropdown */}
        <label style={{ fontSize: '14px', fontWeight: '600', color: '#333' }}>Nationality</label>
        <p style={{ fontSize: '12px', color: '#888', margin: '4px 0 8px' }}>Select your country of citizenship</p>
        <div style={{ position: 'relative', marginBottom: '4px' }}>
          <div
            onClick={() => setShowCountryDropdown(!showCountryDropdown)}
            style={{ width: '100%', padding: '12px', borderRadius: '8px', border: errors.nationality ? '2px solid #c33' : '1px solid #ddd', fontSize: '15px', boxSizing: 'border-box', background: '#fff', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: nationality ? '#333' : '#999' }}>{nationality || 'Select your country'}</span>
            <span style={{ color: '#999', fontSize: '12px' }}>{showCountryDropdown ? '▲' : '▼'}</span>
          </div>
          {showCountryDropdown && (
            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid #ddd', borderRadius: '8px', maxHeight: '240px', overflow: 'hidden', zIndex: 10, boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
              <input
                value={nationalitySearch}
                onChange={e => setNationalitySearch(e.target.value)}
                placeholder="Search countries..."
                autoFocus
                style={{ width: '100%', padding: '10px 12px', border: 'none', borderBottom: '1px solid #eee', fontSize: '14px', boxSizing: 'border-box', outline: 'none' }}
              />
              <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                {filteredCountries.map(country => (
                  <div
                    key={country}
                    onClick={() => {
                      setNationality(country)
                      setNationalitySearch('')
                      setShowCountryDropdown(false)
                      setErrors(e => ({ ...e, nationality: undefined }))
                    }}
                    style={{
                      padding: '10px 12px',
                      cursor: 'pointer',
                      fontSize: '14px',
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
                  <div style={{ padding: '12px', color: '#999', fontSize: '14px', textAlign: 'center' }}>No countries found</div>
                )}
              </div>
            </div>
          )}
        </div>
        {errors.nationality && <p style={{ color: '#c33', fontSize: '12px', margin: '4px 0 16px' }}>{errors.nationality}</p>}
        {!errors.nationality && <div style={{ marginBottom: '16px' }} />}

        {/* Location */}
        <label style={{ fontSize: '14px', fontWeight: '600', color: '#333' }}>Location</label>
        <p style={{ fontSize: '12px', color: '#888', margin: '4px 0 8px' }}>Your city or district — helps buyers find you. Type manually or use auto-detect.</p>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '4px' }}>
          <input value={location} onChange={e => setLocation(e.target.value)}
            placeholder="e.g. Kampala, Uganda"
            style={{ flex: 1, padding: '12px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '15px', boxSizing: 'border-box' }} />
          <button onClick={handleUseMyLocation} disabled={locationLoading}
            title="Use my current location"
            style={{ padding: '12px 16px', background: locationLoading ? '#eee' : '#f0f0f0', color: '#333', border: '1px solid #ddd', borderRadius: '8px', cursor: locationLoading ? 'not-allowed' : 'pointer', fontSize: '16px', whiteSpace: 'nowrap' }}>
            {locationLoading ? '⏳' : '📍'}
          </button>
        </div>
        {locationLoading && <p style={{ color: '#888', fontSize: '12px', margin: '4px 0 16px' }}>Detecting your location...</p>}
        {!locationLoading && <div style={{ marginBottom: '16px' }} />}

        {/* National ID Upload */}
        <label style={{ fontSize: '14px', fontWeight: '600', color: '#333' }}>National ID <span style={{ color: '#888', fontWeight: '400', fontSize: '12px' }}>(optional for now)</span></label>
        <p style={{ fontSize: '12px', color: '#888', margin: '4px 0 8px' }}>
          Upload a photo or scan of your National ID card. This is <strong>private</strong> — only you can see it. Stronger identity verification coming soon.
        </p>
        <div style={{ marginBottom: '4px' }}>
          {!idFileName ? (
            <label style={{ display: 'block', width: '100%', padding: '40px 20px', border: errors.idDocument ? '2px dashed #c33' : '2px dashed #ddd', borderRadius: '8px', textAlign: 'center', cursor: 'pointer', background: '#fafafa' }}>
              <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={e => handleIdFileChange(e.target.files?.[0] || null)} style={{ display: 'none' }} />
              <div style={{ fontSize: '32px', marginBottom: '8px', color: '#ccc' }}>📄</div>
              <p style={{ fontSize: '13px', color: '#999', margin: 0 }}>Click to upload your National ID</p>
              <p style={{ fontSize: '11px', color: '#bbb', margin: '4px 0 0' }}>JPG, PNG, or PDF — max 10MB</p>
            </label>
          ) : (
            <div style={{ padding: '12px', background: '#f0f8f0', borderRadius: '8px', border: '1px solid #c8e6c9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '20px' }}>📎</span>
                <span style={{ fontSize: '13px', color: '#2e7d32', fontWeight: '600' }}>{idFileName}</span>
              </div>
              <button onClick={() => handleIdFileChange(null)}
                style={{ background: 'transparent', border: 'none', color: '#999', cursor: 'pointer', fontSize: '16px', padding: '0 4px' }}>
                ✕
              </button>
            </div>
          )}
        </div>
        {errors.idDocument && <p style={{ color: '#c33', fontSize: '12px', margin: '4px 0 16px' }}>{errors.idDocument}</p>}
        {!errors.idDocument && <div style={{ marginBottom: '16px' }} />}

        <label style={{ fontSize: '14px', fontWeight: '600', color: '#333' }}>Email</label>
        <input value={email} onChange={e => setEmail(e.target.value)}
          placeholder="you@example.com"
          style={{ width: '100%', padding: '12px', borderRadius: '8px', border: errors.email ? '2px solid #c33' : '1px solid #ddd', marginTop: '8px', marginBottom: '4px', fontSize: '15px', boxSizing: 'border-box' }} />
        {errors.email && <p style={{ color: '#c33', fontSize: '12px', margin: '4px 0 16px' }}>{errors.email}</p>}
        {!errors.email && <div style={{ marginBottom: '16px' }} />}

        <label style={{ fontSize: '14px', fontWeight: '600', color: '#333' }}>Instagram username</label>
        <input value={instagram} onChange={e => setInstagram(e.target.value)}
          placeholder="yourhandle"
          style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #ddd', marginTop: '8px', marginBottom: '4px', fontSize: '15px', boxSizing: 'border-box' }} />
        <p style={{ fontSize: '12px', color: '#888', margin: '4px 0 16px' }}>Add your Instagram handle without the @</p>

        <label style={{ fontSize: '14px', fontWeight: '600', color: '#333' }}>TikTok username</label>
        <input value={tiktok} onChange={e => setTiktok(e.target.value)}
          placeholder="yourhandle"
          style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #ddd', marginTop: '8px', marginBottom: '4px', fontSize: '15px', boxSizing: 'border-box' }} />
        <p style={{ fontSize: '12px', color: '#888', margin: '4px 0 16px' }}>Add your TikTok handle without the @</p>

        <label style={{ fontSize: '14px', fontWeight: '600', color: '#333' }}>Logo (optional)</label>
        <div style={{ margin: '8px 0 12px' }}>
          <input type="file" accept="image/*" onChange={e => { const f = e.target.files?.[0]; if (f) { setLogoFile(f); setLogoPreview(URL.createObjectURL(f)) } }} />
        </div>
        {logoPreview && <div style={{ marginBottom: '12px' }}><img src={logoPreview} alt="logo preview" style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 8 }} /></div>}

        <button onClick={handleSubmit} disabled={loading || uploadingLogo || uploadingId || !isFormReady}
          style={{ width: '100%', padding: '14px', background: loading || uploadingLogo || uploadingId || !isFormReady ? '#ccc' : '#1a1a1a', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '16px', fontWeight: '600', cursor: loading || uploadingLogo || uploadingId || !isFormReady ? 'not-allowed' : 'pointer', marginTop: '8px' }}>
          {loading || uploadingLogo || uploadingId ? 'Creating...' : 'Create My Store'}
        </button>
      </div>
    </div>
  )
}

export default SetupStore