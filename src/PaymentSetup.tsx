import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { auth, db } from './firebase'
import { doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore'
import { COUNTRY_CODES, type CountryCode } from './countryCodes'
import { validatePhone } from './phone'

const green = '#adff2f'

/** The three ways, in the order a seller should think about them. Card is display-only for now. */
type MethodId = 'mtn' | 'airtel' | 'card'

interface MethodShape {
  enabled: boolean
  number: string
}

/**
 * What gets written to the seller's own document.
 *
 * A `paymentMethods` **field** on `sellers/{uid}`, not a `sellers/{uid}/paymentMethods/{id}`
 * subcollection — and that is deliberate: the existing rules already let a seller write their own
 * document (`allow write: if request.auth.uid == sellerId`), so this works **with no rules change
 * and no deploy**. A subcollection would need its own match block and a `deploy:rules` first.
 *
 * The shape is exactly the one asked for, with nothing added inside it:
 *
 *   { mtn: { enabled: true, number: "07…" }, airtel: { enabled: false, number: "" },
 *     card: { enabled: false } }
 */
function methodsToStore(mtnOn: boolean, mtnNumber: string, airtelOn: boolean, airtelNumber: string) {
  return {
    mtn: { enabled: mtnOn, number: mtnOn ? mtnNumber.trim() : '' },
    airtel: { enabled: airtelOn, number: airtelOn ? airtelNumber.trim() : '' },
    // Card is not a choice yet: always off until cards are live for this store.
    card: { enabled: false },
  }
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

  /** The form is filled from the store exactly once — a later snapshot must not overwrite typing. */
  const filledRef = useRef(false)

  useEffect(() => {
    if (!uid) { navigate('/'); return }
    const unsub = onSnapshot(doc(db, 'sellers', uid), (snap) => {
      if (!snap.exists()) { setLoading(false); return }
      const data = snap.data() as {
        paymentMethods?: Partial<Record<MethodId, MethodShape>>
        nationality?: string
      }

      // The seller's country decides which number is expected, read the same way EditStore reads
      // it: by name, falling back to the Uganda default rather than leaving the field ambiguous.
      const byName = COUNTRY_CODES.find(c => c.name === (data.nationality || '').trim())
      if (byName) setCountry(byName)

      if (!filledRef.current) {
        const methods = data.paymentMethods || {}
        const mtn = methods.mtn || { enabled: false, number: '' }
        const airtel = methods.airtel || { enabled: false, number: '' }
        setMtnOn(Boolean(mtn.enabled))
        setMtnNumber(mtn.number || '')
        setAirtelOn(Boolean(airtel.enabled))
        setAirtelNumber(airtel.number || '')
        filledRef.current = true
      }
      setLoading(false)
    }, (err) => {
      console.error('Could not read payment methods:', err)
      setError('We could not load your payment settings. Try again in a moment.')
      setLoading(false)
    })
    return unsub
  }, [uid, navigate])

  const dial = country.dialCode.replace(/[^+\d]/g, '')
  const mtnCheck = validatePhone(dial, mtnNumber, country.name)
  const airtelCheck = validatePhone(dial, airtelNumber, country.name)

  const handleSave = async () => {
    setError('')
    setSaved(false)

    // The rule that was asked for, word for word.
    if (!mtnOn && !airtelOn) {
      setError('Enable at least one payment method to go live.')
      return
    }
    // And the one that protects the seller from themselves: an enabled rail with no number on it is
    // a payment that can never arrive.
    if (mtnOn && !mtnCheck.ok) {
      setError(`That MTN number does not look right. ${mtnCheck.message || ''}`.trim())
      return
    }
    if (airtelOn && !airtelCheck.ok) {
      setError(`That Airtel number does not look right. ${airtelCheck.message || ''}`.trim())
      return
    }
    if (!uid) { navigate('/'); return }

    setSaving(true)
    try {
      // `setDoc` with merge rather than `updateDoc`: a field can never fail because the document was
      // not shaped the way we assumed.
      await setDoc(doc(db, 'sellers', uid), {
        paymentMethods: methodsToStore(mtnOn, mtnNumber, airtelOn, airtelNumber),
        paymentMethodsUpdatedAt: serverTimestamp(),
      }, { merge: true })
      setSaved(true)
    } catch (err) {
      console.error('Saving payment methods failed:', err)
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
          Turn on the ways your buyers can pay you.
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
                  <p style={{ margin: '2px 0 0', color: '#888', fontSize: 12 }}>Buyers approve on their own phone</p>
                </div>
                <Toggle on={mtnOn} label="Accept MTN MoMo" onChange={setMtnOn} />
              </div>
              {mtnOn && (
                <div style={{ marginTop: 14 }}>
                  <label htmlFor="mtn-number" style={{ display: 'block', fontSize: 12, color: '#aaa', fontWeight: 700, marginBottom: 6 }}>
                    MTN number that receives payments
                  </label>
                  <input
                    id="mtn-number"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder="07XX XXX XXX"
                    value={mtnNumber}
                    onChange={e => setMtnNumber(e.target.value)}
                    style={inputStyle}
                  />
                  <p style={{ margin: '6px 0 0', color: mtnNumber && !mtnCheck.ok ? '#ff6b6b' : '#666', fontSize: 12, lineHeight: 1.5 }}>
                    {mtnNumber && !mtnCheck.ok
                      ? mtnCheck.message
                      : `We add ${country.dialCode} for you — type it without the leading 0.`}
                  </p>
                </div>
              )}
            </div>

            {/* Airtel Money */}
            <div style={cardStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span aria-hidden="true" style={{ fontSize: 22 }}>📶</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontWeight: 700, fontSize: 15 }}>Airtel Money</p>
                  <p style={{ margin: '2px 0 0', color: '#888', fontSize: 12 }}>Buyers approve on their own phone</p>
                </div>
                <Toggle on={airtelOn} label="Accept Airtel Money" onChange={setAirtelOn} />
              </div>
              {airtelOn && (
                <div style={{ marginTop: 14 }}>
                  <label htmlFor="airtel-number" style={{ display: 'block', fontSize: 12, color: '#aaa', fontWeight: 700, marginBottom: 6 }}>
                    Airtel number that receives payments
                  </label>
                  <input
                    id="airtel-number"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder="07XX XXX XXX"
                    value={airtelNumber}
                    onChange={e => setAirtelNumber(e.target.value)}
                    style={inputStyle}
                  />
                  <p style={{ margin: '6px 0 0', color: airtelNumber && !airtelCheck.ok ? '#ff6b6b' : '#666', fontSize: 12, lineHeight: 1.5 }}>
                    {airtelNumber && !airtelCheck.ok
                      ? airtelCheck.message
                      : `We add ${country.dialCode} for you — type it without the leading 0.`}
                  </p>
                </div>
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
                Saved. Buyers will see this as soon as mobile money is switched on for your account.
              </p>
            )}

            <button onClick={handleSave} disabled={saving}
              style={{ width: '100%', marginTop: 18, padding: '16px', borderRadius: 14, border: 'none', background: saving ? '#3a4d2a' : green, color: '#000', fontWeight: 800, fontSize: 16, cursor: saving ? 'not-allowed' : 'pointer' }}>
              {saving ? 'Saving…' : 'Save payment methods'}
            </button>

            <p style={{ margin: '14px 0 0', color: '#555', fontSize: 12, lineHeight: 1.5 }}>
              Mobile money runs on pawaPay and cards on Pesapal. You will never be asked for card
              details here, and no payment key ever reaches this page.
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

const inputStyle: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '14px',
  borderRadius: 12,
  border: '1px solid #333',
  background: '#111',
  color: '#fff',
  fontSize: 16,
  outline: 'none',
}
