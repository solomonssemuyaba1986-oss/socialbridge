import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { doc, onSnapshot } from 'firebase/firestore'
import { db, auth } from './firebase'
import { notify } from './notifications'
import { useSellerLive } from './sellerLive'
import { getStoreAgeLabel } from './useSellerStats'
import { SELLER_NAV, badgeFor } from './sellerNav'

const green = '#adff2f'

type Props = {
  /** Dashboard's new-order spotlight flash (raises the sidebar + pulses the badge). */
  spotlight?: boolean
}

/**
 * One shared seller sidebar — the same nav follows you across Dashboard / Orders / Analytics.
 *
 * It is the **desktop** navigation. On a phone it is hidden (`.rt-sidebar`) and `SellerTabs` takes
 * over with the same destinations and the same badges, because a fixed 260px column leaves a 360px
 * screen with 100px to work in. The list itself lives in `sellerNav.ts`, so the two can't drift.
 */
function Sidebar({ spotlight }: Props) {
  const navigate = useNavigate()
  const location = useLocation()
  const { pendingOrdersCount, unreadMessages, unreadSellerConvo, unreadBuyerConvo } = useSellerLive()
  const inboxUnread = unreadMessages + unreadSellerConvo + unreadBuyerConvo
  const [sellerInfo, setSellerInfo] = useState<{ businessName: string; slug: string; logoUrl: string; storeAge: string } | null>(null)

  // Live store identity — the seller's own name, logo and store age, always current
  // (an edit in EditStore shows up right away). This is their panel, not ours.
  useEffect(() => {
    const uid = auth.currentUser?.uid
    if (!uid) return
    const unsub = onSnapshot(doc(db, 'sellers', uid), (snap) => {
      if (!snap.exists()) return
      const d = snap.data()
      setSellerInfo({
        businessName: d.businessName || 'Your store',
        slug: d.slug || '',
        logoUrl: d.logoUrl || '',
        storeAge: getStoreAgeLabel(d.createdAt),
      })
    }, err => console.warn('Sidebar: seller doc', err))
    return unsub
  }, [])

  const storeLink = sellerInfo?.slug ? `${window.location.origin}/store/${sellerInfo.slug}` : ''

  return (
    <>
      <style>{`@keyframes rachettPulse { 0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(173,255,47,0.6); } 50% { transform: scale(1.15); box-shadow: 0 0 0 8px rgba(173,255,47,0.2); } }`}</style>
      <div className="rt-sidebar" style={{ position: 'fixed', left: 0, top: 0, bottom: 0, width: 260, background: '#070707', borderRight: '1px solid #111', padding: '28px 16px', display: 'flex', flexDirection: 'column', gap: '28px', zIndex: spotlight ? 40 : 20, overflowY: 'auto', overscrollBehavior: 'contain' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px' }}>
          {sellerInfo?.logoUrl ? (
            <img src={sellerInfo.logoUrl} alt={sellerInfo.businessName}
              style={{ width: 40, height: 40, borderRadius: 12, objectFit: 'cover', border: '1px solid #222', flexShrink: 0 }} />
          ) : (
            <div style={{ background: green, width: 40, height: 40, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 17, color: '#000', flexShrink: 0 }}>
              {(sellerInfo?.businessName || 'Y').charAt(0).toUpperCase()}
            </div>
          )}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 800, color: '#fff', fontSize: 15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {sellerInfo?.businessName || 'Your store'}
            </div>
            <div style={{ color: '#777', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {sellerInfo?.storeAge || 'Seller panel'}
            </div>
          </div>
        </div>
        <div style={{ display: 'grid', gap: '6px' }}>
          {SELLER_NAV.map(item => {
            const active = location.pathname === item.path
            // The same list and the same numbers as the phone tab bar: one definition, one truth.
            const showBadge = badgeFor(item, { pendingOrdersCount, inboxUnread })
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
