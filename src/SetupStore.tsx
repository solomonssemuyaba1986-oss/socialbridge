import { useEffect, useRef, useState } from 'react'
import { auth, db, storage } from './firebase'
import { collection, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore'
import { ref, uploadBytes } from 'firebase/storage'
import { useNavigate } from 'react-router-dom'
import { COUNTRIES } from './countries'
import { COUNTRY_CODES, type CountryCode } from './countryCodes'
import AuthModal from './AuthModal'
import {
  placeLabel,
  resolveSellerLocation,
  reverseGeocode,
  type GeoPoint,
  type GeoSource,
  type Place,
} from './place'

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
  const initialPhone = auth.currentUser?.phoneNumber || ''
  const initialCountry = COUNTRY_CODES.find(c => initialPhone.startsWith(c.dialCode))
    || COUNTRY_CODES.find(c => c.dialCode === '+256')
    || COUNTRY_CODES[0]
  const [selectedCountry, setSelectedCountry] = useState<CountryCode>(initialCountry)
  const [whatsappCountrySearch, setWhatsappCountrySearch] = useState('')
  const [showWhatsappCountryDropdown, setShowWhatsappCountryDropdown] = useState(false)
  const [whatsapp, setWhatsapp] = useState(
    // Pre-fill from Firebase Phone Auth if available
    initialPhone.startsWith(initialCountry.dialCode)
      ? initialPhone.slice(initialCountry.dialCode.length).replace(/^0/, '')
      : ''
  )
  const [email, setEmail] = useState(auth.currentUser?.email || '')
  const [nationality, setNationality] = useState('Uganda')
  const [nationalitySearch, setNationalitySearch] = useState('')
  const [showCountryDropdown, setShowCountryDropdown] = useState(false)
  const [location, setLocation] = useState('')
  const [geo, setGeo] = useState<GeoPoint | null>(null)
  const [place, setPlace] = useState<Place | null>(null)
  const [geoSource, setGeoSource] = useState<GeoSource | null>(null)
  const [locationLoading, setLocationLoading] = useState(false)
  const [errors, setErrors] = useState<SetupFormErrors>({})
  const [loading, setLoading] = useState(false)
  const [showAuthModal, setShowAuthModal] = useState(() => !auth.currentUser)
  // The number is private by default (verification, security, payouts). Sellers can
  // choose to show it on their store later from Edit Store.
  const [showWhatsapp] = useState(false)
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

  // Country-aware phone helpers.
  // Dial codes already include "+" (e.g. '+256', '+1-684'), so strip everything to
  // digits and add exactly ONE "+" ourselves — and drop the local trunk zero
  // (0771234567 → 771234567) the way people actually type Ugandan numbers.
  const dialDigits = selectedCountry.dialCode.replace(/\D/g, '')
  const localDigits = whatsapp.replace(/\D/g, '').replace(/^0+/, '')
  const getFullWhatsapp = () => `+${dialDigits}${localDigits}`
  const whatsappIsValid = /^\+[1-9]\d{7,14}$/.test(getFullWhatsapp())

  // Multi-step onboarding — step 0 is "create your account" so the shop belongs
  // to an account from the start (and email/phone can be prefilled).
  const [step, setStep] = useState<number>(() => (auth.currentUser ? 1 : 0))
  const totalSteps = 4

  const goNext = (to: number) => {
    // The shop must belong to an account — if sign-in was skipped/closed, ask again.
    if (!auth.currentUser) {
      setShowAuthModal(true)
      return
    }
    if (to === 2) {
      if (!businessName.trim()) { setErrors(e => ({ ...e, businessName: 'Business name is required' })); return }
      if (storeHandle.length < 3) { setErrors(e => ({ ...e, submit: 'Choose a store handle (at least 3 characters) to continue.' })); return }
    }
    if (to === 3) {
      if (!whatsappIsValid) { setErrors(e => ({ ...e, whatsapp: 'Enter a valid phone number to continue — e.g. 771234567 or 0771234567.' })); return }
    }
    if (to === 4) {
      if (!nationality) { setErrors(e => ({ ...e, nationality: 'Select your nationality to continue.' })); return }
    }
    setErrors({})
    setStep(to)
    window.scrollTo(0, 0)
  }

  const navigate = useNavigate()

  // If a signed-in user already has a store, don't let /setup overwrite it
  useEffect(() => {
    const u = auth.currentUser
    if (!u) return
    getDoc(doc(db, 'sellers', u.uid)).then(snap => {
      if (snap.exists()) navigate('/dashboard')
    }).catch(() => {})
  }, [navigate])

  const sanitizeInput = (input: string, maxLength: number = 100): string => {
    return input.trim().slice(0, maxLength).replace(/<[^>]*>/g, '')
  }

  const sanitizeHandle = (input: string): string => {
    return input.toLowerCase().trim().replace(/[^a-z0-9_-]/g, '').replace(/-+/g, '-').replace(/_+/g, '_').slice(0, 30)
  }

  // Debounced handle availability check
  const handleCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
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
    if (handleCheckTimer.current) clearTimeout(handleCheckTimer.current)
    if (cleaned.length >= 3) {
      handleCheckTimer.current = setTimeout(() => checkHandleAvailability(cleaned), 400)
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
    if (!whatsappIsValid) {
      setPhoneOtpError('Enter a valid phone number with country code first')
      return
    }
    setPhoneOtpLoading(true)
    setPhoneOtpError('')
    const normalized = getFullWhatsapp()
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
      setPhoneOtpError('Verification is offline right now — you can continue and verify later.')
    } finally {
      setPhoneOtpLoading(false)
    }
  }

  const verifyPhoneOtp = async () => {
    if (!phoneOtpInput || phoneOtpInput.length < 6) {
      setPhoneOtpError('Enter the 6-digit code')
      return
    }
    const normalized = getFullWhatsapp()
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
      setPhoneOtpError('Verification is offline right now — you can continue and verify later.')
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
    if (!whatsappIsValid) {
      newErrors.whatsapp = 'Enter a valid phone number with country code (e.g. +256771234567)'
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sanitizeInput(email))) {
      newErrors.email = 'Enter a valid email address'
    }
    if (!nationality) {
      newErrors.nationality = 'Please select your country'
    }
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleWhatsappChange = (val: string) => {
    const digits = val.replace(/\D/g, '').slice(0, 14)
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

  const handleWhatsappCountryChange = (c: CountryCode) => {
    setSelectedCountry(c)
    setShowWhatsappCountryDropdown(false)
    setWhatsappCountrySearch('')
    setPhoneOtpSent(false)
    setPhoneVerified(false)
    setPhoneOtpInput('')
    setPhoneOtpError('')
    setErrors(e => ({ ...e, whatsapp: undefined }))
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
        if (err.code === 1) {
          setErrors(e => ({ ...e, submit: 'Location access denied. Enable it in your browser settings (iPhone: Settings → Safari → Location), then try again.' }))
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
      // Guest: open the sign-in popup — their filled-in store stays safe
      setShowAuthModal(true)
      return
    }
    setLoading(true)
    setErrors({})
    try {
      const cleanedName = sanitizeInput(businessName)
      const cleanedBio = sanitizeInput(bio, 500)
      const cleanedEmail = email ? sanitizeInput(email) : ''
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
      const fullNumber = getFullWhatsapp()

      // Upload logo (optional)
      let finalLogoUrl = user.photoURL || ''
      if (logoFile) {
        try {
          setUploadingLogo(true)
          const processedBlob = await resizeImage(logoFile, 1024, 0.8)
          const processedFile = new File([processedBlob], 'logo.jpg', { type: 'image/jpeg' })
           const formData = new FormData()
           formData.append('file', processedFile)
           formData.append('upload_preset', import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET || 'p2z65zrv')
          const res = await fetch(`https://api.cloudinary.com/v1_1/${import.meta.env.VITE_CLOUDINARY_CLOUD_NAME || 'dzudmmuxg'}/image/upload`, { method: 'POST', body: formData })
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

      // Typed an area but never dropped a pin? Geocode it so the store can still
      // show up on Nearby (with an honestly-labelled approximate distance).
      const resolved = await resolveSellerLocation({ locationText: location, geo, place, geoSource })

      await setDoc(doc(db, 'sellers', user.uid), {
        businessName: cleanedName,
        bio: cleanedBio,
        whatsapp: fullNumber,
        logoUrl: finalLogoUrl,
        slug,
        email: cleanedEmail || user.email || '',
        instagram: '',
        tiktok: '',
        nationality,
        location: resolved.label || location.trim(),
        geo: resolved.geo,
        place: resolved.place,
        geoSource: resolved.geoSource,
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
      // A shop with no products shows buyers nothing — send them straight to
      // adding their first product instead of dumping them on the dashboard.
      navigate('/products')
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

  const handleAuthSuccess = () => {
    setShowAuthModal(false)
    const finish = () => {
      const u = auth.currentUser
      if (!u) return
      // Pull in whatever the account already knows, so nothing gets retyped.
      if (u.email) setEmail(prev => prev || (u.email as string))
      if (u.phoneNumber) {
        const phone = u.phoneNumber
        const match = COUNTRY_CODES.find(c => phone.startsWith(c.dialCode))
        if (match) {
          setSelectedCountry(match)
          setWhatsapp(phone.slice(match.dialCode.length).replace(/^0/, ''))
        }
        // Firebase already proved this number — no need to ask twice.
        setPhoneVerified(true)
      }
      setStep(s => (s === 0 ? 1 : s))
      window.scrollTo(0, 0)
    }
    if (auth.currentUser) finish()
    else setTimeout(finish, 300)
  }

  /**
   * What's still missing, so the Create button is never a silent dead end.
   * Each item knows which step fixes it.
   */
  const missing: { label: string; step: number }[] = []
  if (!businessName.trim() || storeHandle.length < 3) missing.push({ label: 'Shop name & link', step: 1 })
  if (!bio.trim()) missing.push({ label: 'What do you sell?', step: 1 })
  if (!whatsappIsValid) missing.push({ label: 'Phone number', step: 2 })
  if (!nationality) missing.push({ label: 'Country', step: 3 })
  const isFormReady = missing.length === 0

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

        {/* Step Progress */}
        {step > 0 && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '16px' }}>
              {[1, 2, 3, 4].map(n => (
                <div key={n} style={{ flex: 1, height: '6px', borderRadius: '3px', background: step >= n ? '#1a1a1a' : '#e5e5e5' }} />
              ))}
            </div>
            <p style={{ fontSize: '13px', color: '#888', margin: '0 0 20px', fontWeight: '600' }}>
              Step {step} of {totalSteps} — {step === 1 ? 'Your shop' : step === 2 ? 'Phone number' : step === 3 ? 'About you' : 'Finish'}
            </p>
          </>
        )}

        {/* Step 0 — the account comes first, so nothing is retyped or lost */}
        {step === 0 && (
          <>
            <h2 style={{ fontSize: '19px', fontWeight: '800', margin: '0 0 6px', color: '#1a1a1a' }}>First, create your account</h2>
            <p style={{ fontSize: '14px', color: '#666', margin: '0 0 18px', lineHeight: 1.5 }}>
              Choose whatever is easiest for you — Google, Facebook, Apple or your phone number.
              Your shop belongs to this account, so you can manage it from any device later.
            </p>
            <button onClick={() => setShowAuthModal(true)}
              style={{ width: '100%', padding: '14px', background: '#1a1a1a', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '16px', fontWeight: '700', cursor: 'pointer' }}>
              Choose how to sign in →
            </button>
          </>
        )}

        {step === 1 && (
          <>
        <label style={{ fontSize: '14px', fontWeight: '600', color: '#333' }}>Shop name <span style={{ color: '#888', fontWeight: '400', fontSize: '12px' }}>— needed</span></label>
        <input value={businessName} onChange={e => setBusinessName(e.target.value)}
          placeholder="e.g. Aisha Fabrics"
          style={{ width: '100%', padding: '12px', borderRadius: '8px', border: errors.businessName ? '2px solid #c33' : '1px solid #ddd', marginTop: '8px', marginBottom: '4px', fontSize: '15px', boxSizing: 'border-box' }} />
        {errors.businessName && <p style={{ color: '#c33', fontSize: '12px', margin: '4px 0 16px' }}>{errors.businessName}</p>}
        {!errors.businessName && <div style={{ marginBottom: '16px' }} />}

        <label style={{ fontSize: '14px', fontWeight: '600', color: '#333' }}>Your shop link <span style={{ color: '#888', fontWeight: '400', fontSize: '12px' }}>— needed</span></label>
        <p style={{ fontSize: '12px', color: '#888', margin: '4px 0 8px' }}>
          The address you share with customers: rachett.com/store/<strong style={{ color: '#333' }}>{storeHandle || 'your-shop'}</strong>
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
        {!handleChecking && handleAvailable === null && <div style={{ marginBottom: '16px' }} />}
        {storeHandle.length === 0 && <div style={{ marginBottom: '16px' }} />}

        <label style={{ fontSize: '14px', fontWeight: '600', color: '#333' }}>What do you sell? <span style={{ color: '#888', fontWeight: '400', fontSize: '12px' }}>— needed</span></label>
        <textarea value={bio} onChange={e => setBio(e.target.value)}
          placeholder="e.g. Brand-new sneakers, we deliver around Kampala"
          rows={3}
          style={{ width: '100%', padding: '12px', borderRadius: '8px', border: errors.bio ? '2px solid #c33' : '1px solid #ddd', marginTop: '8px', marginBottom: '4px', fontSize: '15px', boxSizing: 'border-box', resize: 'none' }} />
        {errors.bio && <p style={{ color: '#c33', fontSize: '12px', margin: '4px 0 16px' }}>{errors.bio}</p>}
        {!errors.bio && <div style={{ marginBottom: '16px' }} />}

          </>
        )}
        {step === 1 && (
          <button onClick={() => goNext(2)}
            style={{ width: '100%', padding: '14px', background: '#1a1a1a', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '16px', fontWeight: '600', cursor: 'pointer', marginTop: '8px' }}>
            Continue →
          </button>
        )}

        {step === 2 && (
          <>
        {/* Phone number — required as a contact/identity, but verification is optional */}
        <label style={{ fontSize: '14px', fontWeight: '600', color: '#333' }}>Phone number <span style={{ color: '#888', fontWeight: '400', fontSize: '12px' }}>— needed</span></label>
        <p style={{ fontSize: '12px', color: '#888', margin: '4px 0 8px' }}>
          Pick your country code, then type your number — e.g. <strong>771234567</strong> or <strong>0771234567</strong>.
        </p>
        <p style={{ fontSize: '12px', color: '#666', margin: '0 0 8px', lineHeight: 1.5 }}>
          We use it to keep your shop safe, to identify you, and to send you money when you sell.
          It stays private — buyers never see it.
        </p>

        <div style={{ display: 'flex', alignItems: 'center', border: errors.whatsapp ? '2px solid #c33' : '1px solid #ddd', borderRadius: '8px', overflow: 'visible', marginBottom: '4px', position: 'relative' }}>
          <div onClick={() => setShowWhatsappCountryDropdown(!showWhatsappCountryDropdown)}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#f5f5f5', padding: '12px 12px', fontSize: '15px', borderRight: errors.whatsapp ? '2px solid #c33' : '1px solid #ddd', color: '#333', fontWeight: '600', whiteSpace: 'nowrap', cursor: 'pointer' }}>
            <span>{selectedCountry.flag} {selectedCountry.dialCode}</span>
            <span style={{ color: '#999', fontSize: '11px' }}>{showWhatsappCountryDropdown ? '▲' : '▼'}</span>
          </div>
          {showWhatsappCountryDropdown && (
            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid #ddd', borderRadius: '8px', maxHeight: '240px', overflow: 'hidden', zIndex: 20, boxShadow: '0 4px 12px rgba(0,0,0,0.1)', marginTop: '2px' }}>
              <input value={whatsappCountrySearch} onChange={e => setWhatsappCountrySearch(e.target.value)} placeholder="Search country..." autoFocus
                style={{ width: '100%', padding: '10px 12px', border: 'none', borderBottom: '1px solid #eee', fontSize: '14px', boxSizing: 'border-box', outline: 'none' }} />
              <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                {COUNTRY_CODES.filter(c => !whatsappCountrySearch || c.name.toLowerCase().includes(whatsappCountrySearch.toLowerCase()) || c.dialCode.includes(whatsappCountrySearch)).map(c => (
                  <div key={c.dialCode} onClick={() => handleWhatsappCountryChange(c)}
                    style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', cursor: 'pointer', fontSize: '14px', color: selectedCountry.dialCode === c.dialCode ? '#4a4' : '#333', background: selectedCountry.dialCode === c.dialCode ? '#f0faf0' : 'transparent' }}>
                    <span style={{ fontSize: '16px' }}>{c.flag}</span>
                    <span style={{ flex: 1 }}>{c.name}</span>
                    <span style={{ color: '#999' }}>{c.dialCode}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <input
            value={whatsapp}
            onChange={e => handleWhatsappChange(e.target.value)}
            placeholder="your number"
            maxLength={14}
            style={{ flex: 1, padding: '12px', border: 'none', outline: 'none', fontSize: '15px', background: '#fff' }}
          />
        </div>

        {errors.whatsapp && <p style={{ color: '#c33', fontSize: '12px', margin: '4px 0 8px' }}>{errors.whatsapp}</p>}

        {/* Optional verification — skipping is fine, it only affects the ✓ badge */}
        {whatsappIsValid && !phoneVerified && (
          <div style={{ marginBottom: '16px', padding: '12px', background: '#f8f8f8', borderRadius: '8px', border: '1px solid #eee' }}>
            {!phoneOtpSent ? (
              <>
                <p style={{ fontSize: '13px', color: '#444', margin: '0 0 4px', fontWeight: '700' }}>Optional: verify this number</p>
                <p style={{ fontSize: '12px', color: '#777', margin: '0 0 10px' }}>
                  Verified sellers earn the ✓ Real Seller badge, and buyers trust them more. You can skip this and do it later.
                </p>
                <button onClick={sendPhoneOtp} disabled={phoneOtpLoading}
                  style={{ width: '100%', padding: '10px', background: phoneOtpLoading ? '#ccc' : '#1a1a1a', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: '600', cursor: phoneOtpLoading ? 'not-allowed' : 'pointer', fontSize: '14px' }}>
                  {phoneOtpLoading ? 'Sending...' : 'Verify now (earn ✓ Verified)'}
                </button>
              </>
            ) : (
              <>
                <p style={{ fontSize: '13px', color: '#666', margin: '0 0 8px' }}>A 6-digit code was sent to <strong>{getFullWhatsapp()}</strong></p>
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
                <button onClick={() => { setPhoneOtpSent(false); setPhoneOtpInput(''); setPhoneOtpError('') }}
                  style={{ width: '100%', marginTop: '8px', padding: '6px', background: 'transparent', color: '#888', border: 'none', cursor: 'pointer', fontSize: '13px' }}>
                  Skip verification for now — you can do it later
                </button>
              </>
            )}
            {phoneOtpError && <p style={{ color: '#c33', fontSize: '12px', margin: '8px 0 0' }}>{phoneOtpError}</p>}
          </div>
        )}

        {phoneVerified && (
          <div style={{ marginBottom: '16px', padding: '10px 12px', background: '#e8f5e9', borderRadius: '8px', border: '1px solid #c8e6c9', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ color: '#2e7d32', fontSize: '16px' }}>✓</span>
            <span style={{ color: '#2e7d32', fontSize: '13px', fontWeight: '600' }}>Phone verified — {getFullWhatsapp()}</span>
          </div>
        )}

        <p style={{ fontSize: '11px', color: '#888', margin: '0 0 16px' }}>
          Your number is private — we use it for verification, security and paying you. It is never shown to buyers, and buyers can always reach you through your Inbox.
        </p>

          </>
        )}
        {step === 2 && (
          <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
            <button onClick={() => setStep(1)}
              style={{ flex: 1, padding: '14px', background: '#f0f0f0', color: '#333', border: '1px solid #ddd', borderRadius: '8px', fontSize: '16px', fontWeight: '600', cursor: 'pointer' }}>
              ← Back
            </button>
            <button onClick={() => goNext(3)}
              style={{ flex: 2, padding: '14px', background: '#1a1a1a', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '16px', fontWeight: '600', cursor: 'pointer' }}>
              Continue →
            </button>
          </div>
        )}

        {step === 3 && (
          <>
        {/* Country — defaults to Uganda; stored on the store as `nationality` */}
        <label style={{ fontSize: '14px', fontWeight: '600', color: '#333' }}>Country</label>
        <p style={{ fontSize: '12px', color: '#888', margin: '4px 0 8px' }}>Where are you selling from? Uganda is already picked — change it if you're elsewhere.</p>
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
          <input value={location} onChange={e => { setLocation(e.target.value); setGeo(null); setPlace(null); setGeoSource(null) }}
            placeholder="e.g. Kampala, Uganda"
            style={{ flex: 1, padding: '12px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '15px', boxSizing: 'border-box' }} />
          <button onClick={handleUseMyLocation} disabled={locationLoading}
            title="Use my current location"
            style={{ padding: '12px 16px', background: locationLoading ? '#eee' : '#f0f0f0', color: '#333', border: '1px solid #ddd', borderRadius: '8px', cursor: locationLoading ? 'not-allowed' : 'pointer', fontSize: '16px', whiteSpace: 'nowrap' }}>
            {locationLoading ? '⏳' : '📍'}
          </button>
        </div>
        {locationLoading && <p style={{ color: '#888', fontSize: '12px', margin: '4px 0 16px' }}>Detecting your location...</p>}
        {!locationLoading && geoSource === 'gps' && (
          <p style={{ color: '#2e7d32', fontSize: '12px', fontWeight: '700', margin: '4px 0 16px' }}>✓ Exact pin saved — buyers nearby will see how far you are</p>
        )}
        {!locationLoading && geoSource !== 'gps' && !!location.trim() && (
          <p style={{ color: '#888', fontSize: '12px', margin: '4px 0 16px' }}>📍 We'll place your store using this area (approximate). Tap the pin button for an exact one.</p>
        )}
        {!locationLoading && geoSource !== 'gps' && !location.trim() && <div style={{ marginBottom: '16px' }} />}

        {/* National ID Upload */}
        <label style={{ fontSize: '14px', fontWeight: '600', color: '#333' }}>National ID <span style={{ color: '#888', fontWeight: '400', fontSize: '12px' }}>(optional for now)</span></label>
        <p style={{ fontSize: '12px', color: '#888', margin: '4px 0 8px' }}>
          Optional — it's what earns the ✓ verified badge later, and it's <strong>private</strong>: only you can see it.
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

          </>
        )}
        {step === 3 && (
          <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
            <button onClick={() => setStep(2)}
              style={{ flex: 1, padding: '14px', background: '#f0f0f0', color: '#333', border: '1px solid #ddd', borderRadius: '8px', fontSize: '16px', fontWeight: '600', cursor: 'pointer' }}>
              ← Back
            </button>
            <button onClick={() => goNext(4)}
              style={{ flex: 2, padding: '14px', background: '#1a1a1a', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '16px', fontWeight: '600', cursor: 'pointer' }}>
              Continue →
            </button>
          </div>
        )}

        {step === 4 && (
          <>
        <label style={{ fontSize: '14px', fontWeight: '600', color: '#333' }}>Email</label>
        <input value={email} onChange={e => setEmail(e.target.value)}
          placeholder="you@example.com"
          style={{ width: '100%', padding: '12px', borderRadius: '8px', border: errors.email ? '2px solid #c33' : '1px solid #ddd', marginTop: '8px', marginBottom: '4px', fontSize: '15px', boxSizing: 'border-box' }} />
        {errors.email && <p style={{ color: '#c33', fontSize: '12px', margin: '4px 0 16px' }}>{errors.email}</p>}
        {!errors.email && <div style={{ marginBottom: '16px' }} />}

        <p style={{ fontSize: '12px', color: '#888', margin: '0 0 16px' }}>
          Instagram, TikTok and a logo can wait — you can add them any time from your Dashboard after your shop is open.
        </p>

        <label style={{ fontSize: '14px', fontWeight: '600', color: '#333' }}>Logo (optional)</label>
        <div style={{ margin: '8px 0 12px' }}>
          <input type="file" accept="image/*" onChange={e => { const f = e.target.files?.[0]; if (f) { setLogoFile(f); setLogoPreview(URL.createObjectURL(f)) } }} />
        </div>
        {logoPreview && <div style={{ marginBottom: '12px' }}><img src={logoPreview} alt="logo preview" style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 8 }} /></div>}

        {missing.length > 0 && (
          <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: '8px', padding: '12px', marginBottom: '12px' }}>
            <p style={{ margin: '0 0 6px', fontSize: '13px', fontWeight: '700', color: '#9a3412' }}>Almost there — still needed:</p>
            {missing.map(m => (
              <button key={`${m.label}-${m.step}`} onClick={() => window.setTimeout(() => setStep(m.step), 0)}
                style={{ display: 'block', background: 'transparent', border: 'none', color: '#9a3412', cursor: 'pointer', fontSize: '13px', textDecoration: 'underline', padding: '2px 0', textAlign: 'left' }}>
                • {m.label} — tap to fix
              </button>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
          <button onClick={() => setStep(3)}
            style={{ flex: 1, padding: '14px', background: '#f0f0f0', color: '#333', border: '1px solid #ddd', borderRadius: '8px', fontSize: '16px', fontWeight: '600', cursor: 'pointer' }}>
            ← Back
          </button>
          <button onClick={handleSubmit} disabled={loading || uploadingLogo || uploadingId || !isFormReady}
            style={{ flex: 2, padding: '14px', background: loading || uploadingLogo || uploadingId || !isFormReady ? '#ccc' : '#1a1a1a', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '16px', fontWeight: '600', cursor: loading || uploadingLogo || uploadingId || !isFormReady ? 'not-allowed' : 'pointer' }}>
            {loading || uploadingLogo || uploadingId ? 'Creating...' : 'Create My Store'}
          </button>
        </div>
          </>
        )}

      <AuthModal
        open={showAuthModal}
        title="Create your account"
        subtitle="Choose whatever is easiest — Google, Facebook, Apple or your phone number."
        onSuccess={handleAuthSuccess}
        onClose={() => setShowAuthModal(false)}
      />
      </div>
    </div>
  )
}

export default SetupStore