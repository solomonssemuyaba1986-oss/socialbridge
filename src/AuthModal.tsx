import { useState } from 'react'
import { signInWithPopup, signInWithPhoneNumber } from 'firebase/auth'
import type { AuthProvider, ConfirmationResult } from 'firebase/auth'
import { auth, googleProvider, appleProvider, facebookProvider, createRecaptchaVerifier } from './firebase'
import { COUNTRY_CODES } from './countryCodes'
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
  const [confirmationResult, setConfirmationResult] = useState<ConfirmationResult | null>(null)
  const [phoneOtpLoading, setPhoneOtpLoading] = useState(false)
  const [phoneOtpError, setPhoneOtpError] = useState('')

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

  const handleSendPhoneOtp = async () => {
    if (!phoneNumber || phoneNumber.length < 5) {
      setPhoneOtpError('Enter a valid phone number for your country')
      return
    }
    setPhoneOtpLoading(true)
    setPhoneOtpError('')
    const fullNumber = `${selectedCountry.dialCode}${phoneNumber}`
    try {
      const recaptchaVerifier = createRecaptchaVerifier('authmodal-recaptcha')
      const result = await signInWithPhoneNumber(auth, fullNumber, recaptchaVerifier)
      setConfirmationResult(result)
      setPhoneOtpSent(true)
    } catch (err: any) {
      console.error('Phone OTP send error:', err)
      setPhoneOtpError(err?.code === 'auth/invalid-phone-number'
        ? 'Invalid phone number format.'
        : 'Failed to send code. Check your number and try again.')
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
      return
    }
    setPhoneOtpLoading(true)
    setPhoneOtpError('')
    try {
      await confirmationResult.confirm(phoneOtp)
      rememberUser(auth.currentUser)
      onSuccess()
    } catch (err: any) {
      console.error('Phone OTP verify error:', err)
      setPhoneOtpError(err?.code === 'auth/invalid-verification-code'
        ? 'Wrong code. Try again.'
        : 'Verification failed. Try again.')
    } finally {
      setPhoneOtpLoading(false)
    }
  }
  return (
    <div onClick={onClose}
      style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: '#1a1a1a', borderRadius: 16, padding: '20px', maxWidth: 400, width: '100%', maxHeight: '90vh', overflowY: 'auto', textAlign: 'center', border: '1px solid #222' }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#666', fontSize: 18, cursor: 'pointer' }}>✕</button>
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

            {/* Apple */}
            <button onClick={() => handleSocialSignIn(appleProvider, 'Apple')} disabled={!!authLoading}
              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, background: '#000', color: '#fff', border: '1px solid #333', padding: '14px 24px', borderRadius: 10, fontWeight: 700, cursor: authLoading ? 'not-allowed' : 'pointer', fontSize: 15, marginBottom: 10, opacity: authLoading && authLoading !== 'Apple' ? 0.5 : 1 }}>
              <span style={{ fontSize: 18 }}></span>
              {authLoading === 'Apple' ? 'Signing in...' : 'Continue with Apple'}
            </button>

            {/* Facebook */}
            <button onClick={() => handleSocialSignIn(facebookProvider, 'Facebook')} disabled={!!authLoading}
              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, background: '#4267B2', color: '#fff', border: 'none', padding: '14px 24px', borderRadius: 10, fontWeight: 700, cursor: authLoading ? 'not-allowed' : 'pointer', fontSize: 15, marginBottom: 10, opacity: authLoading && authLoading !== 'Facebook' ? 0.5 : 1 }}>
              <span style={{ fontSize: 18 }}>f</span>
              {authLoading === 'Facebook' ? 'Signing in...' : 'Continue with Facebook'}
            </button>

            {/* Divider */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '16px 0' }}>
              <div style={{ flex: 1, height: 1, background: '#222' }} />
              <span style={{ color: '#555', fontSize: 13 }}>OR</span>
              <div style={{ flex: 1, height: 1, background: '#222' }} />
            </div>
            {/* Phone */}
            <div style={{ textAlign: 'left', marginBottom: 8 }}>
              <label style={{ color: '#aaa', fontSize: 13, fontWeight: 600, marginBottom: 8, display: 'block' }}>Phone number</label>
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
                        <div key={c.dialCode} onClick={() => { setSelectedCountry(c); setShowCountryDropdown(false); setCountrySearch('') }}
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
              <input value={phoneNumber} onChange={e => setPhoneNumber(e.target.value.replace(/\D/g, '').slice(0, 15))} placeholder="Phone number" maxLength={15}
                style={{ width: '100%', padding: '12px', borderRadius: 8, border: '1px solid #333', boxSizing: 'border-box', fontSize: 15, background: '#111', color: '#fff' }} />
            </div>

            {/* reCAPTCHA container */}
            <div id="authmodal-recaptcha" />

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
              style={{ width: '100%', padding: '12px', borderRadius: 8, border: '1px solid #333', marginBottom: 10, fontSize: 20, textAlign: 'center', letterSpacing: 8, boxSizing: 'border-box', background: '#111', color: '#fff' }} />
            <button onClick={handleVerifyPhoneOtp} disabled={phoneOtpLoading || phoneOtp.length < 6}
              style={{ width: '100%', padding: '12px', background: (phoneOtpLoading || phoneOtp.length < 6) ? '#333' : green, color: '#000', border: 'none', borderRadius: 8, fontWeight: 700, cursor: (phoneOtpLoading || phoneOtp.length < 6) ? 'not-allowed' : 'pointer', fontSize: 15 }}>
              {phoneOtpLoading ? 'Verifying...' : 'Verify & Sign In'}
            </button>
            <button onClick={() => { setPhoneOtpSent(false); setPhoneOtp(''); setConfirmationResult(null); setPhoneOtpError('') }}
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


