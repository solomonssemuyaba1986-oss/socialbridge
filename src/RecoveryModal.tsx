import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { httpsCallable } from 'firebase/functions'
import { signInWithPopup } from 'firebase/auth'
import { collection, query, where, getDocs, updateDoc, doc } from 'firebase/firestore'
import { functions, auth, db, googleProvider } from './firebase'

const green = '#adff2f'
const OTP_SERVER_URL = import.meta.env.VITE_OTP_SERVER_URL || 'http://localhost:3001'

type Props = {
  open: boolean
  onClose: () => void
}

export default function RecoveryModal({ open, onClose }: Props) {
  const navigate = useNavigate()
  const [step, setStep] = useState<'choose' | 'email' | 'email-otp' | 'phone' | 'phone-otp' | 'done'>('choose')
  const [email, setEmail] = useState('')
  const [emailCode, setEmailCode] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [phoneCode, setPhoneCode] = useState('')
  const [storeId, setStoreId] = useState('')
  const [storeName, setStoreName] = useState('')
  const [recoveredVia, setRecoveredVia] = useState('email')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const sendRecoveryCode = httpsCallable(functions, 'sendRecoveryCode')
  const verifyRecoveryCode = httpsCallable(functions, 'verifyRecoveryCode')

  const close = () => {
    setStep('choose')
    setEmail(''); setEmailCode(''); setNewPhone(''); setPhoneCode('')
    setStoreId(''); setStoreName(''); setError('')
    onClose()
  }

  if (!open) return null

  // --- Email anchor ---
  const handleSendEmailCode = async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError('Enter a valid email address'); return }
    setLoading(true); setError('')
    try {
      await sendRecoveryCode({ email })
      setStep('email-otp')
    } catch (err: any) {
      setError(err.message || 'Something went wrong. Try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleVerifyEmailCode = async () => {
    if (!/^\d{6}$/.test(emailCode)) { setError('Enter the 6-digit code'); return }
    setLoading(true); setError('')
    try {
      await verifyRecoveryCode({ email, code: emailCode })
      setRecoveredVia('email')
      setStep('done')
    } catch (err: any) {
      setError(err.message || 'Incorrect code. Try again.')
    } finally {
      setLoading(false)
    }
  }

  // --- Phone anchor (seller updates their store contact; OTP via SMS) ---
  const handlePhoneSendOtp = async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError('Enter the recovery email on your store'); return }
    if (newPhone.length !== 9 || !/^7\d{8}$/.test(newPhone)) { setError('Enter a valid Uganda number'); return }
    setLoading(true); setError('')
    try {
      // Find the seller store attached to this recovery email
      const q = query(collection(db, 'sellers'), where('recoveryEmail', '==', email.toLowerCase().trim()))
      const snap = await getDocs(q)
      if (snap.empty) {
        setError('No store found with that recovery email. Buyers can recover via Email or Google instead.')
        setLoading(false)
        return
      }
      setStoreId(snap.docs[0].id)
      setStoreName(snap.docs[0].data().businessName || 'Your store')

      // Send OTP to the new phone
      const res = await fetch(`${OTP_SERVER_URL}/api/otp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: `+256${newPhone}` }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to send code')
      } else {
        if (data.debugOtp) console.log('[Recovery Debug] Code:', data.debugOtp)
        setStep('phone-otp')
      }
    } catch {
      setError('Network error. Check your connection.')
    } finally {
      setLoading(false)
    }
  }

  const handlePhoneVerifyOtp = async () => {
    if (!/^\d{6}$/.test(phoneCode)) { setError('Enter the 6-digit code'); return }
    setLoading(true); setError('')
    try {
      const res = await fetch(`${OTP_SERVER_URL}/api/otp/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: `+256${newPhone}`, otp: phoneCode }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Invalid code')
      } else {
        await updateDoc(doc(db, 'sellers', storeId), {
          whatsapp: `256${newPhone}`,
          phoneVerified: true,
        })
        setRecoveredVia('phone')
        setStep('done')
      }
    } catch (err) {
      console.error('Recovery verify error:', err)
      setError('Verification failed. Try again.')
    } finally {
      setLoading(false)
    }
  }

  // --- Social anchor ---
  const handleSocialSignIn = async (provider: any) => {
    setLoading(true); setError('')
    try {
      await signInWithPopup(auth, provider)
      close()
      navigate('/onboarding')
    } catch (err: any) {
      console.error('Social sign-in error:', err)
      setError(err.code === 'auth/popup-blocked'
        ? 'Popup blocked. Allow popups for this site and try again.'
        : 'Sign-in failed. Try again.')
    } finally {
      setLoading(false)
    }
  }
  return (
    <div onClick={close}
      style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: '#1a1a1a', borderRadius: '16px', padding: '28px', width: '100%', maxWidth: '400px', border: '1px solid #222', color: '#fff', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '800' }}>Recover your account</h3>
          <button onClick={close} style={{ background: 'transparent', border: 'none', color: '#555', fontSize: '18px', cursor: 'pointer' }}>✕</button>
        </div>

        {step === 'choose' && (
          <>
            <p style={{ color: '#888', fontSize: '14px', margin: '0 0 20px' }}>
              We'll never lose your store — your products, orders and messages are safe. Choose how you'd like to verify it's really you:
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <button onClick={() => { setError(''); setStep('email') }}
                style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '14px', background: '#111', border: '1px solid #333', borderRadius: '12px', cursor: 'pointer', color: '#fff', textAlign: 'left' }}>
                <span style={{ fontSize: '22px' }}>📧</span>
                <span>
                  <span style={{ display: 'block', fontWeight: '700', fontSize: '14px' }}>Email code</span>
                  <span style={{ display: 'block', color: '#888', fontSize: '12px' }}>Send a 6-digit code to my recovery email</span>
                </span>
              </button>
              <button onClick={() => { setError(''); setStep('phone') }}
                style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '14px', background: '#111', border: '1px solid #333', borderRadius: '12px', cursor: 'pointer', color: '#fff', textAlign: 'left' }}>
                <span style={{ fontSize: '22px' }}>📱</span>
                <span>
                  <span style={{ display: 'block', fontWeight: '700', fontSize: '14px' }}>Phone (SMS)</span>
                  <span style={{ display: 'block', color: '#888', fontSize: '12px' }}>I changed my phone number — update it via SMS</span>
                </span>
              </button>
              <button onClick={() => handleSocialSignIn(googleProvider)} disabled={loading}
                style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '14px', background: '#111', border: '1px solid #333', borderRadius: '12px', cursor: 'pointer', color: '#fff', textAlign: 'left' }}>
                <span style={{ fontSize: '22px' }}>🔑</span>
                <span>
                  <span style={{ display: 'block', fontWeight: '700', fontSize: '14px' }}>Google / Apple / Facebook</span>
                  <span style={{ display: 'block', color: '#888', fontSize: '12px' }}>Sign in the way I did before — fastest way back</span>
                </span>
              </button>
            </div>
            <p style={{ color: '#555', fontSize: '12px', margin: '16px 0 0', textAlign: 'center' }}>
              If none of these work, your store is still safe — we can help you manually.
            </p>
          </>
        )}


        {step === 'email' && (
          <>
            <p style={{ color: '#888', fontSize: '14px', margin: '0 0 16px' }}>
              Enter the recovery email on your store. We'll send you a 6-digit code.
            </p>
            <input value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com"
              style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #333', marginBottom: '12px', boxSizing: 'border-box', fontSize: '14px', background: '#111', color: '#fff' }} />
            {error && <p style={{ color: '#ff4444', fontSize: '12px', margin: '0 0 12px' }}>{error}</p>}
            <button onClick={handleSendEmailCode} disabled={loading}
              style={{ width: '100%', padding: '14px', background: loading ? '#333' : green, color: '#000', border: 'none', borderRadius: '8px', fontWeight: '800', cursor: loading ? 'not-allowed' : 'pointer', fontSize: '15px', marginBottom: '8px' }}>
              {loading ? 'Sending code...' : 'Send Code'}
            </button>
            <button onClick={() => { setError(''); setStep('choose') }} style={{ width: '100%', padding: '10px', background: 'transparent', color: '#888', border: 'none', cursor: 'pointer', fontSize: '13px' }}>
              ← Back
            </button>
          </>
        )}

        {step === 'email-otp' && (
          <>
            <p style={{ color: '#888', fontSize: '14px', margin: '0 0 16px' }}>
              A 6-digit code was sent to <strong style={{ color: '#fff' }}>{email}</strong>. Enter it below.
            </p>
            <input value={emailCode} onChange={e => setEmailCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000"
              style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #333', marginBottom: '12px', boxSizing: 'border-box', fontSize: '20px', background: '#111', color: '#fff', textAlign: 'center', letterSpacing: '8px' }} />
            {error && <p style={{ color: '#ff4444', fontSize: '12px', margin: '0 0 12px' }}>{error}</p>}
            <button onClick={handleVerifyEmailCode} disabled={loading || emailCode.length !== 6}
              style={{ width: '100%', padding: '14px', background: (loading || emailCode.length !== 6) ? '#333' : green, color: '#000', border: 'none', borderRadius: '8px', fontWeight: '800', cursor: (loading || emailCode.length !== 6) ? 'not-allowed' : 'pointer', fontSize: '15px', marginBottom: '8px' }}>
              {loading ? 'Verifying...' : 'Verify Code'}
            </button>
            <button onClick={() => { setError(''); setStep('email') }} style={{ width: '100%', padding: '10px', background: 'transparent', color: '#888', border: 'none', cursor: 'pointer', fontSize: '13px' }}>
              ← Use a different email
            </button>
          </>
        )}


        {step === 'phone' && (
          <>
            <p style={{ color: '#888', fontSize: '14px', margin: '0 0 16px' }}>
              {storeName && <><strong style={{ color: green }}>{storeName}</strong> found. </>}Enter the recovery email on your store first, then your new Uganda number — verified by SMS (no WhatsApp needed).
            </p>
            <input value={email} onChange={e => setEmail(e.target.value)} placeholder="Recovery email (you@example.com)"
              style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #333', marginBottom: '12px', boxSizing: 'border-box', fontSize: '14px', background: '#111', color: '#fff' }} />
            <div style={{ display: 'flex', alignItems: 'center', border: '1px solid #333', borderRadius: '8px', overflow: 'hidden', marginBottom: '12px' }}>
              <div style={{ background: '#111', padding: '12px 14px', fontSize: '14px', borderRight: '1px solid #333', color: '#888' }}>🇺🇬 +256</div>
              <input value={newPhone} onChange={e => setNewPhone(e.target.value.replace(/\D/g, '').slice(0, 9))} placeholder="771234567" maxLength={9}
                style={{ flex: 1, padding: '12px', border: 'none', outline: 'none', fontSize: '15px', background: '#111', color: '#fff' }} />
            </div>
            {error && <p style={{ color: '#ff4444', fontSize: '12px', margin: '0 0 12px' }}>{error}</p>}
            <button onClick={handlePhoneSendOtp} disabled={loading}
              style={{ width: '100%', padding: '14px', background: loading ? '#333' : green, color: '#000', border: 'none', borderRadius: '8px', fontWeight: '800', cursor: loading ? 'not-allowed' : 'pointer', fontSize: '15px', marginBottom: '8px' }}>
              {loading ? 'Sending...' : 'Send Verification Code'}
            </button>
            <button onClick={() => { setError(''); setStep('choose') }} style={{ width: '100%', padding: '10px', background: 'transparent', color: '#888', border: 'none', cursor: 'pointer', fontSize: '13px' }}>
              ← Back
            </button>
          </>
        )}

        {step === 'phone-otp' && (
          <>
            <p style={{ color: '#888', fontSize: '14px', margin: '0 0 16px' }}>
              A 6-digit code was sent to <strong style={{ color: '#fff' }}>+256{newPhone}</strong>. Enter it below.
            </p>
            <input value={phoneCode} onChange={e => setPhoneCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000"
              style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #333', marginBottom: '12px', boxSizing: 'border-box', fontSize: '20px', background: '#111', color: '#fff', textAlign: 'center', letterSpacing: '8px' }} />
            {error && <p style={{ color: '#ff4444', fontSize: '12px', margin: '0 0 12px' }}>{error}</p>}
            <button onClick={handlePhoneVerifyOtp} disabled={loading || phoneCode.length !== 6}
              style={{ width: '100%', padding: '14px', background: (loading || phoneCode.length !== 6) ? '#333' : green, color: '#000', border: 'none', borderRadius: '8px', fontWeight: '800', cursor: (loading || phoneCode.length !== 6) ? 'not-allowed' : 'pointer', fontSize: '15px', marginBottom: '8px' }}>
              {loading ? 'Verifying...' : 'Verify & Update'}
            </button>
            <button onClick={() => { setError(''); setStep('phone') }} style={{ width: '100%', padding: '10px', background: 'transparent', color: '#888', border: 'none', cursor: 'pointer', fontSize: '13px' }}>
              ← Use a different number
            </button>
          </>
        )}

        {step === 'done' && (
          <div style={{ textAlign: 'center', padding: '8px 0' }}>
            <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: green, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', fontSize: '28px', color: '#000', fontWeight: '800' }}>
              ✓
            </div>
            {recoveredVia === 'phone' ? (
              <>
                <h3 style={{ margin: '0 0 8px', fontSize: '18px', fontWeight: '800' }}>Contact updated!</h3>
                <p style={{ color: '#888', fontSize: '14px', margin: '0 0 16px' }}>
                  Your store's phone is now <strong style={{ color: '#fff' }}>+256{newPhone}</strong>. Sign in with your new number or your Google/Apple/Facebook to continue.
                </p>
              </>
            ) : (
              <>
                <h3 style={{ margin: '0 0 8px', fontSize: '18px', fontWeight: '800' }}>Identity verified!</h3>
                <p style={{ color: '#888', fontSize: '14px', margin: '0 0 16px' }}>
                  Sign in with the <strong style={{ color: '#fff' }}>Google / Apple / Facebook</strong> you used before — you'll get straight back into your account. If you're a seller and changed your number, update it in Settings after signing in.
                </p>
              </>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <button onClick={() => { close(); navigate('/', { state: { scrollToProviders: true } }) }}
                style={{ width: '100%', padding: '14px', background: green, color: '#000', border: 'none', borderRadius: '8px', fontWeight: '800', cursor: 'pointer', fontSize: '15px' }}>
                Go to Sign In
              </button>
              <button onClick={close} style={{ width: '100%', padding: '12px', background: 'transparent', color: '#555', border: '1px solid #222', borderRadius: '8px', cursor: 'pointer', fontSize: '14px' }}>
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

