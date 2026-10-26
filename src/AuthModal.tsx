import { useState } from 'react'
import { signInWithPopup, signInWithCustomToken } from 'firebase/auth'
import type { AuthProvider } from 'firebase/auth'
import { auth, googleProvider } from './firebase'
import { COUNTRY_CODES, type CountryCode } from './countryCodes'
import { formatFull, validatePhone } from './phone'
import { sendOtp, verifyOtp } from './otpClient'
import { useSmsOtpListener } from './useSmsOtp'
import { trackEvent } from './analytics'
import { rememberUser } from './userMemory'
import ContinueAs from './ContinueAs'

const green = '#adff2f'

type Props = {
  open: boolean
  title?: string
  subtitle?: string
  onSuccess: () => void
  onClose: () => void
}

function AuthModal({ open, title, subtitle, onSuccess, onClose }: Props) {
  const [authLoading, setAuthLoading] = useState('')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [selectedCountry, setSelectedCountry] = useState(COUNTRY_CODES.find(c => c.dialCode === '+256') || COUNTRY_CODES[0])
  const [showCountryDropdown, setShowCountryDropdown] = useState(false)
  const [countrySearch, setCountrySearch] = useState('')
  const [phoneOtpSent, setPhoneOtpSent] = useState(false)
  const [phoneOtp, setPhoneOtp] = useState('')
  const [phoneOtpLoading, setPhoneOtpLoading] = useState(false)
  const [phoneOtpError, setPhoneOtpError] = useState('')

  const smsOtp = useSmsOtpListener(filled => {
    setPhoneOtp(filled)
    setPhoneOtpError('')
  })

  const close = () => {
    smsOtp.stop()
    onClose()
  }

  if (!open) return null

  const handleSocialSignIn = async (provider: AuthProvider, name: string) => {
    setAuthLoading(name)
    setPhoneOtpError('')
    try {
      await signInWithPopup(auth, provider)
      rememberUser(auth.currentUser)
      onSuccess()
    } catch (error: unknown) {
      console.error(`${name} sign-in error:`, error)
      const err = error as { code?: string }
      setPhoneOtpError(err?.code === 'auth/popup-blocked'
        ? 'Popup blocked. Allow popups for this site and try again.'
        : `${name} sign-in failed. Try again.`)
    } finally {
      setAuthLoading('')
    }
  }

  const resetPhoneCode = () => {
    smsOtp.stop()
    setPhoneOtpSent(false)
    setPhoneOtp('')
    setPhoneOtpError('')
  }

  const changeCountry = (country: CountryCode) => {
    setSelectedCountry(country)
    setShowCountryDropdown(false)
    setCountrySearch('')
    resetPhoneCode()
  }

  const handleSendPhoneOtp = async () => {
    const check = validatePhone(selectedCountry.dialCode, phoneNumber, selectedCountry.name)
    if (!check.ok) {
      setPhoneOtpError(check.message || 'Enter a valid phone number for your country.')
      return
    }
    setPhoneOtpLoading(true)
    setPhoneOtpError('')
    setPhoneOtp('')
    // Listen from the tap itself: the text may land before the provider's response does.
    smsOtp.listen()
    let accepted = false
    try {
      const sent = await sendOtp(formatFull(selectedCountry.dialCode, check.digits))
      if (!sent.ok) {
        setPhoneOtpError(sent.error)
        return
      }
      accepted = true
      setPhoneOtpSent(true)
      trackEvent('phone_verification_sent', { country: selectedCountry.name, method: 'phone-signin' })
    } finally {
      if (!accepted) smsOtp.stop()
      setPhoneOtpLoading(false)
    }
  }

  const handleVerifyPhoneOtp = async () => {
    smsOtp.stop()
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
      onSuccess()
    } catch (err) {
      console.warn('Phone verification failed:', err)
      setPhoneOtpError('Verification failed. Please try again.')
    } finally {
      setPhoneOtpLoading(false)
    }
  }
  return (
    <div className="rt-modal-overlay" onClick={close}
      style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: '#1a1a1a', borderRadius: 16, padding: '20px', maxWidth: 400, width: '100%', maxHeight: '90vh', overflowY: 'auto', textAlign: 'center', border: '1px solid #222' }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
          <button onClick={close} style={{ background: 'transparent', border: 'none', color: '#666', fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>

        <div style={{ width: 48, height: 48, borderRadius: '50%', background: green, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px', fontSize: 22, fontWeight: 800, color: '#000' }}>R</div>
        <h3 style={{ margin: '0 0 6px', fontSize: 20, fontWeight: 800 }}>{title || 'Create your account'}</h3>
        <p style={{ margin: '0 0 24px', color: '#888', fontSize: 14 }}>{subtitle || 'Sign in to save your store. Your details are safe.'}</p>

        {/* One-tap continue as */}
        <ContinueAs onSuccess={onSuccess} />

        {phoneOtpError && <p style={{ color: '#ff4444', fontSize: 13, margin: '0 0 12px' }}>{phoneOtpError}</p>}

        {!phoneOtpSent ? (
          <>
            {/* Google */}
            <button onClick={() => handleSocialSignIn(googleProvider, 'Google')} disabled={!!authLoading}
              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, background: '#fff', color: '#000', border: 'none', padding: '14px 24px', borderRadius: 10, fontWeight: 700, cursor: authLoading ? 'not-allowed' : 'pointer', fontSize: 15, marginBottom: 10, opacity: authLoading && authLoading !== 'Google' ? 0.5 : 1 }}>
              <img src="https://www.google.com/favicon.ico" width="20" alt="Google" />
              {authLoading === 'Google' ? 'Signing in...' : 'Continue with Google'}
            </button>

            {/* Divider */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '16px 0' }}>
              <div style={{ flex: 1, height: 1, background: '#222' }} />
              <span style={{ color: '#555', fontSize: 13 }}>OR</span>
              <div style={{ flex: 1, height: 1, background: '#222' }} />
            </div>
            {/* Phone */}
            <div style={{ textAlign: 'left', marginBottom: 8 }}>
              <label style={{ color: '#aaa', fontSize: 13, fontWeight: 600, marginBottom: 4, display: 'block' }}>Phone number</label>
              <p style={{ margin: '0 0 8px', color: '#666', fontSize: 11, lineHeight: 1.5 }}>One number, one account.</p>
              <div style={{ position: 'relative', marginBottom: 8 }}>
                <div onClick={() => setShowCountryDropdown(!showCountryDropdown)}
                  style={{ display: 'flex', alignItems: 'center', border: '1px solid #333', borderRadius: 8, overflow: 'hidden', cursor: 'pointer', background: '#111' }}>
                  <div style={{ padding: '12px 14px', fontSize: 14, color: '#aaa', fontWeight: 600 }}>{selectedCountry.flag} {selectedCountry.dialCode}</div>
                  <span style={{ marginLeft: 'auto', marginRight: 12, color: '#555', fontSize: 12 }}>▼</span>
                </div>
                {showCountryDropdown && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, maxHeight: 220, overflow: 'hidden', zIndex: 20, marginTop: 4 }}>
                    <input value={countrySearch} onChange={e => setCountrySearch(e.target.value)} placeholder="Search country..." autoFocus
                      style={{ width: '100%', padding: '10px 12px', border: 'none', borderBottom: '1px solid #333', fontSize: 13, boxSizing: 'border-box', outline: 'none', background: '#111', color: '#fff' }} />
                    <div style={{ maxHeight: 180, overflowY: 'auto' }}>
                      {COUNTRY_CODES.filter(c => !countrySearch || c.name.toLowerCase().includes(countrySearch.toLowerCase()) || c.dialCode.includes(countrySearch)).map(c => (
                        <div key={c.dialCode} onClick={() => changeCountry(c)}
                          style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', cursor: 'pointer', fontSize: 13, color: selectedCountry.dialCode === c.dialCode ? green : '#aaa', background: selectedCountry.dialCode === c.dialCode ? '#0a1a0a' : 'transparent' }}>
                          <span style={{ fontSize: 16 }}>{c.flag}</span>
                          <span style={{ flex: 1 }}>{c.name}</span>
                          <span style={{ color: '#666' }}>{c.dialCode}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <input value={phoneNumber} onChange={e => { setPhoneNumber(e.target.value.replace(/\D/g, '').slice(0, 15)); resetPhoneCode() }} placeholder="Phone number" maxLength={15}
                style={{ width: '100%', padding: '12px', borderRadius: 8, border: '1px solid #333', boxSizing: 'border-box', fontSize: 15, background: '#111', color: '#fff' }} />
            </div>

            <button onClick={handleSendPhoneOtp} disabled={phoneOtpLoading || !phoneNumber || phoneNumber.length < 5}
              style={{ width: '100%', padding: '12px', background: (phoneOtpLoading || !phoneNumber || phoneNumber.length < 5) ? '#333' : green, color: '#000', border: 'none', borderRadius: 8, fontWeight: 700, cursor: (phoneOtpLoading || !phoneNumber || phoneNumber.length < 5) ? 'not-allowed' : 'pointer', fontSize: 15 }}>
              {phoneOtpLoading ? 'Sending code...' : 'Continue with Phone'}
            </button>
          </>
        ) : (
          <>
            <p style={{ color: '#888', fontSize: 13, margin: '0 0 10px' }}>
              A 6-digit code was sent to <strong style={{ color: '#fff' }}>{selectedCountry.dialCode}{phoneNumber}</strong>
            </p>
            <input value={phoneOtp} onChange={e => setPhoneOtp(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000"
              inputMode="numeric" autoComplete="one-time-code" maxLength={6} aria-label="6-digit code"
              style={{ width: '100%', padding: '12px', borderRadius: 8, border: '1px solid #333', marginBottom: 6, fontSize: 20, textAlign: 'center', letterSpacing: 8, boxSizing: 'border-box', background: '#111', color: '#fff' }} />
            <p aria-live="polite" style={{ color: smsOtp.status === 'filled' ? green : '#777', fontSize: 12, lineHeight: 1.5, margin: '0 0 10px' }}>
              {smsOtp.hint}
            </p>
            {phoneOtpError && <p role="alert" style={{ color: '#ff6b6b', fontSize: 12, margin: '0 0 8px' }}>{phoneOtpError}</p>}
            <button onClick={handleVerifyPhoneOtp} disabled={phoneOtpLoading || phoneOtp.length < 6}
              style={{ width: '100%', padding: '12px', background: (phoneOtpLoading || phoneOtp.length < 6) ? '#333' : green, color: '#000', border: 'none', borderRadius: 8, fontWeight: 700, cursor: (phoneOtpLoading || phoneOtp.length < 6) ? 'not-allowed' : 'pointer', fontSize: 15 }}>
              {phoneOtpLoading ? 'Verifying...' : 'Verify & Sign In'}
            </button>
            <button onClick={resetPhoneCode}
              style={{ width: '100%', padding: '10px', background: 'transparent', color: '#888', border: '1px solid #333', borderRadius: 8, cursor: 'pointer', fontSize: 13, marginTop: 8 }}>
              Back
            </button>
          </>
        )}
      </div>
    </div>
  )
}

export default AuthModal


