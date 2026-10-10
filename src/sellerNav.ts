/**
 * The seller's navigation, defined once.
 *
 * This list used to live inside `Sidebar.tsx`. A phone needs the same destinations in a different
 * shape — five tabs plus a "More" sheet, see `SellerTabs.tsx` — and two lists that drift apart on
 * labels, order, icons or badges is exactly the kind of thing nobody notices until a seller does.
 */

export interface SellerNavItem {
  label: string
  path: string
  icon: string
  /** On the phone tab bar: the work that happens every day. Everything else waits behind "More". */
  tab?: boolean
  /** A video destination — its icon wears a small ▶ (Shoppertainment is a bag with a play button). */
  play?: boolean
}

/**
 * The market, and the places a seller shows their own face in it. Named, because more than one
 * screen opens them: the sidebar and the "More" sheet render these rows, the Dashboard's own button
 * takes its label and glyph from `BROWSE`, and the phone's ＋ from `STUDIO` — never a second copy of
 * a path that only has to be typed wrong once.
 */
export const BROWSE: SellerNavItem = { label: 'Browse', path: '/browse', icon: '▦' }
export const SHOPPERTAINMENT: SellerNavItem = { label: 'Shoppertainment', path: '/shoppertainment', icon: '🛍️', play: true }
export const LIVE: SellerNavItem = { label: 'Live', path: '/live', icon: '🔴' }
export const STUDIO: SellerNavItem = { label: 'Studio', path: '/studio', icon: '＋' }

/** Every destination in the seller panel, in the order the seller sees them. */
export const SELLER_NAV: SellerNavItem[] = [
  { label: 'Dashboard', path: '/dashboard', icon: '📊', tab: true },
  { label: 'Products', path: '/products', icon: '🛍️', tab: true },
  { label: 'Orders', path: '/orders', icon: '📦', tab: true },
  { label: 'Inbox', path: '/inbox', icon: '📩', tab: true },
  { label: 'Nearby', path: '/nearby', icon: '📍' },
  { label: 'Analytics', path: '/analytics', icon: '📈', tab: true },
  { label: 'Marketing', path: '/marketing', icon: '📣' },
  // A seller is a buyer too — nothing a seller *is* may be unreachable from their own panel. These
  // four sit above the admin tail (Payouts / Settings / Reviews) rather than at the end of the list,
  // so the things a seller does around the shop stay together.
  BROWSE,
  SHOPPERTAINMENT,
  LIVE,
  STUDIO,
  { label: 'Payouts', path: '/payment-setup', icon: '💸' },
  { label: 'Settings', path: '/edit-store', icon: '⚙️' },
  { label: 'Reviews', path: '/dashboard', icon: '⭐' },
]

/** The five the phone tab bar carries — one tap to the work that happens every day. */
export const TAB_ITEMS = SELLER_NAV.filter(item => item.tab)

/** The rest, for the "More" sheet, still in the seller's original order. */
export const MORE_ITEMS = SELLER_NAV.filter(item => !item.tab)

/** The live number that belongs on an item, or 0 when that item doesn't carry one. */
export function badgeFor(
  item: SellerNavItem,
  live: { pendingOrdersCount: number; inboxUnread: number },
): number {
  if (item.label === 'Orders') return live.pendingOrdersCount
  if (item.label === 'Inbox') return live.inboxUnread
  return 0
}
