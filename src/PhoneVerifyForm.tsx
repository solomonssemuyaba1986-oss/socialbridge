/**
 * One reusable "text me a code" form.
 *
 * The account-strength screen uses it to add a phone to a Google account. It goes through the
 * same server as the seller wizard (`sendOtp` → `/api/otp/send`, then `verifyOtp` →
 * `/api/otp/verify`), so there is one proof of a number in the app, not two.
 *
 * The country rule is checked *before* a code is requested, using the same `src/phone.ts` table
 * the server checks again. A number that cannot receive an SMS therefore fails on the screen,
 * with a sentence that says why, instead of costing a credit.
 */
import { useState } from 'react'
import { signInWithCustomToken } from 'firebase/auth'
import { auth } from './firebase'
import { COUNTRY_CODES, type CountryCode } from './countryCodes'
import { formatFull, lengthHint, validatePhone } from './phone'
import { sendOtp, verifyOtp } from './otpClient'
import { useSmsOtpListener } from './useSmsOtp'
import { trackEvent } from './analytics'

const green = '#adff2f'
const DEFAULT_COUNTRY = COUNTRY_CODES.find(country => country.dialCode === '+256') || COUNTRY_CODES[0]

type Props = {
  idPrefix: string
  /** Where the ask came from — analytics only, never a person. */
  method: 'account-strength' | 'account-signin'
  onVerified: (result: { phone: string; created: boolean }) => void | Promise<void>
  ctaLabel?: string
  disabled?: boolean
}

export default function PhoneVerifyForm({ idPrefix, method, onVerified, ctaLabel, disabled }: Props) {
  const [country, setCountry] = useState<CountryCode>(DEFAULT_COUNTRY)
  const [number, setNumber] = useState('')
  const [showCountries, setShowCountries] = useState(false)
  const [search, setSearch] = useState('')
  const [sent, setSent] = useState(false)
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const smsOtp = useSmsOtpListener(filled => {
    setCode(filled)
    setError('')
  })

  const fullNumber = () => {
    const check = validatePhone(country.dialCode, number, country.name)
    return check.ok ? formatFull(country.dialCode, check.digits) : ''
  }

  const resetCode = () => {
    smsOtp.stop()
    setSent(false)
    setCode('')
  }

  const changeCountry = (next: CountryCode) => {
    setCountry(next)
    setShowCountries(false)
    setSearch('')
    setError('')
    resetCode()
  }

  const sendCode = async () => {
    const check = validatePhone(country.dialCode, number, country.name)
    if (!check.ok) {
      setError(check.message || 'Enter your phone number.')
      return
    }
    setBusy(true)
    setError('')
    setCode('')
    // Start waiting from the same tap that asks for the code, before the network call. A text can
    // arrive while the provider is still answering; listening afterwards would miss it.
    smsOtp.listen()
    let accepted = false
    try {
      const result = await sendOtp(formatFull(country.dialCode, check.digits))
      if (!result.ok) {
        setError(result.error)
        return
      }
      accepted = true
      setSent(true)
      trackEvent('phone_verification_sent', { country: country.name, method })
    } finally {
      if (!accepted) smsOtp.stop()
      setBusy(false)
    }
  }

  const confirmCode = async () => {
    smsOtp.stop()
    if (!/^\d{6}$/.test(code)) {
      setError('Enter the 6-digit code from your text message.')
      return
    }
    const phone = fullNumber()
    if (!phone) {
      setError('Check your phone number and request a new code.')
      resetCode()
      return
    }
    setBusy(true)
    setError('')
    try {
      const current = auth.currentUser
      const result = await verifyOtp(phone, code, {
        idToken: current ? await current.getIdToken() : '',
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      if (!auth.currentUser) await signInWithCustomToken(auth, result.token)
      trackEvent('phone_verified', { country: country.name, method })
      await onVerified({ phone: result.phone, created: result.created })
    } catch (err) {
      console.warn('Phone verification failed:', err)
      setError('We could not finish verifying that number. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const countries = COUNTRY_CODES.filter(entry => (
    !search
    || entry.name.toLowerCase().includes(search.toLowerCase())
    || entry.dialCode.includes(search)
  ))

  return (
    <div>
      <div style={{ position: 'relative', marginBottom: 8 }}>
        <button type="button" onClick={() => setShowCountries(open => !open)}
          aria-expanded={showCountries}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px',
            background: '#111', color: '#ddd', border: '1px solid #333', borderRadius: 10,
            cursor: 'pointer', fontSize: 14, fontWeight: 700,
          }}>
          <span>{country.flag}</span>
          <span>{country.name}</span>
          <span style={{ marginLeft: 'auto', color: '#777' }}>{country.dialCode} ▾</span>
        </button>
        {showCountries && (
          <div style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 20,
            background: '#1a1a1a', border: '1px solid #333', borderRadius: 10, overflow: 'hidden',
          }}>
            <input value={search} onChange={event => setSearch(event.target.value)}
              placeholder="Search country…" autoFocus
              style={{
                width: '100%', padding: '10px 12px', border: 'none', borderBottom: '1px solid #333',
                outline: 'none', background: '#111', color: '#fff', fontSize: 13, boxSizing: 'border-box',
              }} />
            <div style={{ maxHeight: 190, overflowY: 'auto' }}>
              {countries.map(entry => (
                <button key={entry.dialCode + entry.name} type="button" onClick={() => changeCountry(entry)}
                  style={{
                    width: '100%', display: 'flex', gap: 8, alignItems: 'center', padding: '10px 12px',
                    background: entry.dialCode === country.dialCode ? '#0d1d0d' : 'transparent',
                    color: entry.dialCode === country.dialCode ? green : '#aaa', border: 'none',
                    cursor: 'pointer', fontSize: 13, textAlign: 'left',
                  }}>
                  <span>{entry.flag}</span>
                  <span style={{ flex: 1 }}>{entry.name}</span>
                  <span style={{ color: '#666' }}>{entry.dialCode}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {!sent ? (
        <>
          <div style={{ display: 'flex', border: '1px solid #333', borderRadius: 10, overflow: 'hidden', background: '#111' }}>
            <span style={{ padding: '12px 12px', borderRight: '1px solid #333', color: '#999', fontSize: 14, fontWeight: 700 }}>
              {country.dialCode}
            </span>
            <input
              id={`${idPrefix}-phone`}
              value={number}
              onChange={event => { setNumber(event.target.value.replace(/[^\d\s()-]/g, '').slice(0, 20)); setError(''); resetCode() }}
              inputMode="tel"
              autoComplete="tel"
              placeholder="Phone number"
              style={{ flex: 1, minWidth: 0, padding: '12px', border: 'none', outline: 'none', background: '#111', color: '#fff', fontSize: 15 }}
            />
          </div>
          <p style={{ margin: '6px 0 10px', color: '#666', fontSize: 11 }}>{lengthHint(country.dialCode, country.name)}</p>
          {error && <p role="alert" style={{ margin: '0 0 10px', color: '#ff6b6b', fontSize: 12, lineHeight: 1.5 }}>{error}</p>}
          <button type="button" onClick={() => void sendCode()} disabled={busy || disabled}
            style={{
              width: '100%', padding: '13px 16px', border: 'none', borderRadius: 10,
              background: busy || disabled ? '#333' : green, color: '#000', fontWeight: 900,
              fontSize: 14, cursor: busy || disabled ? 'not-allowed' : 'pointer',
            }}>
            {busy ? 'Sending code…' : ctaLabel || 'Text me a code'}
          </button>
        </>
      ) : (
        <>
          <p style={{ margin: '0 0 8px', color: '#aaa', fontSize: 13, lineHeight: 1.5 }}>
            A 6-digit code was sent to <strong style={{ color: '#fff' }}>{fullNumber()}</strong>.
          </p>
          <input
            id={`${idPrefix}-code`}
            value={code}
            onChange={event => { setCode(event.target.value.replace(/\D/g, '').slice(0, 6)); setError('') }}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="000000"
            aria-label="6-digit code"
            style={{
              width: '100%', boxSizing: 'border-box', padding: '14px', marginBottom: 6,
              border: '1px solid #333', borderRadius: 10, background: '#111', color: '#fff',
              fontSize: 24, letterSpacing: 8, textAlign: 'center',
            }}
          />
          <p aria-live="polite" style={{
            margin: '0 0 10px', color: smsOtp.status === 'filled' ? green : '#777',
            fontSize: 11, lineHeight: 1.5,
          }}>
            {smsOtp.hint}
          </p>
          {error && <p role="alert" style={{ margin: '0 0 10px', color: '#ff6b6b', fontSize: 12, lineHeight: 1.5 }}>{error}</p>}
          <button type="button" onClick={() => void confirmCode()} disabled={busy || disabled || code.length !== 6}
            style={{
              width: '100%', padding: '13px 16px', border: 'none', borderRadius: 10,
              background: busy || disabled || code.length !== 6 ? '#333' : green, color: '#000',
              fontWeight: 900, fontSize: 14, cursor: busy || disabled || code.length !== 6 ? 'not-allowed' : 'pointer',
            }}>
            {busy ? 'Verifying…' : 'Verify number'}
          </button>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button type="button" onClick={() => void sendCode()} disabled={busy}
              style={{ flex: 1, padding: '10px', background: 'transparent', color: '#aaa', border: '1px solid #333', borderRadius: 10, cursor: busy ? 'not-allowed' : 'pointer', fontSize: 12, fontWeight: 700 }}>
              Resend code
            </button>
            <button type="button" onClick={() => { resetCode(); setError('') }}
              style={{ flex: 1, padding: '10px', background: 'transparent', color: '#aaa', border: '1px solid #333', borderRadius: 10, cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
              Change number
            </button>
          </div>
        </>
      )}
    </div>
  )
}

