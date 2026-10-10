/**
 * The buyer's navigation, defined once.
 *
 * A buyer's whole world is four destinations, and unlike the seller's panel they all fit on a
 * phone's tab bar at the same time: home, the market, Shoppertainment, and the inbox bell. There is
 * no "More" sheet on this side — a sheet exists to hide the products, orders, analytics and
 * dashboard a buyer does not have, so on this side it would be a menu with nothing in it.
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
  /** A video destination — its icon wears a small ▶ (Shoppertainment is a bag with a play button). */
  play?: boolean
  /** Needs a real account: a guest is asked nicely and sent back here (see `signInGate.ts`). */
  needsAccount?: boolean
}

/** Every destination a buyer has, in the order the tab bar shows them. */
export const BUYER_NAV: BuyerNavItem[] = [
  { label: 'Home', path: '/home', icon: '🏠' },
  { label: 'Browse', path: '/browse', icon: '▦' },
  { label: 'Shoppertainment', path: '/shoppertainment', icon: '🛍️', play: true },
  { label: 'Inbox', path: '/inbox', icon: '🔔', needsAccount: true },
]

/** The live number that belongs on a buyer's item, or 0 when that item doesn't carry one. */
export function badgeForBuyer(item: BuyerNavItem, live: { inboxUnread: number }): number {
  return item.label === 'Inbox' ? live.inboxUnread : 0
}
