/**
 * The buyer's navigation, defined once.
 *
 * A buyer's whole world is five destinations, and unlike the seller's panel they all fit on a
 * phone's tab bar at the same time: home, the market, Shoppertainment, the inbox bell, and the
 * orders they have already placed. There is no "More" sheet on this side — a sheet exists to hide
 * the products, analytics, dashboard and admin tail a buyer does not have, so here it would be a
 * menu with nothing in it.
 *
 * The two destinations a buyer shares with a seller (`Browse`, `Shoppertainment`) are written here
 * with the very same words `sellerNav.ts` uses — same label, same path, same glyph — and
 * `_responsive_check.cjs` refuses to let the two lists drift apart. A seller is a buyer too, and
 * "the market" is one place however you got there.
 *
 * Badges come from the one shared `useSellerLive()` context, exactly like the seller's bar, so the
 * bell and the appbar's Inbox button always say the same number.
 */

export interface BuyerNavItem {
  label: string
  path: string
  icon: string
  /**
   * The name the tab bar has room for.
   *
   * The full label is what the sidebar, the page headings and a screen reader say; 72px of bar
   * cannot hold "Shoppertainment" on one line, so on a phone the bar shows this instead. Absent
   * means the label already fits.
   *
   * `sellerNav.ts` carries the same field on the destinations the two lists share, so the shared
   * entries stay word-for-word identical — `_responsive_check.cjs` compares them literally.
   */
  short?: string
  /** A video destination — its icon wears a small ▶ (Shoppertainment is a bag with a play button). */
  play?: boolean
  /** Needs a real account: a guest is asked nicely and sent back here (see `signInGate.ts`). */
  needsAccount?: boolean
}

/** Every destination a buyer has, in the order the tab bar shows them. */
export const BUYER_NAV: BuyerNavItem[] = [
  // The home shelf is called Unknown — discovery, not a "Discover" tab.
  { label: 'Unknown', path: '/home', icon: '🏠', short: 'Unknown' },
  { label: 'Browse', path: '/browse', icon: '▦' },
  { label: 'Shoppertainment', path: '/shoppertainment', icon: '🛍️', play: true, short: 'Shops' },
  { label: 'Inbox', path: '/inbox', icon: '🔔', needsAccount: true },
  // The orders they have already placed, last: the first four are places to go, this one is what
  // came back from going there. It needs a real account, exactly like the bell.
  { label: 'My Orders', path: '/my-orders', icon: '📦', needsAccount: true },
]

/** The live number that belongs on a buyer's item, or 0 when that item doesn't carry one. */
export function badgeForBuyer(item: BuyerNavItem, live: { inboxUnread: number }): number {
  return item.label === 'Inbox' ? live.inboxUnread : 0
}
