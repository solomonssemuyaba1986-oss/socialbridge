import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { doc, getDoc } from 'firebase/firestore'
import { db, auth } from './firebase'
import { notify } from './notifications'
import { useSellerLive } from './sellerLive'

const green = '#adff2f'

const NAV_ITEMS = [
  { label: 'Dashboard', path: '/dashboard', icon: '📊' },
  { label: 'Products', path: '/products', icon: '🛍️' },
  { label: 'Orders', path: '/orders', icon: '📦' },
  { label: 'Inbox', path: '/inbox', icon: '📩' },
  { label: 'Nearby', path: '/nearby', icon: '📍' },
  { label: 'Analytics', path: '/analytics', icon: '📈' },
  { label: 'Marketing', path: '/dashboard', icon: '📣' },
  { label: 'Payouts', path: '/dashboard', icon: '💸' },
  { label: 'Settings', path: '/edit-store', icon: '⚙️' },
  { label: 'Reviews', path: '/dashboard', icon: '⭐' },
]

// Cache the seller's store info so the sidebar is instant on every page.
let cachedSeller: { businessName: string; slug: string } | null = null

type Props = {
  /** Dashboard's new-order spotlight flash (raises the sidebar + pulses the badge). */
  spotlight?: boolean
}

/** One shared seller sidebar — the same nav follows you across Dashboard / Orders / Analytics. */
function Sidebar({ spotlight }: Props) {
  const navigate = useNavigate()
  const location = useLocation()
  const { pendingOrdersCount, unreadMessages, unreadSellerConvo, unreadBuyerConvo } = useSellerLive()
  const inboxUnread = unreadMessages + unreadSellerConvo + unreadBuyerConvo
  const [sellerInfo, setSellerInfo] = useState(cachedSeller)

  useEffect(() => {
    if (cachedSeller) return
    const uid = auth.currentUser?.uid
    if (!uid) return
    let cancelled = false
    getDoc(doc(db, 'sellers', uid))
      .then(snap => {
        if (cancelled || !snap.exists()) return
        const d = snap.data()
        cachedSeller = { businessName: d.businessName || 'Seller panel', slug: d.slug || '' }
        setSellerInfo(cachedSeller)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const storeLink = sellerInfo?.slug ? `${window.location.origin}/store/${sellerInfo.slug}` : ''

  return (
    <>
      <style>{`@keyframes rachettPulse { 0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(173,255,47,0.6); } 50% { transform: scale(1.15); box-shadow: 0 0 0 8px rgba(173,255,47,0.2); } }`}</style>
      <div style={{ position: 'fixed', left: 0, top: 0, bottom: 0, width: 260, background: '#070707', borderRight: '1px solid #111', padding: '28px 16px', display: 'flex', flexDirection: 'column', gap: '28px', zIndex: spotlight ? 40 : 20, overflowY: 'auto', overscrollBehavior: 'contain' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px' }}>
          <div style={{ background: green, width: 34, height: 34, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 16, color: '#000' }}>R</div>
          <div>
            <div style={{ fontWeight: 800, color: '#fff', fontSize: 16 }}>rachett</div>
            <div style={{ color: '#777', fontSize: 12 }}>{sellerInfo?.businessName || 'Seller panel'}</div>
          </div>
        </div>
        <div style={{ display: 'grid', gap: '6px' }}>
          {NAV_ITEMS.map(item => {
            const active = location.pathname === item.path
            const showBadge = item.label === 'Orders' ? pendingOrdersCount : item.label === 'Inbox' ? inboxUnread : 0
            return (
              <button key={item.path + item.label} onClick={() => navigate(item.path)}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 14px', borderRadius: '14px', border: 'none', cursor: 'pointer', textAlign: 'left', background: active ? '#0f2910' : 'transparent', color: active ? '#fff' : '#aaa', fontWeight: active ? 700 : 600, fontSize: '14px' }}>
                <span>{item.icon}</span>
                <span style={{ flex: 1 }}>{item.label}</span>
                {showBadge > 0 ? (
                  <span style={{ minWidth: '24px', height: '24px', borderRadius: '999px', background: green, color: '#000', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 900, padding: '0 6px', boxShadow: '0 0 0 2px rgba(173,255,47,0.2)', animation: spotlight ? 'rachettPulse 0.8s ease-in-out infinite' : 'none' }}>
                    {showBadge}
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
        <div style={{ marginTop: 'auto' }}>
          {storeLink && (
            <button onClick={() => { navigator.clipboard.writeText(storeLink); alert(notify.storeLinkCopied) }}
              style={{ width: '100%', padding: '12px', borderRadius: '14px', border: '1px solid #222', background: '#111', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>
              Copy Store Link
            </button>
          )}
        </div>
      </div>
    </>
  )
}

export default Sidebar
