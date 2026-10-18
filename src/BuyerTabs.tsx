import { useLocation, useNavigate } from 'react-router-dom'
import { auth } from './firebase'
import { useSellerLive } from './sellerLive'
import { BUYER_NAV, badgeForBuyer, type BuyerNavItem } from './buyerNav'
import { requireSignIn } from './signInGate'

const green = '#adff2f'

/**
 * Where the buyer's bar stays away, in one list, for two different reasons:
 *
 *   - The screens that own the whole phone and hand out their own way forward: signing in, a shop in
 *     the making, the one-time question, a locked-out account, the small print. A bar over them would
 *     be an escape hatch out of the middle of something the person is already in.
 *   - The seller's own routes — the dashboard, the products, the orders, the numbers, the store-room
 *     tools — every one of which `App.tsx` guards with `sellerOnly`. A signed-in buyer can still type
 *     those URLs (a guest is turned away), and a bar of market shortcuts inside somebody's back office
 *     is the wrong door on the wrong wall. `_responsive_check.cjs` reads those routes out of `App.tsx`
 *     and refuses to let this half of the list fall behind the router.
 */
const OFF_LIMITS = [
  '/signin', '/setup', '/onboarding', '/recover', '/terms',
  '/dashboard', '/products', '/orders', '/analytics', '/marketing', '/bulk-upload', '/edit-store',
  '/payment-setup', '/live', '/studio', '/services-delivery',
]

/**
 * The buyer's navigation on a phone: five destinations and no sheet, because a buyer's five
 * destinations *are* the whole thing — home, the market, Shoppertainment, the bell and their own
 * orders. `buyerNav.ts` says where they are, once, for both bars.
 *
 * Three things it deliberately does not do, all of them the same three as `SellerTabs`:
 *   - It never renders for a seller. It reads the same `isSeller` the appbar reads (`TopNav`), so the
 *     two switches flip together and never disagree about who is looking — and the seller's own bar is
 *     mounted by the pages they work on, which is why the two are never on screen at the same time.
 *   - It never adds a listener. The bell's number comes from the one shared `useSellerLive()`
 *     context that already powers the appbar, the Inbox and the tab title — so reading a message
 *     drops the badge here in the same moment. It counts what `BuyerHome` counts.
 *   - It never decides anything about desktop. `responsive.css` hides it from 769px up, where the
 *     appbar and the page itself are the navigation.
 *
 * A guest gets this bar: the market is open to everybody. The two tabs that need a real account
 * (the bell and My Orders) say so when they are tapped, and the person is returned to exactly the
 * tab they pressed — one round trip, no dead end (`signInGate.ts`).
 */
function BuyerTabs() {
  const navigate = useNavigate()
  const location = useLocation()
  const { isSeller, unreadMessages, unreadBuyerConvo } = useSellerLive()

  if (isSeller) return null
  if (OFF_LIMITS.includes(location.pathname)) return null

  const user = auth.currentUser
  /** Anonymous accounts are guests everywhere else — they are here too. */
  const isGuest = !user || user.isAnonymous
  /** The bell, counted exactly as BuyerHome counts it: messages plus their own open chats. */
  const inboxUnread = unreadMessages + unreadBuyerConvo

  const onTab = (item: BuyerNavItem) => {
    if (item.needsAccount && isGuest) {
      // Not signed in at all → asked nicely, then brought back to this very tab. Same wording the
      // buyer's home uses for the same door (`BuyerHome.openOrders`).
      requireSignIn(navigate, { action: 'inbox', returnTo: item.path })
      return
    }
    navigate(item.path)
  }

  /** The count that rides on a tab, pinned beside its glyph — the seller's bar, word for word. */
  const tabBadge = (item: BuyerNavItem) => {
    const count = badgeForBuyer(item, { inboxUnread })
    if (count <= 0) return null
    return (
      <span
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
    <nav className="rt-tabs rt-tabs-buyer" aria-label="Your rachett">
      {BUYER_NAV.map(item => {
        const active = location.pathname === item.path
        return (
          <button
            key={item.path}
            onClick={() => onTab(item)}
            /* The full name goes to a screen reader even when the bar shows the short one. */
            aria-label={item.label}
            aria-current={active ? 'page' : undefined}
            className={active ? 'rt-tab-on' : undefined}
          >
            <span className="rt-tabs-icon" aria-hidden="true">{item.icon}{item.play && <span className="rt-play">▶</span>}</span>
            <span className="rt-tabs-label">{item.short || item.label}</span>
            {tabBadge(item)}
          </button>
        )
      })}
    </nav>
  )
}

export default BuyerTabs
