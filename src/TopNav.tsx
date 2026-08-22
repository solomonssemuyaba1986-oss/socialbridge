import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { auth, googleProvider, facebookProvider, appleProvider } from './firebase'
import {signInWithPopup } from 'firebase/auth'
import { notify } from './notifications'
import { useSellerLive } from './sellerLive'

function TopNav({ variant = 'default' }: { variant?: 'default' | 'bag' }) {
  const navigate = useNavigate()
  const location = useLocation()
  const user = auth.currentUser
  const green = '#adff2f'
  const isBag = variant === 'bag'
  const isHome = location.pathname === '/'

  // Live unread badge for the Inbox button (works for buyers & sellers)
  const { isSeller, unreadMessages, unreadSellerConvo, unreadBuyerConvo } = useSellerLive()
  const inboxUnread = unreadMessages + unreadSellerConvo + unreadBuyerConvo

  const handleBack = () => {
    if (window.history.length > 1) navigate(-1)
    else navigate(user ? '/dashboard' : '/')
  }

  const [showLoginModal, setShowLoginModal] = useState(false)
  const [loginLoading, setLoginLoading] = useState('')

  const handleSocialSignIn = async (provider: any, name: string) => {
    setLoginLoading(name)
    try {
      await signInWithPopup(auth, provider)
      setShowLoginModal(false)
      navigate('/onboarding')
    } catch (error: unknown) {
      console.error(`${name} sign-in error:`, error)
      alert(notify.signInFailed)
    } finally {
      setLoginLoading('')
    }
  }

  const handleSignUpClick = () => {
    navigate('/', { state: { scrollToProviders: true } })
  }

  return (
    <>
      <nav style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 20px', borderBottom: '1px solid #111', background: '#0f0f0f', position: 'relative', zIndex: 100 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {isHome ? (
            <div style={{ background: green, width: 28, height: 28, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 12, color: '#000' }}>R</div>
          ) : (
            <button onClick={handleBack} aria-label="Go back" title="Back"
              style={{ width: 44, height: 44, borderRadius: 12, background: '#1a1a1a', border: '1px solid #333', color: '#fff', cursor: 'pointer', fontSize: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, padding: 0 }}>
              ←
            </button>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={() => navigate(isBag ? '/help?topic=bag' : '/help')} style={{ background: 'transparent', color: '#888', border: '1px solid #2a2a2a', padding: '8px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>{isBag ? '❓ Bag help?' : '❓ Need help?'}</button>
          <button onClick={() => navigate('/feedback')} style={{ background: 'transparent', color: green, border: '1px solid #2a2a2a', padding: '8px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>💡 Feedback</button>
          {!isSeller && (
            <button onClick={() => navigate('/nearby')} style={{ background: 'transparent', color: '#aaa', border: '1px solid #2a2a2a', padding: '8px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>📍 Nearby</button>
          )}

          {!user && (
            <>
              <button onClick={() => setShowLoginModal(true)}
                style={{ background: 'transparent', color: '#fff', border: '1px solid #333', padding: '8px 16px', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
                Log in
              </button>
              <button onClick={handleSignUpClick}
                style={{ background: green, color: '#000', border: 'none', padding: '8px 16px', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>
                Sign up
              </button>
            </>
          )}

          {user && (
            <>
              <button onClick={() => navigate('/inbox')} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'transparent', color: '#fff', border: '1px solid #333', padding: '8px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
                💬 Inbox
                {inboxUnread > 0 && (
                  <span style={{ background: green, color: '#000', borderRadius: '999px', minWidth: 20, height: 20, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, padding: '0 6px', boxSizing: 'border-box' }}>
                    {inboxUnread}
                  </span>
                )}
              </button>
              {isSeller ? (
                <button onClick={() => navigate('/dashboard')} style={{ background: 'transparent', color: '#fff', border: '1px solid #333', padding: '8px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>Manage Store</button>
              ) : (
                <button onClick={() => navigate('/setup')} style={{ background: green, color: '#000', border: 'none', padding: '8px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>🛍️ Become a seller</button>
              )}
            </>
          )}
        </div>
      </nav>

      {/* Login Modal */}
      {showLoginModal && (
        <div onClick={() => setShowLoginModal(false)}
          style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: '#1a1a1a', borderRadius: '16px', padding: '32px', width: '100%', maxWidth: '380px', border: '1px solid #222', color: '#fff', textAlign: 'center' }}>
            
            {/* Close */}
            <button onClick={() => setShowLoginModal(false)}
              style={{ position: 'absolute', top: 16, right: 16, background: 'transparent', border: 'none', color: '#555', cursor: 'pointer', fontSize: 18 }}>✕</button>

            {/* R icon */}
            <div style={{ width: 48, height: 48, borderRadius: 12, background: green, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 20, color: '#000', margin: '0 auto 16px' }}>R</div>

            <h3 style={{ margin: '0 0 6px', fontSize: 20, fontWeight: 800 }}>Welcome back</h3>
            <p style={{ margin: '0 0 28px', color: '#888', fontSize: 14 }}>Log into your rachett account.</p>

            {/* Google */}
            <button onClick={() => handleSocialSignIn(googleProvider, 'Google')} disabled={!!loginLoading}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
                background: '#fff', color: '#000', border: 'none', padding: '14px 24px', borderRadius: 10,
                fontWeight: 700, cursor: loginLoading ? 'not-allowed' : 'pointer', fontSize: 15,
                marginBottom: 10, opacity: loginLoading && loginLoading !== 'Google' ? 0.5 : 1,
              }}>
              <img src="https://www.google.com/favicon.ico" width="20" alt="Google" />
              {loginLoading === 'Google' ? 'Signing in...' : 'Continue with Google'}
            </button>

            {/* Apple */}
            <button onClick={() => handleSocialSignIn(appleProvider, 'Apple')} disabled={!!loginLoading}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
                background: '#000', color: '#fff', border: '1px solid #333', padding: '14px 24px', borderRadius: 10,
                fontWeight: 700, cursor: loginLoading ? 'not-allowed' : 'pointer', fontSize: 15,
                marginBottom: 10, opacity: loginLoading && loginLoading !== 'Apple' ? 0.5 : 1,
              }}>
              <span style={{ fontSize: 18 }}></span>
              {loginLoading === 'Apple' ? 'Signing in...' : 'Continue with Apple'}
            </button>

            {/* Facebook */}
            <button onClick={() => handleSocialSignIn(facebookProvider, 'Facebook')} disabled={!!loginLoading}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
                background: '#4267B2', color: '#fff', border: 'none', padding: '14px 24px', borderRadius: 10,
                fontWeight: 700, cursor: loginLoading ? 'not-allowed' : 'pointer', fontSize: 15,
                marginBottom: 10, opacity: loginLoading && loginLoading !== 'Facebook' ? 0.5 : 1,
              }}>
              <span style={{ fontSize: 18 }}>f</span>
              {loginLoading === 'Facebook' ? 'Signing in...' : 'Continue with Facebook'}
            </button>

            <p style={{ margin: '16px 0 0', color: '#555', fontSize: 13 }}>
              Don't have an account?{' '}
              <span onClick={() => { setShowLoginModal(false); navigate('/', { state: { scrollToProviders: true } }) }}
                style={{ color: green, cursor: 'pointer', fontWeight: 600, textDecoration: 'underline' }}>
                Sign up
              </span>
            </p>
            <p style={{ margin: '8px 0 0', color: '#555', fontSize: 13 }}>
              Lost access to your account?{' '}
              <span onClick={() => { setShowLoginModal(false); navigate('/recover') }}
                style={{ color: '#88aaff', cursor: 'pointer', fontWeight: 600, textDecoration: 'underline' }}>
                Need help
              </span>
            </p>
          </div>
        </div>
      )}
    </>
  )
}

export default TopNav