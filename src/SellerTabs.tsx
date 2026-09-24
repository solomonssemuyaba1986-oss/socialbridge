import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useSellerLive } from './sellerLive'
import { MORE_ITEMS, TAB_ITEMS, badgeFor, type SellerNavItem } from './sellerNav'

const green = '#adff2f'

type Props = {
  /**
   * The Dashboard's new-order flash. On desktop that spotlight highlights the sidebar; on a phone
   * the sidebar is gone, so the pulse moves to the tab that actually shows the new order.
   */
  spotlight?: boolean
}

/**
 * The seller's navigation on a phone: five tabs for the work that happens every day, and a "More"
 * sheet for everything else.
 *
 * Three things it deliberately does not do:
 *   - It never renders for a buyer or a guest. `/inbox` is a shared screen, so the bar asks who is
 *     looking (`isSeller`) and stays out of the way otherwise.
 *   - It never adds a listener. The badges come from the one shared `useSellerLive()` context that
 *     already powers the sidebar, the Inbox shortcuts and the tab title — so confirming an order on
 *     `/orders` drops every number on screen in the same moment.
 *   - It never decides anything about desktop. `responsive.css` hides it from 769px up, where
 *     `Sidebar` is the navigation instead.
 */
function SellerTabs({ spotlight }: Props) {
  const navigate = useNavigate()
  const location = useLocation()
  const { isSeller, pendingOrdersCount, unreadMessages, unreadSellerConvo, unreadBuyerConvo } = useSellerLive()
  /**
   * *Which page* the sheet was opened on — deliberately not a plain boolean. Navigating anywhere
   * closes it by itself, because the pathname it was opened for no longer matches; there is no
   * effect to run, no stale open state to correct, and nothing to keep in sync (React's own
   * guidance: derive during render rather than fix up afterwards).
   */
  const [sheetFor, setSheetFor] = useState<string | null>(null)
  const moreOpen = sheetFor === location.pathname

  if (!isSeller) return null

  const inboxUnread = unreadMessages + unreadSellerConvo + unreadBuyerConvo
  const countFor = (item: SellerNavItem) => badgeFor(item, { pendingOrdersCount, inboxUnread })

  /** The count that rides on a tab, pinned to the icon's top-right corner. */
  const tabBadge = (item: SellerNavItem) => {
    const count = countFor(item)
    if (count <= 0) return null
    const pulsing = Boolean(spotlight) && item.label === 'Orders'
    return (
      <span
        className={pulsing ? 'rt-tabs-pulse' : undefined}
        style={{
          position: 'absolute', top: '4px', right: '50%', transform: 'translateX(12px)',
          minWidth: '18px', height: '18px', borderRadius: '999px', background: green, color: '#000',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '11px', fontWeight: 900, padding: '0 5px',
          boxShadow: '0 0 0 2px rgba(173,255,47,0.2)',
        }}
      >
        {count}
      </span>
    )
  }

  return (
    <>
      <nav className="rt-tabs" aria-label="Seller panel">
        {TAB_ITEMS.map(item => {
          const active = location.pathname === item.path
          return (
            <button
              key={item.path + item.label}
              onClick={() => navigate(item.path)}
              aria-label={item.label}
              aria-current={active ? 'page' : undefined}
              className={active ? 'rt-tab-on' : undefined}
            >
              <span className="rt-tabs-icon" aria-hidden="true">{item.icon}</span>
              <span className="rt-tabs-label">{item.label}</span>
              {tabBadge(item)}
            </button>
          )
        })}

        <button onClick={() => setSheetFor(moreOpen ? null : location.pathname)} aria-label="More" aria-expanded={moreOpen}>
          <span className="rt-tabs-icon" aria-hidden="true">⋯</span>
          <span className="rt-tabs-label">More</span>
        </button>
      </nav>

      {moreOpen && (
        <div
          className="rt-modal-overlay rt-tabs-sheet"
          role="dialog"
          aria-label="More"
          onClick={() => setSheetFor(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)', zIndex: 1000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', fontFamily: 'sans-serif' }}
        >
          <div
            className="rt-modal-box"
            onClick={e => e.stopPropagation()}
            style={{ background: '#141414', border: '1px solid #262626', borderRadius: '18px 18px 0 0', width: '100%', maxWidth: '480px' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px 10px 16px', borderBottom: '1px solid #222' }}>
              <span style={{ fontWeight: 800, fontSize: 15, color: '#fff' }}>More</span>
              <button
                onClick={() => setSheetFor(null)}
                aria-label="Close"
                style={{ background: 'transparent', border: 'none', color: '#888', fontSize: 18, cursor: 'pointer', minWidth: 44, minHeight: 44 }}
              >
                ✕
              </button>
            </div>

            <div style={{ display: 'grid', gap: 4, padding: '10px 10px 0' }}>
              {MORE_ITEMS.map(item => {
                const count = countFor(item)
                return (
                  <button
                    key={item.path + item.label}
                    onClick={() => { setSheetFor(null); navigate(item.path) }}
                    style={{ display: 'flex', alignItems: 'center', gap: '12px', width: '100%', minHeight: 48, padding: '12px 14px', borderRadius: 14, border: 'none', background: '#1a1a1a', color: '#fff', fontWeight: 600, fontSize: 15, textAlign: 'left', cursor: 'pointer' }}
                  >
                    <span aria-hidden="true">{item.icon}</span>
                    <span style={{ flex: 1 }}>{item.label}</span>
                    {count > 0 && (
                      <span style={{ minWidth: '22px', height: '22px', borderRadius: '999px', background: green, color: '#000', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 900, padding: '0 6px' }}>
                        {count}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default SellerTabs
