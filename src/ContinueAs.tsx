import { useState } from 'react'
import { signInWithPopup, GoogleAuthProvider, FacebookAuthProvider, OAuthProvider } from 'firebase/auth'
import type { AuthProvider } from 'firebase/auth'
import { auth } from './firebase'
import { getRememberedUser, rememberUser, clearRememberedUser, type RememberedUser } from './userMemory'

const green = '#adff2f'

type Props = {
  onSuccess: () => void
  beforeSignIn?: () => boolean
}

/** Build the right popup provider for a remembered account, pre-selecting it via login_hint. */
function providerFor(user: RememberedUser): AuthProvider | null {
  const pid = user.providerId || 'google.com'
  if (pid === 'facebook.com') return new FacebookAuthProvider()
  if (pid === 'apple.com') return new OAuthProvider('apple.com')
  if (pid === 'phone') return null // phone accounts re-verify via OTP instead
  const gp = new GoogleAuthProvider()
  if (user.email) gp.setCustomParameters({ login_hint: user.email })
  return gp
}

/**
 * One-tap "Continue as [name]" for returning users — mirrors the Stripe/Google
 * pattern: no typing, no redirect, straight back in.
 */
function ContinueAs({ onSuccess, beforeSignIn }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const remembered = getRememberedUser()

  if (!remembered) return null
  const provider = providerFor(remembered)
  if (!provider) return null

  const handleContinue = async () => {
    if (beforeSignIn && !beforeSignIn()) return
    setLoading(true)
    setError('')
    try {
      await signInWithPopup(auth, provider)
      rememberUser(auth.currentUser)
      onSuccess()
    } catch (err: unknown) {
      console.error('Continue-as sign-in error:', err)
      const e = err as { code?: string }
      if (e?.code === 'auth/popup-blocked' || e?.code === 'auth/operation-not-supported-in-this-environment') {
        setError('Popup was blocked. Allow popups and try again.')
      } else if (e?.code !== 'auth/popup-closed-by-user' && e?.code !== 'auth/cancelled-popup-request') {
        setError('Could not sign you in. Try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ marginBottom: '14px' }}>
      <button onClick={handleContinue} disabled={loading}
        style={{ width: '100%', padding: '12px 14px', background: '#111', color: '#fff', border: `1px solid ${green}`, borderRadius: '10px', cursor: loading ? 'not-allowed' : 'pointer', fontWeight: '700', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '10px', textAlign: 'left' }}>
        {remembered.photoURL ? (
          <img src={remembered.photoURL} alt="" style={{ width: 30, height: 30, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
        ) : (
          <span style={{ width: 30, height: 30, borderRadius: '50%', background: '#333', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
            {(remembered.displayName || 'U').charAt(0).toUpperCase()}
          </span>
        )}
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 10, color: '#888', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Welcome back</span>
          <span style={{ display: 'block', fontSize: 14, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {loading ? 'Signing you in…' : `Continue as ${remembered.displayName || (remembered.email || 'you')}`}
          </span>
        </span>
        <span style={{ color: green, fontSize: 16, flexShrink: 0 }}>→</span>
      </button>
      {!loading && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
          <button onClick={() => { clearRememberedUser(); setError('') }}
            style={{ background: 'transparent', border: 'none', color: '#666', cursor: 'pointer', fontSize: 11, textDecoration: 'underline' }}>
            Not you?
          </button>
        </div>
      )}
      {error && <p style={{ margin: '6px 0 0', color: '#ff6666', fontSize: 12, textAlign: 'center' }}>{error}</p>}
    </div>
  )
}

export default ContinueAs
