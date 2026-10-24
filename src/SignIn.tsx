import { useState, useRef, useEffect } from 'react'
import { signInWithPopup, signInWithRedirect, signInWithCustomToken } from 'firebase/auth'
import type { AuthProvider } from 'firebase/auth'
import { auth, db, googleProvider } from './firebase'
import { useNavigate, useLocation } from 'react-router-dom'
import { collection, getDocs, query, limit } from 'firebase/firestore'
import { notify } from './notifications'
import { rememberUser } from './userMemory'
import { COUNTRY_CODES, type CountryCode } from './countryCodes'
import { formatFull, validatePhone } from './phone'
import { sendOtp, verifyOtp } from './otpClient'
import { trackEvent } from './analytics'
import RecoveryModal from './RecoveryModal'
import ContinueAs from './ContinueAs'
import { resolveLanding, setRole, MARKET_HOME } from './role'

interface SavedUser {
  displayName: string | null
  email: string | null
  photoURL: string | null
  uid: string
  /** `google.com` / `phone`; older devices may also hold the removed providers. */
  providerId?: string
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
    const state = location.state as { scrollToProviders?: boolean } | null
    if (state?.scrollToProviders && providerSectionRef.current) {
      providerSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
      // Clean up the state so it doesn't re-scroll on remounts
      window.history.replaceState({}, document.title)
    }
  }, [location.state])

  /** Set when a guest was blocked mid-action — tells them why they're here. */
  const pendingNotice = (location.state as { pendingAction?: 'order' | 'message' | 'inbox' } | null)?.pendingAction

  /**
   * The one-tap banner is a Google popup, so it is only offered to a remembered Google account.
   * A phone account signs in with a code below; a remembered Facebook/Apple account now has no
   * provider and is not offered a button that would open the wrong account.
   */
  const savedUserIsGoogle = !!savedUser && (!savedUser.providerId || savedUser.providerId === 'google.com')

  // Phone auth state
  const [selectedCountry, setSelectedCountry] = useState<CountryCode>(
    COUNTRY_CODES.find(c => c.dialCode === '+256') || COUNTRY_CODES[0]
  )
  const [phoneNumber, setPhoneNumber] = useState('')
  const [phoneOtpSent, setPhoneOtpSent] = useState(false)
  const [phoneOtp, setPhoneOtp] = useState('')
  const [phoneOtpLoading, setPhoneOtpLoading] = useState(false)
  const [phoneOtpError, setPhoneOtpError] = useState('')
  const [showCountryDropdown, setShowCountryDropdown] = useState(false)
  const [countrySearch, setCountrySearch] = useState('')
  const [termsAgreed, setTermsAgreed] = useState(false)
  const [termsError, setTermsError] = useState('')
  const termsRef = useRef<HTMLDivElement>(null)

  // Recovery modal state
  const [showRecoveryModal, setShowRecoveryModal] = useState(false)

  // Real seller logos for the "Trusted by" ticker
  const [trustedStores, setTrustedStores] = useState<Array<{ id: string; logoUrl?: string; slug?: string; businessName?: string }>>([])

  useEffect(() => {
    let cancelled = false
    getDocs(query(collection(db, 'sellers'), limit(50)))
      .then(snap => {
        if (cancelled) return
        const stores = snap.docs
          .map(d => ({ id: d.id, ...(d.data() as { logoUrl?: string; slug?: string; businessName?: string }) }))
          .filter(s => s.logoUrl && s.slug)
          .slice(0, 12)
        setTrustedStores(stores)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const handleScrollToProviders = () => {
    providerSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const handleSignInWithProvider = async (provider: AuthProvider) => {
    if (!ensureTerms()) return
    setAuthLoading(true)
    try {
      await signInWithPopup(auth, provider)
      rememberUser(auth.currentUser)
      void routeAfterSignIn()
    } catch (error: unknown) {
      console.error('Provider sign-in error:', error)
      const err = error as { code?: string }
      if (err?.code === 'auth/popup-blocked' || err?.code === 'auth/operation-not-supported-in-this-environment') {
        try {
          await signInWithRedirect(auth, provider)
        } catch (redirectError) {
          console.error('Redirect fallback failed:', redirectError)
          alert(notify.signInFailed)
        }
      } else {
        alert(notify.somethingWentWrong)
      }
    } finally {
      setAuthLoading(false)
    }
  }

  const handleGoogleSignIn = () => handleSignInWithProvider(googleProvider)

  const handleContinueAsSaved = async () => {
    if (!ensureTerms()) return
    setAuthLoading(true)
    try {
      await signInWithPopup(auth, googleProvider)
      rememberUser(auth.currentUser)
      void routeAfterSignIn()
    } catch (error: unknown) {
      console.error('Re-auth error:', error)
      alert(notify.signInFailed)
    } finally {
      setAuthLoading(false)
    }
  }

  const handleUseDifferentAccount = () => {
    localStorage.removeItem('rachett_last_user')
    setSavedUser(null)
  }

  /**
   * After signing in: finish whatever they were blocked on (they tapped Buy or
   * Message as a guest, so we remembered it), otherwise send them to their own
   * home — sellers to the dashboard, buyers to theirs.
   */
  const routeAfterSignIn = async () => {
    const u = auth.currentUser
    const returnTo = (location.state as { returnTo?: string } | null)?.returnTo
    if (returnTo) {
      navigate(returnTo)
      return
    }
    navigate(await resolveLanding(u?.uid || null))
  }

  const ensureTerms = (): boolean => {
    if (termsAgreed) {
      setTermsError('')
      return true
    }
    setTermsError('Please accept the Terms and Conditions to continue.')
    termsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    return false
  }

  // -- Phone Auth handlers --
  // The number is proved by *our* server (`/api/otp/send` → `/api/otp/verify`), exactly like the
  // seller wizard. The server is the only thing that can attach a number to an account and mint
  // the sign-in token, so `auth.currentUser.phoneNumber` cannot be a browser invention.
  const resetPhoneCode = () => {
    setPhoneOtpSent(false)
    setPhoneOtp('')
    setPhoneOtpError('')
  }

  const handlePhoneChange = (val: string) => {
    const digits = val.replace(/\D/g, '').slice(0, 15)
    setPhoneNumber(digits)
    if (digits !== phoneNumber) resetPhoneCode()
  }

  const handleCountryChange = (country: CountryCode) => {
    setSelectedCountry(country)
    setShowCountryDropdown(false)
    setCountrySearch('')
    resetPhoneCode()
  }

  const handleSendPhoneOtp = async () => {
    if (!ensureTerms()) return
    const check = validatePhone(selectedCountry.dialCode, phoneNumber, selectedCountry.name)
    if (!check.ok) {
      setPhoneOtpError(check.message || 'Enter a valid phone number for your country.')
      return
    }
    setPhoneOtpLoading(true)
    setPhoneOtpError('')
    try {
      const sent = await sendOtp(formatFull(selectedCountry.dialCode, check.digits))
      if (!sent.ok) {
        setPhoneOtpError(sent.error)
        return
      }
      setPhoneOtpSent(true)
      setPhoneOtp('')
      trackEvent('phone_verification_sent', { country: selectedCountry.name, method: 'phone-signin' })
    } finally {
      setPhoneOtpLoading(false)
    }
  }

  const handleVerifyPhoneOtp = async () => {
    if (!/^\d{6}$/.test(phoneOtp)) {
      setPhoneOtpError('Enter the 6-digit code')
      return
    }
    const check = validatePhone(selectedCountry.dialCode, phoneNumber, selectedCountry.name)
    if (!check.ok) {
      setPhoneOtpError(check.message || 'Check your phone number and request a new code.')
      resetPhoneCode()
      return
    }
    setPhoneOtpLoading(true)
    setPhoneOtpError('')
    try {
      const verified = await verifyOtp(formatFull(selectedCountry.dialCode, check.digits), phoneOtp)
      if (!verified.ok) {
        setPhoneOtpError(verified.error)
        return
      }
      await signInWithCustomToken(auth, verified.token)
      rememberUser(auth.currentUser)
      trackEvent('phone_verified', { country: selectedCountry.name, method: 'phone-signin' })
      void routeAfterSignIn()
    } catch (err) {
      console.warn('Phone verification failed:', err)
      setPhoneOtpError('Verification failed. Please try again.')
    } finally {
      setPhoneOtpLoading(false)
    }
  }


  return (
    <div className="rt-page" style={{ minHeight: '100vh', background: '#0f0f0f', fontFamily: 'sans-serif', color: '#fff' }}>
      {/* Navbar */}
      <nav className="rt-topnav" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 32px', borderBottom: '1px solid #1a1a1a' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ background: green, width: '32px', height: '32px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '800', fontSize: '13px', color: '#000' }}>R</div>
          <span style={{ fontWeight: '800', fontSize: '18px' }}>rachett</span>
        </div>
        <button onClick={handleScrollToProviders}
          style={{ background: green, color: '#000', border: 'none', padding: '10px 20px', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '14px' }}>
          Get Started →
        </button>
      </nav>

      {/* Welcome Back Banner */}
      {savedUser && savedUserIsGoogle && (
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

      {/* They tapped Buy or Message as a guest — promise to take them back. */}
      {pendingNotice && (
        <div style={{ background: '#12210d', borderBottom: `1px solid ${green}`, padding: '14px 20px', textAlign: 'center', fontSize: '14px', fontWeight: 700 }}>
          {pendingNotice === 'inbox'
            ? "📩 Sign in to see your inbox — we'll take you straight back."
            : pendingNotice === 'order'
              ? "🛒 Sign in to finish your order — we'll take you straight back."
              : "💬 Sign in to message the seller — we'll take you straight back."}
        </div>
      )}

      {/* Hero */}
      <div className="rt-hero" style={{ textAlign: 'center', padding: '80px 20px 60px', maxWidth: '800px', margin: '0 auto' }}>
        <div style={{ display: 'inline-block', background: '#1a1a1a', border: '1px solid #333', borderRadius: '20px', padding: '6px 16px', fontSize: '13px', color: '#888', marginBottom: '24px' }}>
        people, not platforms.
        </div>
        <h1 className="rt-title-lg" style={{ fontSize: '56px', fontWeight: '900', lineHeight: '1.1', margin: '0 0 24px', letterSpacing: '-2px' }}>
          Your business<br />
          <span style={{ color: green }}>deserves a clear future</span><br />
          across social.
        </h1>
        <p style={{ fontSize: '18px', color: '#888', margin: '0 0 40px', maxWidth: '500px', marginInline: 'auto', lineHeight: '1.6' }}>
          Lost messages. Slow replies. Orders scattered across platforms. rachett fixes all of it.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
          <div ref={providerSectionRef} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', width: '100%', maxWidth: '360px' }}>
            {/* One-tap continue as */}
            <ContinueAs beforeSignIn={ensureTerms} onSuccess={() => void routeAfterSignIn()} />
            {/* Google */}
            <button onClick={handleGoogleSignIn}
              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', background: '#fff', color: '#000', border: 'none', padding: '16px 32px', borderRadius: '10px', fontWeight: '700', cursor: 'pointer', fontSize: '16px' }}>
              <img src="https://www.google.com/favicon.ico" width="20" alt="Google" />
              Continue with Google
            </button>

            {/* Trust signals */}
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '10px', fontSize: '11px', color: '#888', marginTop: '2px' }}>
              <span>🔒 Secure login</span>
              <span>·</span>
              <span>✅ Verified sellers</span>
              <span>·</span>
              <span>🛡️ Your data is safe</span>
            </div>

            {/* Divider */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', width: '100%', margin: '4px 0' }}>
              <div style={{ flex: 1, height: '1px', background: '#222' }} />
              <span style={{ color: '#555', fontSize: '13px' }}>OR</span>
              <div style={{ flex: 1, height: '1px', background: '#222' }} />
            </div>

            {/* Terms & Conditions */}
            <div ref={termsRef} style={{ width: '100%', textAlign: 'left', padding: '4px 2px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', color: '#666' }}>
                <input type="checkbox" checked={termsAgreed} onChange={e => { setTermsAgreed(e.target.checked); if (e.target.checked) setTermsError('') }} style={{ cursor: 'pointer', width: '16px', height: '16px' }} />
                I agree to{' '}
                <span onClick={e => { e.preventDefault(); e.stopPropagation(); window.open('/terms', '_blank') }} style={{ color: green, textDecoration: 'underline', cursor: 'pointer' }}>
                  rachett's Terms and Conditions
                </span>
              </label>
              {termsError && <p style={{ color: '#ff4444', fontSize: '12px', margin: '4px 0 0' }}>{termsError}</p>}
            </div>

            {/* Phone Sign-In */}
            <div style={{ width: '100%', background: '#1a1a1a', borderRadius: '10px', padding: '20px', border: '1px solid #222' }}>
              <p style={{ color: '#fff', fontWeight: '700', fontSize: '14px', margin: '0 0 4px', textAlign: 'left' }}>
                📱 Sign in with phone number
              </p>
              <p style={{ color: '#777', fontSize: 12, margin: '0 0 12px', textAlign: 'left', lineHeight: 1.5 }}>
                One number, one rachett account. Signing in with this number takes you to the account it already belongs to — it never creates a second one.
              </p>

              {!phoneOtpSent ? (
                <>
                  {/* Country code dropdown */}
                  <div style={{ position: 'relative', marginBottom: '8px' }}>
                    <div
                      onClick={() => { setShowCountryDropdown(!showCountryDropdown); setCountrySearch('') }}
                      style={{ display: 'flex', alignItems: 'center', border: '1px solid #333', borderRadius: '8px', overflow: 'hidden', cursor: 'pointer', background: '#111' }}>
                      <div style={{ padding: '12px 14px', fontSize: '14px', color: '#aaa', fontWeight: '600' }}>
                        {selectedCountry.flag} {selectedCountry.dialCode}
                      </div>
                      <span style={{ marginLeft: 'auto', marginRight: '12px', color: '#555', fontSize: '12px' }}>▼</span>
                    </div>

                    {showCountryDropdown && (
                      <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#1a1a1a', border: '1px solid #333', borderRadius: '8px', maxHeight: '220px', overflow: 'hidden', zIndex: 10, marginTop: '4px' }}>
                        <input
                          value={countrySearch}
                          onChange={e => setCountrySearch(e.target.value)}
                          placeholder="Search country..."
                          autoFocus
                          style={{ width: '100%', padding: '10px 12px', border: 'none', borderBottom: '1px solid #333', fontSize: '13px', boxSizing: 'border-box', outline: 'none', background: '#111', color: '#fff' }}
                        />
                        <div style={{ maxHeight: '180px', overflowY: 'auto' }}>
                          {COUNTRY_CODES.filter(c =>
                            !countrySearch || c.name.toLowerCase().includes(countrySearch.toLowerCase()) || c.dialCode.includes(countrySearch)
                          ).map(c => (
                            <div key={c.dialCode} onClick={() => handleCountryChange(c)}
                              style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', cursor: 'pointer', fontSize: '13px', color: selectedCountry.dialCode === c.dialCode ? green : '#aaa', background: selectedCountry.dialCode === c.dialCode ? '#0a1a0a' : 'transparent' }}>
                              <span style={{ fontSize: '16px' }}>{c.flag}</span>
                              <span style={{ flex: 1 }}>{c.name}</span>
                              <span style={{ color: '#666' }}>{c.dialCode}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Phone number input */}
                  <div style={{ display: 'flex', alignItems: 'center', border: '1px solid #333', borderRadius: '8px', overflow: 'hidden', marginBottom: '8px' }}>
                    <div style={{ background: '#111', padding: '12px 14px', fontSize: '14px', borderRight: '1px solid #333', color: '#aaa', fontWeight: '600' }}>
                      {selectedCountry.dialCode}
                    </div>
                    <input
                      value={phoneNumber}
                      onChange={e => handlePhoneChange(e.target.value)}
                      placeholder="Phone number"
                      maxLength={15}
                      style={{ flex: 1, padding: '12px', border: 'none', outline: 'none', fontSize: '15px', background: '#111', color: '#fff' }}
                    />
                  </div>

                  {phoneOtpError && (
                    <p style={{ color: '#ff4444', fontSize: '12px', margin: '4px 0 8px' }}>{phoneOtpError}</p>
                  )}

                  <button onClick={handleSendPhoneOtp} disabled={phoneOtpLoading || !phoneNumber || phoneNumber.length < 5}
                    style={{
                      width: '100%', padding: '12px', background: (phoneOtpLoading || !phoneNumber || phoneNumber.length < 5) ? '#333' : green,
                      color: '#000', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: (phoneOtpLoading || !phoneNumber || phoneNumber.length < 5) ? 'not-allowed' : 'pointer', fontSize: '15px',
                    }}>
                    {phoneOtpLoading ? 'Sending code...' : 'Send Verification Code'}
                  </button>
                </>
              ) : (
                <>
                  <p style={{ color: '#888', fontSize: '13px', margin: '0 0 10px', textAlign: 'left' }}>
                    A 6-digit code was sent to <strong style={{ color: '#fff' }}>{selectedCountry.dialCode}{phoneNumber}</strong>
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
                    <button onClick={resetPhoneCode}
                      style={{
                        padding: '12px 16px', background: 'transparent', color: '#888', border: '1px solid #333',
                        borderRadius: '8px', cursor: 'pointer', fontSize: '13px',
                      }}>
                      Back
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* Guest Button — the market is open without an account */}
            <button onClick={() => { if (ensureTerms()) { setRole('buyer'); navigate(MARKET_HOME) } }}
              style={{
                width: '100%', padding: '16px 32px', background: 'transparent', color: '#aaa',
                border: '1px solid #444', borderRadius: '10px', fontWeight: '700', cursor: 'pointer', fontSize: '16px',
                marginTop: '4px',
              }}>
              🛍️ Browse without signing in →
            </button>
            <p style={{ margin: '10px 0 0', color: '#666', fontSize: '12px', textAlign: 'center' }}>
              Browse, chat and fill your bag without an account — sign in only when you buy.
            </p>

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

      {/* Trusted Sellers Ticker */}
      {trustedStores.length > 0 && (
        <div style={{ background: '#0a0a0a', borderTop: '1px solid #1a1a1a', borderBottom: '1px solid #1a1a1a', padding: '32px 20px', overflow: 'hidden' }}>
          <style>{`
            @keyframes rachettTicker {
              0% { transform: translateX(0); }
              100% { transform: translateX(-50%); }
            }
            .rt-ticker:hover { animation-play-state: paused; }
          `}</style>
          <p style={{ textAlign: 'center', color: '#777', fontSize: '12px', fontWeight: '700', letterSpacing: '2px', textTransform: 'uppercase', margin: '0 0 20px' }}>
            sellers that trust rachett
          </p>
          <div className="rt-ticker" style={{ display: 'flex', gap: '16px', width: 'max-content', animation: 'rachettTicker 30s linear infinite' }}>
            {[...trustedStores, ...trustedStores].map((store, i) => (
              <div key={`${store.id}-${i}`} onClick={() => navigate(`/store/${store.slug}`)}
                style={{ display: 'flex', alignItems: 'center', gap: '10px', background: '#1a1a1a', border: '1px solid #222', borderRadius: '999px', padding: '6px 16px 6px 6px', cursor: 'pointer', flexShrink: 0 }}>
                <img src={store.logoUrl} alt={store.businessName || 'store'} style={{ width: 34, height: 34, borderRadius: '50%', objectFit: 'cover' }} />
                <span style={{ color: '#ccc', fontSize: '13px', fontWeight: '600', whiteSpace: 'nowrap' }}>{store.businessName || store.slug}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recovery Modal */}
      <RecoveryModal open={showRecoveryModal} onClose={() => setShowRecoveryModal(false)} />

      {/* Problem Section */}
      <div className="rt-section" style={{ background: '#0a0a0a', padding: '80px 20px', borderTop: '1px solid #1a1a1a' }}>
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
      <div className="rt-section" style={{ padding: '80px 20px', maxWidth: '800px', margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: '48px' }}>
          <h2 className="rt-title-md" style={{ fontSize: '42px', fontWeight: '900', margin: '0 0 16px', letterSpacing: '-1px' }}>Get set up in minutes.</h2>
          <p style={{ color: '#666', fontSize: '16px', margin: 0 }}>It's you, your audience, and rachett.</p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
          {[
            { num: '01', title: 'Link in bio', desc: 'Paste one rachett link on Instagram, TikTok or WhatsApp.' },
            { num: '02', title: 'They shop', desc: 'Followers land on your storefront — products, prices, all there.' },
            { num: '03', title: 'You run it', desc: 'Every order and buyer in one dashboard, from any platform.' },
          ].map(step => (
            <div key={step.num} style={{ background: '#1a1a1a', borderRadius: '12px', padding: '24px', border: '1px solid #222' }}>
              <div style={{ fontSize: '28px', fontWeight: '900', color: green, opacity: 0.5, lineHeight: '1', marginBottom: '16px' }}>{step.num}</div>
              <p style={{ fontWeight: '700', fontSize: '17px', margin: '0 0 8px' }}>{step.title}</p>
              <p style={{ color: '#666', fontSize: '14px', margin: 0, lineHeight: '1.6' }}>{step.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Stats */}
      <div className="rt-section" style={{ background: '#0a0a0a', padding: '60px 20px', borderTop: '1px solid #1a1a1a', borderBottom: '1px solid #1a1a1a' }}>
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
      <div className="rt-section" style={{ padding: '80px 20px', textAlign: 'center' }}>
        <h2 className="rt-title-md" style={{ fontSize: '42px', fontWeight: '900', margin: '0 0 16px', letterSpacing: '-1px' }}>
          It doesn't matter where you are, or your customers,
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