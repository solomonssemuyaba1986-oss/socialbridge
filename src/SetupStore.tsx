import { useEffect, useRef, useState } from 'react'
import { auth, db, storage, googleProvider, facebookProvider, appleProvider, createRecaptchaVerifier } from './firebase'
import { signInWithPopup, signInWithPhoneNumber, type ConfirmationResult, type AuthProvider } from 'firebase/auth'
import { collection, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore'
import { ref, uploadBytes } from 'firebase/storage'
import { useNavigate } from 'react-router-dom'
import { COUNTRIES } from './countries'
import { COUNTRY_CODES, type CountryCode } from './countryCodes'
import {
  placeLabel,
  resolveSellerLocation,
  reverseGeocode,
  type GeoPoint,
  type GeoSource,
  type Place,
} from './place'

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
  const [nationality, setNationality] = useState('')
  const [nationalitySearch, setNationalitySearch] = useState('')
  const [showCountryDropdown, setShowCountryDropdown] = useState(false)
  const [location, setLocation] = useState('')
  const [geo, setGeo] = useState<GeoPoint | null>(null)
  const [place, setPlace] = useState<Place | null>(null)
  const [geoSource, setGeoSource] = useState<GeoSource | null>(null)
  const [locationLoading, setLocationLoading] = useState(false)
  const [errors, setErrors] = useState<SetupFormErrors>({})
  const [loading, setLoading] = useState(false)
  // The number is private by default (verification, security, payouts). Sellers can
  // choose to show it on their store later from Edit Store.
  const [showWhatsapp] = useState(false)
  // National ID upload
  const [idFile, setIdFile] = useState<File | null>(null)
  const [idFileName, setIdFileName] = useState('')
  const [uploadingId, setUploadingId] = useState(false)

  // Phone verification — comes free from Firebase phone sign-in (one SMS, at the
  // "save your shop" step). Social sign-ins can earn the badge later.
  const [phoneVerified, setPhoneVerified] = useState(!!auth.currentUser?.phoneNumber)

  // Country-aware phone helpers.
  // Dial codes already include "+" (e.g. '+256', '+1-684'), so strip everything to
  // digits and add exactly ONE "+" ourselves — and drop the local trunk zero
  // (0771234567 → 771234567) the way people actually type Ugandan numbers.
  const dialDigits = selectedCountry.dialCode.replace(/\D/g, '')
  const localDigits = whatsapp.replace(/\D/g, '').replace(/^0+/, '')
  const getFullWhatsapp = () => `+${dialDigits}${localDigits}`
  const whatsappIsValid = /^\+[1-9]\d{7,14}$/.test(getFullWhatsapp())

  // Multi-step onboarding — 3 steps, account LAST so sellers see the whole shop
  // before we ask them to sign in.
  const [step, setStep] = useState(1)
  const totalSteps = 3
  /** Set once the shop is created — we show a celebration instead of redirecting. */
  const [createdSlug, setCreatedSlug] = useState('')
  /** Tracked separately so the UI reacts the moment sign-in succeeds. */
  const [signedInUid, setSignedInUid] = useState<string | null>(auth.currentUser?.uid || null)
  // Inline sign-in on the last step — no pop-ups on this page.
  const [signingIn, setSigningIn] = useState('')
  const [signInError, setSignInError] = useState('')
  const [smsCode, setSmsCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const confirmationRef = useRef<ConfirmationResult | null>(null)

  const goNext = (to: number) => {
    if (to === 2) {
      if (!businessName.trim()) { setErrors(e => ({ ...e, businessName: 'Shop name is required' })); return }
      if (storeHandle.length < 3) { setErrors(e => ({ ...e, submit: 'Choose your shop link (at least 3 characters) to continue.' })); return }
      if (!bio.trim()) { setErrors(e => ({ ...e, bio: 'Tell buyers what you sell to continue.' })); return }
    }
    if (to === 3) {
      // The phone number lives on step 3 — only the country is checked here.
      if (!nationality) { setErrors(e => ({ ...e, nationality: 'Select your country to continue.' })); return }
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
    // A different number is a different number — it can't stay "verified".
    if (digits !== whatsapp) setPhoneVerified(false)
  }

  const handleWhatsappCountryChange = (c: CountryCode) => {
    setSelectedCountry(c)
    setShowWhatsappCountryDropdown(false)
    setWhatsappCountrySearch('')
    setPhoneVerified(false)
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
      // Not signed in yet — point them at the sign-in choices on this step.
      setErrors({ submit: 'Choose how you want to sign in above, then tap Create My Shop.' })
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

      // Logo: use the sign-in photo when we have one (Google/Facebook/Apple);
      // phone-only sellers get their initials until they add one in Edit Store.
      const finalLogoUrl = user.photoURL || ''

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
      // Celebration, not a redirect — the seller sees their live shop link and
      // the one next action (add a product), plus a WhatsApp share for their bio.
      setCreatedSlug(slug)
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
    const finish = () => {
      const u = auth.currentUser
      if (!u) return
      setSignedInUid(u.uid)
      setSignInError('')
      setCodeSent(false)
      setSmsCode('')
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
      window.scrollTo(0, 0)
    }
    if (auth.currentUser) finish()
    else setTimeout(finish, 300)
  }

  /** Google · Facebook · Apple — inline, right on the last step. */
  const socialSignIn = async (provider: AuthProvider, name: string) => {
    setSigningIn(name)
    setSignInError('')
    try {
      await signInWithPopup(auth, provider)
      handleAuthSuccess()
    } catch (err) {
      const code = (err as { code?: string })?.code || ''
      console.error(`${name} sign-in failed:`, err)
      setSignInError(
        code === 'auth/popup-blocked'
          ? `Your browser blocked the ${name} window — tap again and allow pop-ups.`
          : code === 'auth/operation-not-allowed'
            ? `${name} sign-in isn't switched on yet. Try another option.`
            : `Couldn't sign in with ${name}. Please try again.`,
      )
    } finally {
      setSigningIn('')
    }
  }

  /**
   * Phone — the seller types the number once (above) and one code does double duty:
   * it creates/logs into the account AND verifies the number.
   */
  const sendPhoneCode = async () => {
    if (!whatsappIsValid) {
      setSignInError('Type your phone number above first — then tap this.')
      return
    }
    setSigningIn('Phone')
    setSignInError('')
    try {
      const verifier = createRecaptchaVerifier('setup-recaptcha')
      const result = await signInWithPhoneNumber(auth, getFullWhatsapp(), verifier)
      confirmationRef.current = result
      setCodeSent(true)
    } catch (err) {
      const code = (err as { code?: string })?.code || ''
      console.error('Phone sign-in failed:', err)
      setSignInError(
        code === 'auth/operation-not-allowed'
          ? "Phone sign-in isn't switched on yet — use Google, Facebook or Apple instead."
          : code === 'auth/invalid-phone-number'
            ? 'That phone number looks wrong — check the country code and the number.'
            : 'Could not send the code. Check your connection and try again.',
      )
    } finally {
      setSigningIn('')
    }
  }

  const confirmPhoneCode = async () => {
    if (!confirmationRef.current) {
      setSignInError('That code expired — request a new one.')
      return
    }
    setSigningIn('Phone')
    setSignInError('')
    try {
      await confirmationRef.current.confirm(smsCode)
      handleAuthSuccess()
    } catch (err) {
      const code = (err as { code?: string })?.code || ''
      console.error('Phone code failed:', err)
      setSignInError(code === 'auth/invalid-verification-code' ? 'Wrong code — try again.' : 'Verification failed. Please try again.')
    } finally {
      setSigningIn('')
    }
  }

  const switchAccount = async () => {
    try {
      await auth.signOut()
    } catch (err) {
      console.warn('Sign out failed:', err)
    }
    setSignedInUid(null)
    setPhoneVerified(false)
    setCodeSent(false)
    setSmsCode('')
  }

  /**
   * What's still missing, so the Create button is never a silent dead end.
   * Each item knows which step fixes it.
   */
  const missing: { label: string; step: number }[] = []
  if (!businessName.trim() || storeHandle.length < 3) missing.push({ label: 'Shop name & link', step: 1 })
  if (!bio.trim()) missing.push({ label: 'What do you sell?', step: 1 })
  if (!nationality) missing.push({ label: 'Country', step: 2 })
  if (!whatsappIsValid) missing.push({ label: 'Phone number', step: 3 })
  if (!signedInUid) missing.push({ label: 'Sign in to save your shop', step: 3 })
  const isFormReady = missing.length === 0

  // ── Celebration: a real payoff instead of a silent redirect ──────────────
  if (createdSlug) {
    const shopUrl = `${window.location.origin}/store/${createdSlug}`
    const shareText = `Buy from my shop on rachett: ${shopUrl}`
    return (
      <div style={{ minHeight: '100vh', background: '#f9f9f9', fontFamily: 'sans-serif', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
        <div style={{ background: '#fff', borderRadius: '16px', padding: '32px', maxWidth: '460px', width: '100%', textAlign: 'center', boxShadow: '0 2px 12px rgba(0,0,0,0.08)' }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#adff2f', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 30, margin: '0 auto 16px' }}>🎉</div>
          <h1 style={{ fontSize: '22px', fontWeight: 800, margin: '0 0 8px', color: '#1a1a1a' }}>Your shop is live!</h1>
          <p style={{ color: '#666', fontSize: '14px', margin: '0 0 16px' }}>
            <strong>{businessName || storeHandle}</strong> is open for business.
          </p>
          <div style={{ background: '#f5f5f5', border: '1px dashed #ddd', borderRadius: '10px', padding: '12px', marginBottom: '18px', wordBreak: 'break-all', fontSize: '14px', color: '#333', fontWeight: 600 }}>
            {shopUrl}
          </div>
          <a href={`https://wa.me/?text=${encodeURIComponent(shareText)}`} target="_blank" rel="noreferrer"
            style={{ display: 'block', width: '100%', padding: '14px', background: '#25D366', color: '#fff', borderRadius: '8px', fontWeight: 700, textDecoration: 'none', fontSize: '16px', marginBottom: '10px', boxSizing: 'border-box' }}>
            Share on WhatsApp
          </a>
          <button onClick={() => navigate('/products')}
            style={{ width: '100%', padding: '14px', background: '#1a1a1a', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 700, fontSize: '16px', cursor: 'pointer', marginBottom: '10px' }}>
            Add your first product →
          </button>
          <p style={{ color: '#888', fontSize: '12px', margin: '0 0 12px' }}>
            Buyers find shops by their products — one product is enough to start.
          </p>
          <button onClick={() => navigate('/dashboard')}
            style={{ width: '100%', padding: '10px', background: 'transparent', color: '#888', border: 'none', cursor: 'pointer', fontSize: '14px' }}>
            Go to my Dashboard
          </button>
        </div>
      </div>
    )
  }

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
        {/* Step Progress — 3 steps, account last */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '16px' }}>
          {[1, 2, 3].map(n => (
            <div key={n} style={{ flex: 1, height: '6px', borderRadius: '3px', background: step >= n ? '#1a1a1a' : '#e5e5e5' }} />
          ))}
        </div>
        <p style={{ fontSize: '13px', color: '#888', margin: '0 0 20px', fontWeight: '600' }}>
          Step {step} of {totalSteps} — {step === 1 ? 'Your shop' : step === 2 ? 'About you' : 'Save your shop'}
        </p>

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
        <h2 style={{ fontSize: '19px', fontWeight: '800', margin: '0 0 6px', color: '#1a1a1a' }}>Save your shop</h2>
        <p style={{ fontSize: '14px', color: '#666', margin: '0 0 16px', lineHeight: 1.5 }}>
          Sign in so this shop is yours — choose whatever is easiest.
        </p>

        {/* Phone number — ONE field. If they sign in with phone, the code sent here
            verifies it; otherwise it's the payout/contact number. */}
        {(!phoneVerified || !whatsappIsValid) && (
          <>
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

          </>
        )}

        {phoneVerified && (
          <div style={{ marginBottom: '16px', padding: '10px 12px', background: '#e8f5e9', borderRadius: '8px', border: '1px solid #c8e6c9', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ color: '#2e7d32', fontSize: '16px' }}>✓</span>
            <span style={{ color: '#2e7d32', fontSize: '13px', fontWeight: '600' }}>Phone verified — {getFullWhatsapp()}</span>
          </div>
        )}

        {/* How do you want to sign in? — inline, no pop-ups */}
        {signedInUid ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '16px', padding: '10px 12px', background: '#e8f5e9', borderRadius: '8px', border: '1px solid #c8e6c9' }}>
            <span style={{ color: '#2e7d32', fontSize: '13px', fontWeight: '700' }}>
              ✓ Signed in{auth.currentUser?.email ? ` as ${auth.currentUser.email}` : auth.currentUser?.phoneNumber ? ` as ${auth.currentUser.phoneNumber}` : ''}
            </span>
            <button onClick={switchAccount}
              style={{ background: 'transparent', border: 'none', color: '#2e7d32', cursor: 'pointer', fontSize: '12px', textDecoration: 'underline' }}>
              Not you?
            </button>
          </div>
        ) : (
          <div style={{ marginBottom: '16px', padding: '14px', background: '#f8f8f8', borderRadius: '8px', border: '1px solid #eee' }}>
            <p style={{ fontSize: '13px', color: '#444', margin: '0 0 10px', fontWeight: '700' }}>How do you want to sign in?</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <button onClick={() => socialSignIn(googleProvider, 'Google')} disabled={!!signingIn}
                style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', padding: '12px', background: '#fff', color: '#000', border: '1px solid #ddd', borderRadius: '8px', fontWeight: '700', cursor: signingIn ? 'not-allowed' : 'pointer', fontSize: '14px' }}>
                <img src="https://www.google.com/favicon.ico" width="18" alt="" />
                {signingIn === 'Google' ? 'Signing in…' : 'Continue with Google'}
              </button>
              <button onClick={() => socialSignIn(facebookProvider, 'Facebook')} disabled={!!signingIn}
                style={{ width: '100%', padding: '12px', background: '#1877F2', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: signingIn ? 'not-allowed' : 'pointer', fontSize: '14px' }}>
                {signingIn === 'Facebook' ? 'Signing in…' : 'Continue with Facebook'}
              </button>
              <button onClick={() => socialSignIn(appleProvider, 'Apple')} disabled={!!signingIn}
                style={{ width: '100%', padding: '12px', background: '#000', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: signingIn ? 'not-allowed' : 'pointer', fontSize: '14px' }}>
                {signingIn === 'Apple' ? 'Signing in…' : 'Continue with Apple'}
              </button>
              <button onClick={sendPhoneCode} disabled={!!signingIn}
                style={{ width: '100%', padding: '12px', background: '#1a1a1a', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: signingIn ? 'not-allowed' : 'pointer', fontSize: '14px' }}>
                {signingIn === 'Phone' ? 'Sending code…' : 'Use my phone number'}
              </button>
            </div>

            {codeSent && (
              <div style={{ marginTop: '12px' }}>
                <p style={{ fontSize: '13px', color: '#333', margin: '0 0 6px' }}>
                  We sent a 6-digit code to <strong>{getFullWhatsapp()}</strong>
                </p>
                <input value={smsCode} onChange={e => setSmsCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="123456" inputMode="numeric"
                  style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #ddd', marginBottom: '8px', fontSize: '20px', textAlign: 'center', letterSpacing: '8px', boxSizing: 'border-box' }} />
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={confirmPhoneCode} disabled={!!signingIn || smsCode.length < 6}
                    style={{ flex: 1, padding: '12px', background: (signingIn || smsCode.length < 6) ? '#ccc' : '#4CAF50', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: (signingIn || smsCode.length < 6) ? 'not-allowed' : 'pointer', fontSize: '14px' }}>
                    {signingIn === 'Phone' ? 'Checking…' : 'Verify & continue'}
                  </button>
                  <button onClick={sendPhoneCode} disabled={!!signingIn}
                    style={{ padding: '12px 16px', background: 'transparent', color: '#666', border: '1px solid #ddd', borderRadius: '8px', cursor: signingIn ? 'not-allowed' : 'pointer', fontSize: '13px' }}>
                    Resend
                  </button>
                </div>
              </div>
            )}

            {signInError && <p style={{ color: '#c33', fontSize: '12px', margin: '10px 0 0' }}>{signInError}</p>}
            {/* Firebase needs this invisible reCAPTCHA slot for phone sign-in */}
            <div id="setup-recaptcha" />
          </div>
        )}

        <p style={{ fontSize: '11px', color: '#888', margin: '0 0 16px' }}>
          Your number is private — we use it for verification, security and paying you. It is never shown to buyers, and buyers can always reach you through your Inbox.
        </p>

          </>
        )}
        {step === 3 && (
          <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
            <button onClick={() => setStep(2)}
              style={{ flex: 1, padding: '14px', background: '#f0f0f0', color: '#333', border: '1px solid #ddd', borderRadius: '8px', fontSize: '16px', fontWeight: '600', cursor: 'pointer' }}>
              ← Back
            </button>
          </div>
        )}

        {step === 2 && (
          <>
        {/* Country — no assumptions; the seller picks it */}
        <label style={{ fontSize: '14px', fontWeight: '600', color: '#333' }}>Country</label>
        <p style={{ fontSize: '12px', color: '#888', margin: '4px 0 8px' }}>Where are you selling from?</p>
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
          <button onClick={() => setStep(2)}
            style={{ flex: 1, padding: '14px', background: '#f0f0f0', color: '#333', border: '1px solid #ddd', borderRadius: '8px', fontSize: '16px', fontWeight: '600', cursor: 'pointer' }}>
            ← Back
          </button>
          <button onClick={handleSubmit} disabled={loading || uploadingId || !isFormReady}
            style={{ flex: 2, padding: '14px', background: loading || uploadingId || !isFormReady ? '#ccc' : '#1a1a1a', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '16px', fontWeight: '600', cursor: loading || uploadingId || !isFormReady ? 'not-allowed' : 'pointer' }}>
            {loading || uploadingId ? 'Creating...' : 'Create My Shop'}
          </button>
        </div>
          </>
        )}
      </div>
    </div>
  )
}

export default SetupStore