import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db } from './firebase'
import { useBag } from './useBag'
import { useSellerLive } from './sellerLive'
import FloatingBag from './FloatingBag'
import { requireSignIn } from './signInGate'

const green = '#adff2f'

/** The buyer's own search history, kept on their device (never in the database). */
function recentSearches(userId: string | null): string[] {
  try {
    const raw = localStorage.getItem(`rachett_recent_searches_${userId || 'guest'}`)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter((item: unknown): item is string => typeof item === 'string').slice(0, 5)
      : []
  } catch {
    return []
  }
}

/**
 * The buyer's home — the counterpart to the seller's Dashboard.
 *
 * Buyers used to have nowhere to land: `/` sent every signed-in non-seller back to
 * "What brings you here?", and the only door to the market was a Browse button that
 * lived nowhere in the nav. This is that home, and it works for guests too.
 */
function BuyerHome() {
  const navigate = useNavigate()
  const { count: bagCount } = useBag()
  const { unreadMessages, unreadBuyerConvo } = useSellerLive()
  const user = auth.currentUser

  const [hasShop, setHasShop] = useState(false)
  const firstName = (user?.displayName || '').trim().split(/\s+/)[0] || ''
  const searches = recentSearches(user?.uid || null)
  const unread = unreadMessages + unreadBuyerConvo
  /** Anonymous accounts count as logged out — the inbox needs a real account. */
  const isGuest = !user || user.isAnonymous

  /** The inbox is the one thing a guest can't have yet, so it asks nicely. */
  const openInbox = () => {
    if (isGuest) {
      requireSignIn(navigate, { action: 'inbox', returnTo: '/inbox' })
      return
    }
    navigate('/inbox')
  }

  // Sellers who wander in here get pointed at their own panel instead.
  useEffect(() => {
    const uid = auth.currentUser?.uid
    if (!uid) return
    let cancelled = false
    getDoc(doc(db, 'sellers', uid))
      .then(snap => { if (!cancelled) setHasShop(snap.exists()) })
      .catch(() => { /* offline — just show the buyer version */ })
    return () => { cancelled = true }
  }, [])

  const tile = (icon: string, label: string, badge: number, onClick: () => void) => (
    <button key={label} onClick={onClick}
      style={{ flex: '1 1 30%', minWidth: '92px', background: '#1a1a1a', border: '1px solid #262626', borderRadius: '14px', padding: '16px 10px', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', position: 'relative' }}>
      <span style={{ fontSize: '22px' }}>{icon}</span>
      <span style={{ fontSize: '12px', color: '#ddd', fontWeight: 700, textAlign: 'center' }}>{label}</span>
      {badge > 0 && (
        <span style={{ position: 'absolute', top: '8px', right: '8px', background: green, color: '#000', borderRadius: '999px', minWidth: '20px', height: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 900, padding: '0 5px', boxSizing: 'border-box' }}>
          {badge}
        </span>
      )}
    </button>
  )

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f0f', fontFamily: 'sans-serif', color: '#fff' }}>
      <div style={{ maxWidth: '640px', margin: '0 auto', padding: '20px 16px 40px' }}>

        <h1 style={{ margin: '0 0 4px', fontSize: '22px', fontWeight: '800' }}>
          {firstName ? `Hi ${firstName} 👋` : 'Welcome to rachett'}
        </h1>
        <p style={{ margin: '0 0 20px', color: '#888', fontSize: '14px' }}>What are you shopping for today?</p>

        {/* The door to the market */}
        <button onClick={() => navigate('/browse')}
          style={{ width: '100%', padding: '18px 16px', background: green, color: '#000', border: 'none', borderRadius: '14px', fontWeight: '800', cursor: 'pointer', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', marginBottom: '14px' }}>
          🔍 Browse
        </button>
        <p style={{ margin: '0 0 20px', color: '#666', fontSize: '12px', textAlign: 'center' }}>
          Products from social sellers — message them, or order right here.
        </p>

        <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
          {tile('📍', 'Nearby', 0, () => navigate('/nearby'))}
          {tile('🛍️', 'My Bag', bagCount, () => navigate('/bag'))}
          {tile('📩', 'Inbox', unread, openInbox)}
        </div>
        {searches.length > 0 && (
          <>
            <p style={{ margin: '0 0 8px', color: '#666', fontSize: '12px', fontWeight: '700', letterSpacing: '0.3px' }}>PICK UP WHERE YOU LEFT OFF</p>
            <div className="rt-filters" style={{ display: 'flex', gap: '8px', overflowX: 'auto', marginBottom: '20px', paddingBottom: '2px' }}>
              {searches.map(term => (
                <button key={term} onClick={() => navigate(`/browse?q=${encodeURIComponent(term)}`)}
                  style={{ padding: '8px 14px', borderRadius: '999px', border: '1px solid #333', background: '#1a1a1a', color: '#ccc', fontWeight: '600', fontSize: '13px', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
                  🔎 {term}
                </button>
              ))}
            </div>
          </>
        )}

        <button onClick={openInbox}
          style={{ width: '100%', padding: '14px 16px', background: '#1a1a1a', border: '1px solid #262626', borderRadius: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px', textAlign: 'left' }}>
          <span style={{ fontSize: '20px' }}>📦</span>
          <span style={{ flex: 1 }}>
            <span style={{ display: 'block', color: '#fff', fontWeight: 700, fontSize: '14px' }}>Track an order</span>
            <span style={{ display: 'block', color: '#777', fontSize: '12px', marginTop: '2px' }}>Every order you place keeps its own chat thread</span>
          </span>
          <span style={{ color: '#555' }}>→</span>
        </button>

        <button onClick={() => navigate(hasShop ? '/dashboard' : '/setup')}
          style={{ width: '100%', padding: '14px 16px', background: '#12210d', border: `1px solid ${green}`, borderRadius: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '12px', textAlign: 'left' }}>
          <span style={{ fontSize: '20px' }}>🏪</span>
          <span style={{ flex: 1 }}>
            <span style={{ display: 'block', color: green, fontWeight: 800, fontSize: '14px' }}>
              {hasShop ? 'Manage my store' : 'Selling on WhatsApp? Open your own shop'}
            </span>
            <span style={{ display: 'block', color: '#8aa87f', fontSize: '12px', marginTop: '2px' }}>
              {hasShop ? 'Products, orders and analytics' : 'One link, and orders stop getting lost in your DMs'}
            </span>
          </span>
          <span style={{ color: green }}>→</span>
        </button>

      </div>

      <FloatingBag count={bagCount} />
    </div>
  )
}

export default BuyerHome
