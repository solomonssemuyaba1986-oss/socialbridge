import { useState, useRef, useEffect } from 'react'
import { signInWithPopup, signInWithRedirect, signInWithPhoneNumber } from 'firebase/auth'
import type { AuthProvider, ConfirmationResult } from 'firebase/auth'
import { auth, db, googleProvider, facebookProvider, appleProvider, createRecaptchaVerifier } from './firebase'
import { useNavigate, useLocation } from 'react-router-dom'
import { collection, query, where, getDocs, doc, updateDoc } from 'firebase/firestore'

const OTP_SERVER_URL = import.meta.env.VITE_OTP_SERVER_URL || 'http://localhost:3001'

interface SavedUser {
  displayName: string | null
  email: string | null
  photoURL: string | null
  uid: string
}

function getSavedUser(): SavedUser | null {
  try {
    const raw = localStorage.getItem('rachett_last_user')
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function SignIn() {
  const navigate = useNavigate()
  const location = useLocation()
  const [authLoading, setAuthLoading] = useState(false)
  const [savedUser, setSavedUser] = useState<SavedUser | null>(getSavedUser)
  const providerSectionRef = useRef<HTMLDivElement | null>(null)
  const green = '#adff2f'

  // Scroll to sign-up buttons when coming from "Sign up" clicks
  useEffect(() => {
    if (location.hash === '#signup' && providerSectionRef.current) {
      setTimeout(() => {
        providerSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 300)
    }
  }, [location.hash])

  // Phone auth state
  const [phoneNumber, setPhoneNumber] = useState('')
  const [phoneOtpSent, setPhoneOtpSent] = useState(false)
  const [phoneOtp, setPhoneOtp] = useState('')
  const [phoneOtpLoading, setPhoneOtpLoading] = useState(false)
  const [phoneOtpError, setPhoneOtpError] = useState('')
  const [confirmationResult, setConfirmationResult] = useState<ConfirmationResult | null>(null)

  // Recovery modal state
  const [showRecoveryModal, setShowRecoveryModal] = useState(false)
  const [recoveryEmailInput, setRecoveryEmailInput] = useState('')
  const [recoveryStep, setRecoveryStep] = useState<'email' | 'found' | 'newPhone' | 'otp' | 'done'>('email')
  const [recoverySellerId, setRecoverySellerId] = useState('')
  const [recoveryBusinessName, setRecoveryBusinessName] = useState('')
  const [recoveryNewPhone, setRecoveryNewPhone] = useState('')
  const [recoveryOtp, setRecoveryOtp] = useState('')
  const [recoveryLoading, setRecoveryLoading] = useState(false)
  const [recoveryError, setRecoveryError] = useState('')

  const handleScrollToProviders = () => {
    providerSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const handleSignInWithProvider = async (provider: AuthProvider) => {
    setAuthLoading(true)
    try {
      await signInWithPopup(auth, provider)
      navigate('/onboarding')
    } catch (error: unknown) {
      console.error('Provider sign-in error:', error)
      const err = error as { code?: string }
      if (err?.code === 'auth/popup-blocked' || err?.code === 'auth/operation-not-supported-in-this-environment') {
        try {
          await signInWithRedirect(auth, provider)
        } catch (redirectError) {
          console.error('Redirect fallback failed:', redirectError)
          alert('Oops! Sign in failed. Please allow popups or try again in a browser tab.')
        }
      } else {
        alert('Oops! Try again.')
      }
    } finally {
      setAuthLoading(false)
    }
  }

  const handleGoogleSignIn = () => handleSignInWithProvider(googleProvider)
  const handleFacebookSignIn = () => handleSignInWithProvider(facebookProvider)
  const handleAppleSignIn = () => handleSignInWithProvider(appleProvider)

  const handleContinueAsSaved = async () => {
    setAuthLoading(true)
    try {
      await signInWithPopup(auth, googleProvider)
      navigate('/onboarding')
    } catch (error: unknown) {
      console.error('Re-auth error:', error)
      alert('Could not sign you in automatically. Please sign in again.')
    } finally {
      setAuthLoading(false)
    }
  }

  const handleUseDifferentAccount = () => {
    localStorage.removeItem('rachett_last_user')
    setSavedUser(null)
  }

  // -- Phone Auth handlers --
  const handlePhoneChange = (val: string) => {
    const digits = val.replace(/\D/g, '').slice(0, 9)
    setPhoneNumber(digits)
    setPhoneOtpError('')
    // Reset OTP state when number changes
    if (digits !== phoneNumber) {
      setPhoneOtpSent(false)
      setPhoneOtp('')
      setConfirmationResult(null)
    }
  }

  const handleSendPhoneOtp = async () => {
    if (phoneNumber.length !== 9 || !/^7\d{8}$/.test(phoneNumber)) {
      setPhoneOtpError('Enter a valid Uganda number starting with 7')
      return
    }
    setPhoneOtpLoading(true)
    setPhoneOtpError('')
    const fullNumber = `+256${phoneNumber}`
    try {
      const recaptchaVerifier = createRecaptchaVerifier('phone-recaptcha-container')
      const result = await signInWithPhoneNumber(auth, fullNumber, recaptchaVerifier)
      setConfirmationResult(result)
      setPhoneOtpSent(true)
      console.log(`[Phone Auth] OTP sent to ${fullNumber}`)
    } catch (err: any) {
      console.error('Phone OTP send error:', err)
      if (err?.code === 'auth/too-many-requests') {
        setPhoneOtpError('Too many attempts. Wait a moment and try again.')
      } else if (err?.code === 'auth/invalid-phone-number') {
        setPhoneOtpError('Invalid phone number format.')
      } else {
        setPhoneOtpError('Failed to send code. Check your number and try again.')
      }
    } finally {
      setPhoneOtpLoading(false)
    }
  }

  const handleVerifyPhoneOtp = async () => {
    if (!phoneOtp || phoneOtp.length < 6) {
      setPhoneOtpError('Enter the 6-digit code')
      return
    }
    if (!confirmationResult) {
      setPhoneOtpError('Session expired. Request a new code.')
      setPhoneOtpSent(false)
      return
    }
    setPhoneOtpLoading(true)
    setPhoneOtpError('')
    try {
      await confirmationResult.confirm(phoneOtp)
      navigate('/onboarding')
    } catch (err: any) {
      console.error('Phone OTP verify error:', err)
      if (err?.code === 'auth/invalid-verification-code') {
        setPhoneOtpError('Wrong code. Check and try again.')
      } else if (err?.code === 'auth/code-expired') {
        setPhoneOtpError('Code expired. Request a new one.')
        setPhoneOtpSent(false)
        setConfirmationResult(null)
      } else {
        setPhoneOtpError('Verification failed. Try again.')
      }
    } finally {
      setPhoneOtpLoading(false)
    }
  }

  // -- Recovery flow handlers --
  const handleRecoveryLookup = async () => {
    if (!recoveryEmailInput || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recoveryEmailInput)) {
      setRecoveryError('Enter a valid email address')
      return
    }
    setRecoveryLoading(true)
    setRecoveryError('')
    try {
      const q = query(collection(db, 'sellers'), where('recoveryEmail', '==', recoveryEmailInput.toLowerCase().trim()))
      const snapshot = await getDocs(q)
      if (snapshot.empty) {
        setRecoveryError('No account found with that recovery email.')
      } else {
        const sellerData = snapshot.docs[0]
        setRecoverySellerId(sellerData.id)
        setRecoveryBusinessName(sellerData.data().businessName || 'Your store')
        setRecoveryStep('found')
      }
    } catch (err) {
      console.error('Recovery lookup error:', err)
      setRecoveryError('Something went wrong. Try again.')
    } finally {
      setRecoveryLoading(false)
    }
  }

  const handleRecoverySendOtp = async () => {
    if (recoveryNewPhone.length !== 9 || !/^7\d{8}$/.test(recoveryNewPhone)) {
      setRecoveryError('Enter a valid Uganda number')
      return
    }
    setRecoveryLoading(true)
    setRecoveryError('')
    const normalized = `+256${recoveryNewPhone}`
    try {
      const res = await fetch(`${OTP_SERVER_URL}/api/otp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: normalized }),
      })
      const data = await res.json()
      if (!res.ok) {
        setRecoveryError(data.error || 'Failed to send code')
      } else {
        setRecoveryStep('otp')
      }
    } catch {
      setRecoveryError('Network error. Check your connection.')
    } finally {
      setRecoveryLoading(false)
    }
  }

  const handleRecoveryVerifyOtp = async () => {
    if (!recoveryOtp || recoveryOtp.length < 6) {
      setRecoveryError('Enter the 6-digit code')
      return
    }
    const normalized = `+256${recoveryNewPhone}`
    setRecoveryLoading(true)
    setRecoveryError('')
    try {
      const res = await fetch(`${OTP_SERVER_URL}/api/otp/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: normalized, otp: recoveryOtp }),
      })
      const data = await res.json()
      if (!res.ok) {
        setRecoveryError(data.error || 'Invalid code')
      } else {
        // Update the seller's phone number
        const fullNumber = `256${recoveryNewPhone}`
        await updateDoc(doc(db, 'sellers', recoverySellerId), {
          whatsapp: fullNumber,
          phoneVerified: true,
        })
        setRecoveryStep('done')
      }
    } catch (err) {
      console.error('Recovery verify error:', err)
      setRecoveryError('Verification failed. Try again.')
    } finally {
      setRecoveryLoading(false)
    }
  }

  const closeRecoveryModal = () => {
    setShowRecoveryModal(false)
    setRecoveryStep('email')
    setRecoveryEmailInput('')
    setRecoveryError('')
    setRecoveryNewPhone('')
    setRecoveryOtp('')
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f0f', fontFamily: 'sans-serif', color: '#fff' }}>
      {/* Navbar */}
      <nav className="rt-topnav" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 32px', borderBottom: '1px solid #1a1a1a' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ background: green, width: '32px', height: '32px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '800', fontSize: '13px', color: '#000' }}>R</div>
          <span style={{ fontWeight: '800', fontSize: '18px' }}>Rachett</span>
        </div>
        <button onClick={handleScrollToProviders}
          style={{ background: green, color: '#000', border: 'none', padding: '10px 20px', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '14px' }}>
          Get Started →
        </button>
      </nav>

      {/* Welcome Back Banner */}
      {savedUser && (
        <div style={{
          background: '#0f2910',
          borderBottom: `1px solid ${green}`,
          padding: '24px 32px',
          textAlign: 'center',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '16px', flexWrap: 'wrap' }}>
            {savedUser.photoURL ? (
              <img src={savedUser.photoURL} alt=""
                style={{ width: '48px', height: '48px', borderRadius: '50%', border: `2px solid ${green}` }} />
            ) : (
              <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: '#222', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', border: `2px solid ${green}` }}>
                👤
              </div>
            )}
            <div>
              <p style={{ margin: '0 0 4px', fontSize: '18px', fontWeight: '800', color: '#fff' }}>
                Hey{savedUser.displayName ? ` ${savedUser.displayName}` : ''}! 👋
              </p>
              <p style={{ margin: 0, color: '#888', fontSize: '14px' }}>
                {savedUser.email ? `${savedUser.email} · ` : ''}You have an account. Want to continue?
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', marginTop: '16px' }}>
            <button onClick={handleContinueAsSaved} disabled={authLoading}
              style={{ background: green, color: '#000', border: 'none', padding: '12px 28px', borderRadius: '10px', fontWeight: '700', cursor: 'pointer', fontSize: '15px' }}>
              {authLoading ? 'Signing in...' : '✅ Yes, continue'}
            </button>
            <button onClick={handleUseDifferentAccount}
              style={{ background: 'transparent', color: '#888', border: '1px solid #333', padding: '12px 28px', borderRadius: '10px', fontWeight: '600', cursor: 'pointer', fontSize: '15px' }}>
              ❌ No, use different account
            </button>
          </div>
        </div>
      )}

      {/* Hero */}
      <div className="rt-hero" style={{ textAlign: 'center', padding: '80px 20px 60px', maxWidth: '800px', margin: '0 auto' }}>
        <div style={{ display: 'inline-block', background: '#1a1a1a', border: '1px solid #333', borderRadius: '20px', padding: '6px 16px', fontSize: '13px', color: '#888', marginBottom: '24px' }}>
          Your brand. Your audience. Across every platform. In one inbox.
        </div>
        <h1 className="rt-title-lg" style={{ fontSize: '56px', fontWeight: '900', lineHeight: '1.1', margin: '0 0 24px', letterSpacing: '-2px' }}>
          Your business<br />
          <span style={{ color: green }}>deserves a clear future</span><br />
          across social.
        </h1>
        <p style={{ fontSize: '18px', color: '#888', margin: '0 0 40px', maxWidth: '500px', marginInline: 'auto', lineHeight: '1.6' }}>
          Lost messages. Slow replies. Orders scattered across platforms. Rachett fixes all of it.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
          <div ref={providerSectionRef} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', width: '100%', maxWidth: '360px' }}>
            {/* Google */}
            <button onClick={handleGoogleSignIn}
              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', background: '#fff', color: '#000', border: 'none', padding: '16px 32px', borderRadius: '10px', fontWeight: '700', cursor: 'pointer', fontSize: '16px' }}>
              <img src="https://www.google.com/favicon.ico" width="20" alt="Google" />
              Continue with Google
            </button>

            {/* Facebook */}
            <button onClick={handleFacebookSignIn}
              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', background: '#4267B2', color: '#fff', border: 'none', padding: '16px 32px', borderRadius: '10px', fontWeight: '700', cursor: 'pointer', fontSize: '16px' }}>
              <span style={{ fontSize: '18px' }}>f</span>
              Continue with Facebook
            </button>

            {/* Apple */}
            <button onClick={handleAppleSignIn} disabled={authLoading}
              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', background: '#000', color: '#fff', border: 'none', padding: '16px 32px', borderRadius: '10px', fontWeight: '700', cursor: 'pointer', fontSize: '16px' }}>
              <span style={{ fontSize: '18px' }}></span>
              Continue with Apple
            </button>

            {/* Divider */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', width: '100%', margin: '4px 0' }}>
              <div style={{ flex: 1, height: '1px', background: '#222' }} />
              <span style={{ color: '#555', fontSize: '13px' }}>OR</span>
              <div style={{ flex: 1, height: '1px', background: '#222' }} />
            </div>

            {/* Phone Sign-In */}
            <div style={{ width: '100%', background: '#1a1a1a', borderRadius: '10px', padding: '20px', border: '1px solid #222' }}>
              <p style={{ color: '#fff', fontWeight: '700', fontSize: '14px', margin: '0 0 12px', textAlign: 'left' }}>
                📱 Sign in with phone number
              </p>

              {!phoneOtpSent ? (
                <>
                  {/* Phone input */}
                  <div style={{ display: 'flex', alignItems: 'center', border: '1px solid #333', borderRadius: '8px', overflow: 'hidden', marginBottom: '8px' }}>
                    <div style={{ background: '#111', padding: '12px 14px', fontSize: '14px', borderRight: '1px solid #333', color: '#aaa', whiteSpace: 'nowrap', fontWeight: '600' }}>
                      🇺🇬 +256
                    </div>
                    <input
                      value={phoneNumber}
                      onChange={e => handlePhoneChange(e.target.value)}
                      placeholder="771234567"
                      maxLength={9}
                      style={{ flex: 1, padding: '12px', border: 'none', outline: 'none', fontSize: '15px', background: '#111', color: '#fff' }}
                    />
                  </div>

                  {phoneOtpError && (
                    <p style={{ color: '#ff4444', fontSize: '12px', margin: '4px 0 8px' }}>{phoneOtpError}</p>
                  )}

                  <button onClick={handleSendPhoneOtp} disabled={phoneOtpLoading || phoneNumber.length !== 9}
                    style={{
                      width: '100%', padding: '12px', background: (phoneOtpLoading || phoneNumber.length !== 9) ? '#333' : green,
                      color: '#000', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: (phoneOtpLoading || phoneNumber.length !== 9) ? 'not-allowed' : 'pointer', fontSize: '15px',
                    }}>
                    {phoneOtpLoading ? 'Sending code...' : 'Send Verification Code'}
                  </button>
                </>
              ) : (
                <>
                  <p style={{ color: '#888', fontSize: '13px', margin: '0 0 10px', textAlign: 'left' }}>
                    A 6-digit code was sent to <strong style={{ color: '#fff' }}>+256{phoneNumber}</strong>
                  </p>
                  <input
                    value={phoneOtp}
                    onChange={e => setPhoneOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="000000"
                    style={{
                      width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #333',
                      marginBottom: '10px', fontSize: '20px', textAlign: 'center', letterSpacing: '8px',
                      boxSizing: 'border-box', background: '#111', color: '#fff',
                    }}
                  />

                  {phoneOtpError && (
                    <p style={{ color: '#ff4444', fontSize: '12px', margin: '4px 0 8px' }}>{phoneOtpError}</p>
                  )}

                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={handleVerifyPhoneOtp} disabled={phoneOtpLoading || phoneOtp.length < 6}
                      style={{
                        flex: 1, padding: '12px', background: (phoneOtpLoading || phoneOtp.length < 6) ? '#333' : green,
                        color: '#000', border: 'none', borderRadius: '8px', fontWeight: '700',
                        cursor: (phoneOtpLoading || phoneOtp.length < 6) ? 'not-allowed' : 'pointer', fontSize: '15px',
                      }}>
                      {phoneOtpLoading ? 'Verifying...' : 'Verify & Sign In'}
                    </button>
                    <button onClick={() => { setPhoneOtpSent(false); setPhoneOtp(''); setConfirmationResult(null); setPhoneOtpError('') }}
                      style={{
                        padding: '12px 16px', background: 'transparent', color: '#888', border: '1px solid #333',
                        borderRadius: '8px', cursor: 'pointer', fontSize: '13px',
                      }}>
                      Back
                    </button>
                  </div>
                </>
              )}
              {/* reCAPTCHA container (invisible) */}
              <div id="phone-recaptcha-container" />
            </div>

            {/* Guest Button */}
            <button onClick={() => navigate('/onboarding')}
              style={{
                width: '100%', padding: '16px 32px', background: 'transparent', color: '#aaa',
                border: '1px solid #444', borderRadius: '10px', fontWeight: '700', cursor: 'pointer', fontSize: '16px',
                marginTop: '4px',
              }}>
              Continue as guest →
            </button>

            {/* Need help link */}
            <p style={{ margin: '8px 0 0', color: '#555', fontSize: '13px' }}>
              Lost access to your phone?{' '}
              <span onClick={() => setShowRecoveryModal(true)}
                style={{ color: '#88aaff', cursor: 'pointer', textDecoration: 'underline' }}>
                Need help?
              </span>
            </p>
          </div>
        </div>

        <p style={{ color: '#444', fontSize: '13px', marginTop: '16px' }}>Start selling smarter in minutes.</p>
      </div>

      {/* Recovery Modal */}
      {showRecoveryModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
          <div style={{ background: '#1a1a1a', borderRadius: '16px', padding: '28px', width: '100%', maxWidth: '400px', border: '1px solid #222', color: '#fff' }}>
            <button onClick={closeRecoveryModal} style={{ position: 'absolute', top: '12px', right: '12px', background: 'transparent', border: 'none', color: '#555', cursor: 'pointer', fontSize: '18px' }}>✕</button>

            {recoveryStep === 'email' && (
              <>
                <h3 style={{ margin: '0 0 8px', fontSize: '18px', fontWeight: '800' }}>Recover your store</h3>
                <p style={{ margin: '0 0 16px', color: '#888', fontSize: '14px' }}>Enter the recovery email you added to your store.</p>
                <input value={recoveryEmailInput} onChange={e => setRecoveryEmailInput(e.target.value)} placeholder="you@example.com"
                  style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #333', marginBottom: '12px', boxSizing: 'border-box', fontSize: '14px', background: '#111', color: '#fff' }} />
                {recoveryError && <p style={{ color: '#ff4444', fontSize: '12px', marginBottom: '12px' }}>{recoveryError}</p>}
                <button onClick={handleRecoveryLookup} disabled={recoveryLoading}
                  style={{ width: '100%', padding: '12px', background: recoveryLoading ? '#333' : green, color: '#000', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: recoveryLoading ? 'not-allowed' : 'pointer', fontSize: '15px' }}>
                  {recoveryLoading ? 'Searching...' : 'Find My Account'}
                </button>
              </>
            )}

            {recoveryStep === 'found' && (
              <>
                <h3 style={{ margin: '0 0 8px', fontSize: '18px', fontWeight: '800' }}>✅ Account found</h3>
                <p style={{ margin: '0 0 16px', color: '#888', fontSize: '14px' }}>
                  <strong style={{ color: '#fff' }}>{recoveryEmailInput}</strong> is linked to <strong style={{ color: green }}>{recoveryBusinessName}</strong>.
                </p>
                <p style={{ margin: '0 0 16px', color: '#888', fontSize: '14px' }}>Enter your new phone number to recover your store.</p>
                <div style={{ display: 'flex', alignItems: 'center', border: '1px solid #333', borderRadius: '8px', overflow: 'hidden', marginBottom: '12px' }}>
                  <div style={{ background: '#111', padding: '12px 14px', fontSize: '14px', borderRight: '1px solid #333', color: '#aaa', fontWeight: '600' }}>🇺🇬 +256</div>
                  <input value={recoveryNewPhone} onChange={e => setRecoveryNewPhone(e.target.value.replace(/\D/g, '').slice(0, 9))} placeholder="771234567" maxLength={9}
                    style={{ flex: 1, padding: '12px', border: 'none', outline: 'none', fontSize: '15px', background: '#111', color: '#fff' }} />
                </div>
                {recoveryError && <p style={{ color: '#ff4444', fontSize: '12px', marginBottom: '12px' }}>{recoveryError}</p>}
                <button onClick={handleRecoverySendOtp} disabled={recoveryLoading || recoveryNewPhone.length !== 9}
                  style={{ width: '100%', padding: '12px', background: (recoveryLoading || recoveryNewPhone.length !== 9) ? '#333' : green, color: '#000', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: (recoveryLoading || recoveryNewPhone.length !== 9) ? 'not-allowed' : 'pointer', fontSize: '15px' }}>
                  {recoveryLoading ? 'Sending...' : 'Send Verification Code'}
                </button>
              </>
            )}

            {recoveryStep === 'otp' && (
              <>
                <h3 style={{ margin: '0 0 8px', fontSize: '18px', fontWeight: '800' }}>Verify new number</h3>
                <p style={{ margin: '0 0 16px', color: '#888', fontSize: '14px' }}>A 6-digit code was sent to <strong style={{ color: '#fff' }}>+256{recoveryNewPhone}</strong></p>
                <input value={recoveryOtp} onChange={e => setRecoveryOtp(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000"
                  style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #333', marginBottom: '12px', fontSize: '20px', textAlign: 'center', letterSpacing: '8px', boxSizing: 'border-box', background: '#111', color: '#fff' }} />
                {recoveryError && <p style={{ color: '#ff4444', fontSize: '12px', marginBottom: '12px' }}>{recoveryError}</p>}
                <button onClick={handleRecoveryVerifyOtp} disabled={recoveryLoading || recoveryOtp.length < 6}
                  style={{ width: '100%', padding: '12px', background: (recoveryLoading || recoveryOtp.length < 6) ? '#333' : green, color: '#000', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: (recoveryLoading || recoveryOtp.length < 6) ? 'not-allowed' : 'pointer', fontSize: '15px' }}>
                  {recoveryLoading ? 'Verifying...' : 'Verify & Recover'}
                </button>
              </>
            )}

            {recoveryStep === 'done' && (
              <>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ width: '56px', height: '56px', borderRadius: '50%', background: green, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', fontSize: '24px', color: '#000', fontWeight: '800' }}>✓</div>
                  <h3 style={{ margin: '0 0 8px', fontSize: '18px', fontWeight: '800', color: '#fff' }}>Store recovered!</h3>
                  <p style={{ margin: '0 0 16px', color: '#888', fontSize: '14px' }}>
                    Your phone number has been updated to <strong style={{ color: '#fff' }}>+256{recoveryNewPhone}</strong>.
                  </p>
                  <button onClick={() => { closeRecoveryModal(); navigate('/onboarding') }}
                    style={{ width: '100%', padding: '12px', background: green, color: '#000', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '15px' }}>
                    Go to Onboarding
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Problem Section */}
      <div style={{ background: '#0a0a0a', padding: '80px 20px', borderTop: '1px solid #1a1a1a' }}>
        <div style={{ maxWidth: '800px', margin: '0 auto', textAlign: 'center' }}>
          <h2 className="rt-title-md" style={{ fontSize: '42px', fontWeight: '900', margin: '0 0 16px', letterSpacing: '-1px' }}>
            The shops you love. The people you trust. All in one place<br />
            <span style={{ color: '#ff4444' }}>Get everything done with rachett.</span>
          </h2>
          <p style={{ color: '#666', fontSize: '16px', margin: '0 0 48px' }}>
            Open today. Sold out tomorrow.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
            {[
              { icon: '💬', title: 'Lost DMs', desc: 'A customer asked about a product 3 days ago. You never saw it.' },
              { icon: '⏰', title: 'Slow Replies', desc: 'By the time you respond, they\'ve already bought from someone else.' },
              { icon: '⚠️', title: 'Scattered Orders', desc: 'IG here, TikTok there, WhatsApp somewhere. Chaos everywhere.' },
            ].map(item => (
              <div key={item.title} style={{ background: '#1a0a0a', borderRadius: '12px', padding: '24px', border: '1px solid #2a1a1a', textAlign: 'left' }}>
                <div style={{ fontSize: '28px', marginBottom: '12px' }}>{item.icon}</div>
                <p style={{ fontWeight: '700', fontSize: '16px', margin: '0 0 8px', color: '#fff' }}>{item.title}</p>
                <p style={{ color: '#666', fontSize: '14px', margin: 0, lineHeight: '1.5' }}>{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* How It Works */}
      <div style={{ padding: '80px 20px', maxWidth: '800px', margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: '48px' }}>
          <h2 className="rt-title-md" style={{ fontSize: '42px', fontWeight: '900', margin: '0 0 16px', letterSpacing: '-1px' }}>Get set up in minutes.</h2>
          <p style={{ color: '#666', fontSize: '16px', margin: 0 }}>It's you, your audience, your business, and Rachett.</p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
          {[
            { num: '01', title: 'Add your link to your bio', desc: 'Paste one Rachett link on Instagram, TikTok, WhatsApp. Takes 60 seconds.' },
            { num: '02', title: 'Followers tap. They shop.', desc: 'They hit your link and land on your storefront. Products, pricing — all there.' },
            { num: '03', title: 'You manage everything from one place', desc: 'See every order, every buyer, every product in your dashboard, no matter what platform they use to find you.' },
          ].map(step => (
            <div key={step.num} style={{ display: 'flex', gap: '24px', alignItems: 'flex-start' }}>
              <div style={{ fontSize: '48px', fontWeight: '900', color: green, opacity: 0.4, lineHeight: '1', minWidth: '60px' }}>{step.num}</div>
              <div>
                <p style={{ fontWeight: '700', fontSize: '18px', margin: '0 0 8px' }}>{step.title}</p>
                <p style={{ color: '#666', fontSize: '15px', margin: 0, lineHeight: '1.6' }}>{step.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Stats */}
      <div style={{ background: '#0a0a0a', padding: '60px 20px', borderTop: '1px solid #1a1a1a', borderBottom: '1px solid #1a1a1a' }}>
        <div style={{ maxWidth: '800px', margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '32px', textAlign: 'center' }}>
          {[
            { value: 'Free', label: 'to start today' },
            { value: '2 min', label: 'to go live' },
            { value: '1 link', label: 'for all platforms' },
            { value: '0', label: 'orders lost' },
          ].map(stat => (
            <div key={stat.label}>
              <p style={{ fontSize: '40px', fontWeight: '900', color: green, margin: '0 0 8px' }}>{stat.value}</p>
              <p style={{ color: '#666', fontSize: '14px', margin: 0 }}>{stat.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* CTA */}
      <div style={{ padding: '80px 20px', textAlign: 'center' }}>
        <h2 className="rt-title-md" style={{ fontSize: '42px', fontWeight: '900', margin: '0 0 16px', letterSpacing: '-1px' }}>
          It doesn't matter where you are, or your customers
          Manage your business<br />
          <span style={{ color: green }}>from anywhere.</span>
        </h2>
        <p style={{ color: '#666', fontSize: '16px', margin: '0 0 40px' }}>
          Never lose track of your customers.
        </p>
        <button onClick={handleScrollToProviders}
          style={{ background: green, color: '#000', border: 'none', padding: '18px 40px', borderRadius: '10px', fontWeight: '800', cursor: 'pointer', fontSize: '18px' }}>
          Sign up for free →
        </button>
        <p style={{ color: '#444', fontSize: '13px', marginTop: '16px' }}>Your followers become your audience.</p>
      </div>

      {/* Footer */}
      <div style={{ borderTop: '1px solid #1a1a1a', padding: '24px', textAlign: 'center' }}>
        <p style={{ color: '#333', fontSize: '13px', margin: 0 }}>
          © 2026 <span style={{ color: green, fontWeight: '700' }}>rachett</span> — All rights reserved. <br />
        </p>
      </div>
    </div>
  )
}

export default SignIn