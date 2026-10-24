import { useEffect, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { auth, db } from './firebase'
import { doc, getDoc } from 'firebase/firestore'
import { COUNTRY_CODES, type CountryCode } from './countryCodes'
import { formatFull, normaliseNational, validatePhone } from './phone'
import PayoutNumberField from './PayoutNumberField'
import { savePayoutMethods, type PayoutMethod } from './payoutClient'

const green = '#adff2f'

/** The three ways, in the order a seller should think about them. Card is display-only for now. */
type MethodId = 'mtn' | 'airtel' | 'card'

interface MethodShape {
  enabled?: boolean
  /** Legacy, browser-written copy. The new UI never displays this as proof. */
  number?: string
  verified?: boolean
  verifiedAt?: number
}

interface VerifiedAccount {
  number: string
  verifiedAt?: number
}

interface VerifiedAccounts {
  mtn?: VerifiedAccount
  airtel?: VerifiedAccount
}

const METHODS: PayoutMethod[] = ['mtn', 'airtel']
const METHOD_NAMES: Record<PayoutMethod, string> = {
  mtn: 'MTN MoMo',
  airtel: 'Airtel Money',
}

/** The number as the local field shows it: national digits, ready for `validatePhone` again. */
function nationalInput(number: string, dial: string): string {
  return normaliseNational(number, dial) || number.replace(/^\+/, '')
}

/** A thumb-sized switch. Nothing like it existed, so it lives here instead of in six files. */
function Toggle({ on, disabled, label, onChange }: {
  on: boolean
  disabled?: boolean
  label: string
  onChange: (next: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => { if (!disabled) onChange(!on) }}
      style={{
        width: 52, height: 32, borderRadius: 999, flexShrink: 0,
        border: `1px solid ${on ? green : '#333'}`,
        background: on ? green : '#1a1a1a',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        position: 'relative', padding: 0,
        transition: 'background 0.15s ease, border-color 0.15s ease',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          position: 'absolute', top: 3, left: on ? 23 : 3,
          width: 24, height: 24, borderRadius: '50%',
          background: on ? '#0f0f0f' : '#666',
          transition: 'left 0.15s ease',
        }}
      />
    </button>
  )
}

export default function PaymentSetup() {
  const navigate = useNavigate()
  const uid = auth.currentUser?.uid || ''

  const [mtnOn, setMtnOn] = useState(false)
  const [mtnNumber, setMtnNumber] = useState('')
  const [airtelOn, setAirtelOn] = useState(false)
  const [airtelNumber, setAirtelNumber] = useState('')
  const [country, setCountry] = useState<CountryCode>(() =>
    COUNTRY_CODES.find(c => c.dialCode === '+256') || COUNTRY_CODES[0])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  /** The numbers the server has proved. No local flag can put a number in here. */
  const [verified, setVerified] = useState<VerifiedAccounts>({})

  useEffect(() => {
    if (!uid) { navigate('/'); return }
    let alive = true

    const load = async () => {
      try {
        // The public seller document holds the switches. The private account document holds the
        // verified numbers — so a number cannot be read by every visitor to the shop.
        const [sellerSnap, accountSnap] = await Promise.all([
          getDoc(doc(db, 'sellers', uid)),
          getDoc(doc(db, 'payoutAccounts', uid)).catch((err) => {
            console.warn('Could not read verified payout numbers:', err)
            return null
          }),
        ])
        if (!alive) return
        if (!sellerSnap.exists()) { setLoading(false); return }

        const data = sellerSnap.data() as {
          paymentMethods?: Partial<Record<MethodId, MethodShape>>
          nationality?: string
        }

        // The seller's country decides which number is expected, read the same way EditStore reads
        // it: by name, falling back to Uganda rather than leaving the field ambiguous.
        const byName = COUNTRY_CODES.find(c => c.name === (data.nationality || '').trim())
        const chosen = byName
          || COUNTRY_CODES.find(c => c.dialCode === '+256')
          || COUNTRY_CODES[0]
        setCountry(chosen)

        const methods = data.paymentMethods || {}
        const account = (accountSnap?.data() || {}) as VerifiedAccounts
        const clean: VerifiedAccounts = {}
        for (const method of METHODS) {
          const entry = account[method]
          const at = Number(entry?.verifiedAt)
          if (entry && typeof entry.number === 'string' && entry.number && Number.isFinite(at) && at > 0) {
            clean[method] = { number: entry.number, verifiedAt: at }
          }
        }
        setVerified(clean)

        setMtnOn(methods.mtn?.enabled === true)
        setMtnNumber(nationalInput(clean.mtn?.number || methods.mtn?.number || '', chosen.dialCode))
        setAirtelOn(methods.airtel?.enabled === true)
        setAirtelNumber(nationalInput(clean.airtel?.number || methods.airtel?.number || '', chosen.dialCode))
        setLoading(false)
      } catch (err) {
        console.error('Could not read payout settings:', err)
        if (alive) {
          setError('We could not load your payout settings. Try again in a moment.')
          setLoading(false)
        }
      }
    }

    void load()
    return () => { alive = false }
  }, [uid, navigate])

  const dial = country.dialCode.replace(/[^+\d]/g, '')

  /** The full number this rail currently shows, if it passes the country rule. */
  const fullFor = (method: PayoutMethod): string => {
    const raw = method === 'mtn' ? mtnNumber : airtelNumber
    const check = validatePhone(dial, raw, country.name)
    return check.ok ? formatFull(dial, check.digits) : ''
  }

  /** True only when the box holds the exact number the server proved for this rail. */
  const isVerifiedNow = (method: PayoutMethod): boolean => {
    const full = fullFor(method)
    return Boolean(full && verified[method]?.number === full)
  }

  const choose = (method: PayoutMethod, next: boolean) => {
    if (method === 'mtn') setMtnOn(next)
    else setAirtelOn(next)
    setSaved(false)
    setError('')
  }

  const handleVerified = (method: PayoutMethod, result: { phone: string; verifiedAt: number }) => {
    setVerified(previous => ({
      ...previous,
      [method]: { number: result.phone, verifiedAt: result.verifiedAt },
    }))
    const local = nationalInput(result.phone, dial)
    if (method === 'mtn') {
      setMtnNumber(local)
      setMtnOn(true)
    } else {
      setAirtelNumber(local)
      setAirtelOn(true)
    }
    setSaved(false)
    setError('')
  }

  const handleSave = async () => {
    setError('')
    setSaved(false)

    if (!mtnOn && !airtelOn) {
      setError('Enable at least one payment method to go live.')
      return
    }
    // An enabled rail with no code behind it is a payout that can never be trusted. The server
    // checks this too; saying it here means the seller is not sent on a round trip to learn it.
    const missing = METHODS.filter(method => (
      (method === 'mtn' ? mtnOn : airtelOn) && !isVerifiedNow(method)
    ))
    if (missing.length) {
      const names = missing.map(method => METHOD_NAMES[method])
      setError(`Verify your ${names.join(' and ')} number with the code before saving.`)
      return
    }
    if (!uid) { navigate('/'); return }

    const user = auth.currentUser
    if (!user) { setError('Sign in again to save your payout settings.'); return }

    setSaving(true)
    try {
      const result = await savePayoutMethods(
        { mtn: mtnOn, airtel: airtelOn },
        { idToken: await user.getIdToken() },
      )
      if (!result.ok) {
        setError(result.error)
        return
      }
      setSaved(true)
    } catch (err) {
      console.error('Saving payout settings failed:', err)
      setError('We could not save that. Check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rt-page" style={{ minHeight: '100vh', background: '#0f0f0f', fontFamily: 'sans-serif', color: '#fff', padding: '20px 16px 60px' }}>
      <div style={{ maxWidth: 520, margin: '0 auto' }}>

        <button onClick={() => navigate('/edit-store')}
          style={{ background: 'transparent', border: 'none', color: '#888', cursor: 'pointer', fontSize: 14, padding: '6px 0', marginBottom: 10 }}>
          ← Back to settings
        </button>

        <h1 style={{ margin: '0 0 6px', fontSize: 24, fontWeight: 800 }}>💸 How you get paid</h1>
        <p style={{ margin: '0 0 6px', color: '#888', fontSize: 14, lineHeight: 1.6 }}>
          Turn on the ways your buyers can pay you. Every payout number is proved with a texted
          code before rachett keeps it.
        </p>
        <p style={{ margin: '0 0 20px', color: '#666', fontSize: 12, lineHeight: 1.5 }}>
          Numbers are for {country.flag} {country.name} ({country.dialCode}) — change your country in
          Settings if that is wrong.
        </p>

        {loading ? (
          <p style={{ color: '#666', fontSize: 14 }}>Loading your payment settings…</p>
        ) : (
          <>
            {/* MTN MoMo */}
            <div style={cardStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span aria-hidden="true" style={{ fontSize: 22 }}>📱</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontWeight: 700, fontSize: 15 }}>MTN MoMo</p>
                  <p style={{ margin: '2px 0 0', color: '#888', fontSize: 12 }}>
                    Buyers approve on their own phone
                  </p>
                </div>
                <Toggle on={mtnOn} label="Accept MTN MoMo" onChange={next => choose('mtn', next)} />
              </div>
              {mtnOn && (
                <PayoutNumberField
                  idPrefix="payout-mtn"
                  method="mtn"
                  label="MTN number that receives payments"
                  country={country}
                  value={mtnNumber}
                  onChange={value => { setMtnNumber(value); setSaved(false); setError('') }}
                  verified={verified.mtn}
                  onVerified={result => handleVerified('mtn', result)}
                  disabled={saving}
                />
              )}
            </div>

            {/* Airtel Money */}
            <div style={cardStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span aria-hidden="true" style={{ fontSize: 22 }}>📶</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontWeight: 700, fontSize: 15 }}>Airtel Money</p>
                  <p style={{ margin: '2px 0 0', color: '#888', fontSize: 12 }}>
                    Buyers approve on their own phone
                  </p>
                </div>
                <Toggle on={airtelOn} label="Accept Airtel Money" onChange={next => choose('airtel', next)} />
              </div>
              {airtelOn && (
                <PayoutNumberField
                  idPrefix="payout-airtel"
                  method="airtel"
                  label="Airtel number that receives payments"
                  country={country}
                  value={airtelNumber}
                  onChange={value => { setAirtelNumber(value); setSaved(false); setError('') }}
                  verified={verified.airtel}
                  onVerified={result => handleVerified('airtel', result)}
                  disabled={saving}
                />
              )}
            </div>

            {/* Card — not a choice yet */}
            <div style={{ ...cardStyle, opacity: 0.7 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span aria-hidden="true" style={{ fontSize: 22 }}>💳</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontWeight: 700, fontSize: 15 }}>Card</p>
                  <p style={{ margin: '2px 0 0', color: '#888', fontSize: 12 }}>
                    Visa and Mastercard, for a buyer whose wallet is not here yet
                  </p>
                </div>
                <Toggle
                  on={false}
                  disabled
                  label="Card (coming soon)"
                  onChange={() => setError('Card payments are coming soon.')}
                />
              </div>
              <p style={{ display: 'inline-block', margin: '12px 0 0', padding: '4px 10px', borderRadius: 999, background: '#1a1a1a', border: '1px solid #333', color: green, fontSize: 11, fontWeight: 800, letterSpacing: '0.4px' }}>
                COMING SOON
              </p>
            </div>

            {error && (
              <p role="alert" style={{ margin: '16px 0 0', padding: '12px 14px', borderRadius: 12, background: '#2a0d0d', border: '1px solid #f55', color: '#ffb3b3', fontSize: 13, lineHeight: 1.5 }}>
                {error}
              </p>
            )}
            {saved && !error && (
              <p role="status" style={{ margin: '16px 0 0', padding: '12px 14px', borderRadius: 12, background: '#122a0d', border: `1px solid ${green}`, color: '#d6ffb0', fontSize: 13, lineHeight: 1.5 }}>
                Saved. Your verified payout numbers are on your account, and buyers can pay you
                with the methods you switched on.
              </p>
            )}

            <button onClick={handleSave} disabled={saving}
              style={{ width: '100%', marginTop: 18, padding: '16px', borderRadius: 14, border: 'none', background: saving ? '#3a4d2a' : green, color: '#000', fontWeight: 800, fontSize: 16, cursor: saving ? 'not-allowed' : 'pointer' }}>
              {saving ? 'Saving…' : 'Save payout settings'}
            </button>

            <p style={{ margin: '14px 0 0', color: '#555', fontSize: 12, lineHeight: 1.5 }}>
              Mobile money runs on pawaPay and cards on Pesapal. You will never be asked for card
              details here, and no payment key ever reaches this page. A verified payout number
              stays on your account — it is never shown on your public shop page.
            </p>
          </>
        )}
      </div>
    </div>
  )
}

const cardStyle: CSSProperties = {
  background: '#1a1a1a',
  border: '1px solid #222',
  borderRadius: 16,
  padding: 16,
  marginBottom: 12,
}
