/**
 * One payout-number field: type a number, prove it with an SMS code, and Rachett keeps it.
 *
 * The proof is deliberately not a local checkbox. `sendOtp` texts the number through the same
 * server as sign-in, and `verifyPayoutNumber` asks that server to check the code and write the
 * verified number where only it can write it. The screen only shows what the server said.
 *
 * A code is tied to the number it was sent to. Editing the field throws the pending code away,
 * so a code for the old number can never be mistaken for proof of the new one.
 */
import { useState } from 'react'
import { auth } from './firebase'
import type { CountryCode } from './countryCodes'
import { formatFull, validatePhone } from './phone'
import { sendOtp } from './otpClient'
import { verifyPayoutNumber, type PayoutMethod } from './payoutClient'

const green = '#adff2f'

type Props = {
  idPrefix: string
  method: PayoutMethod
  label: string
  country: CountryCode
  value: string
  onChange: (value: string) => void
  /** The number the server has saved for this rail, if any. */
  verified?: { number: string; verifiedAt?: number }
  onVerified: (result: { phone: string; verifiedAt: number }) => void
  disabled?: boolean
}

export default function PayoutNumberField({
  idPrefix,
  method,
  label,
  country,
  value,
  onChange,
  verified,
  onVerified,
  disabled,
}: Props) {
  const [sentTo, setSentTo] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<'' | 'send' | 'verify'>('')

  // Dial codes can carry punctuation (e.g. '+1-684'); the phone rules and the wire format want
  // the digits with exactly one leading '+', the same shape PaymentSetup uses.
  const dial = country.dialCode.replace(/[^+\d]/g, '')
  const check = validatePhone(dial, value, country.name)
  const full = check.ok ? formatFull(dial, check.digits) : ''
  const verifiedMatch = Boolean(full && verified?.number === full)

  const resetCode = () => {
    setSentTo('')
    setCode('')
    setError('')
  }

  const changeNumber = (next: string) => {
    onChange(next)
    resetCode()
  }

  const sendCode = async () => {
    if (!check.ok) {
      setError(check.message || 'Enter a valid phone number.')
      return
    }
    setBusy('send')
    setError('')
    try {
      const sent = await sendOtp(full)
      if (!sent.ok) {
        setError(sent.error)
        return
      }
      setSentTo(full)
      setCode('')
    } finally {
      setBusy('')
    }
  }

  const confirmCode = async () => {
    if (code.length !== 6) {
      setError('Enter the 6-digit code from your text message.')
      return
    }
    if (!full || !sentTo || full !== sentTo) {
      setError('That code was sent to a different number. Send a new code to this one.')
      resetCode()
      return
    }
    const user = auth.currentUser
    if (!user) {
      setError('Sign in again to verify a payout number.')
      return
    }
    setBusy('verify')
    setError('')
    try {
      const result = await verifyPayoutNumber(full, code, method, {
        idToken: await user.getIdToken(),
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      onVerified({ phone: result.phone, verifiedAt: result.verifiedAt })
      setSentTo('')
      setCode('')
    } finally {
      setBusy('')
    }
  }

  const hint = !value
    ? `We add ${dial} for you — type it without the leading 0.`
    : !check.ok
      ? check.message || 'That number does not look right.'
      : verifiedMatch
        ? '✓ Verified and saved to your account. rachett keeps this number for payouts.'
        : verified?.number
          ? 'This is a new number. Send a code to verify and replace the saved one.'
          : 'Send a code to prove this number. It is saved only after the code is right.'

  return (
    <div style={{ marginTop: 14 }}>
      <label htmlFor={`${idPrefix}-number`} style={{ display: 'block', fontSize: 12, color: '#aaa', fontWeight: 700, marginBottom: 6 }}>
        {label}
      </label>
      <input
        id={`${idPrefix}-number`}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        placeholder="07XX XXX XXX"
        value={value}
        onChange={event => changeNumber(event.target.value.replace(/[^\d\s()+-]/g, '').slice(0, 24))}
        disabled={disabled}
        style={inputStyle}
      />
      <p
        aria-live="polite"
        style={{
          margin: '6px 0 0',
          color: !check.ok && value ? '#ff6b6b' : verifiedMatch ? green : '#666',
          fontSize: 12,
          lineHeight: 1.5,
          fontWeight: verifiedMatch ? 700 : 400,
        }}
      >
        {hint}
      </p>

      {sentTo && (
        <div style={{ marginTop: 12 }}>
          <p style={{ margin: '0 0 8px', color: '#aaa', fontSize: 12, lineHeight: 1.5 }}>
            A 6-digit code was sent to <strong style={{ color: '#fff' }}>{sentTo}</strong>.
          </p>
          <input
            id={`${idPrefix}-code`}
            value={code}
            onChange={event => { setCode(event.target.value.replace(/\D/g, '').slice(0, 6)); setError('') }}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="000000"
            aria-label={`6-digit code sent to ${sentTo}`}
            style={codeStyle}
          />
          {error && <p role="alert" style={errorStyle}>{error}</p>}
          <button type="button" onClick={() => void confirmCode()} disabled={busy !== '' || code.length !== 6}
            style={{
              width: '100%', padding: '13px 16px', border: 'none', borderRadius: 10,
              background: busy !== '' || code.length !== 6 ? '#333' : green, color: '#000',
              fontWeight: 900, fontSize: 14, cursor: busy !== '' || code.length !== 6 ? 'not-allowed' : 'pointer',
            }}>
            {busy === 'verify' ? 'Verifying…' : 'Verify & save payout number'}
          </button>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button type="button" onClick={() => void sendCode()} disabled={busy !== ''}
              style={secondaryButton}>
              {busy === 'send' ? 'Sending…' : 'Resend code'}
            </button>
            <button type="button" onClick={() => resetCode()} disabled={busy !== ''}
              style={secondaryButton}>
              Change number
            </button>
          </div>
        </div>
      )}

      {!sentTo && !verifiedMatch && (
        <>
          {error && <p role="alert" style={errorStyle}>{error}</p>}
          <button type="button" onClick={() => void sendCode()} disabled={disabled || busy !== '' || !check.ok}
            style={{
              width: '100%', marginTop: 4, padding: '13px 16px', border: 'none', borderRadius: 10,
              background: disabled || busy !== '' || !check.ok ? '#333' : green, color: '#000',
              fontWeight: 900, fontSize: 14,
              cursor: disabled || busy !== '' || !check.ok ? 'not-allowed' : 'pointer',
            }}>
            {busy === 'send' ? 'Sending code…' : 'Text me a code'}
          </button>
        </>
      )}
    </div>
  )
}

const inputStyle = {
  width: '100%',
  boxSizing: 'border-box' as const,
  padding: '14px',
  borderRadius: 12,
  border: '1px solid #333',
  background: '#111',
  color: '#fff',
  fontSize: 16,
  outline: 'none',
}

const codeStyle = {
  width: '100%',
  boxSizing: 'border-box' as const,
  padding: '14px',
  marginBottom: 8,
  borderRadius: 10,
  border: '1px solid #333',
  background: '#111',
  color: '#fff',
  fontSize: 24,
  letterSpacing: 8,
  textAlign: 'center' as const,
}

const secondaryButton = {
  flex: 1,
  padding: '10px',
  background: 'transparent',
  color: '#aaa',
  border: '1px solid #333',
  borderRadius: 10,
  fontSize: 12,
  fontWeight: 700,
  cursor: 'pointer',
}

const errorStyle = {
  margin: '0 0 8px',
  color: '#ff6b6b',
  fontSize: 12,
  lineHeight: 1.5,
}

