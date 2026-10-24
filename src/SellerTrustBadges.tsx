import type { BadgeStatus } from './useSellerStats'
import { getBadgeStatusLabel } from './useSellerStats'

const green = '#adff2f'
const purple = '#7a5cff'

type Props = {
  realSeller?: boolean
  realSellerStatus?: BadgeStatus
  reliableSeller?: boolean
  reliableSellerStatus?: BadgeStatus
  /** `sm` sits in a chat header; `md` is the storefront / dashboard size. */
  size?: 'sm' | 'md'
  /** Say so when there is no badge yet, instead of drawing nothing. */
  showEmpty?: boolean
  style?: React.CSSProperties
}

/**
 * The seller badges, in one place so a buyer never sees a different shop on two screens.
 *
 * 🟢 Real Seller is proof of a verified phone and a complete shop. 💎 Reliable Seller is measured
 * by rachett from completed orders and first-reply time. Both are read-only images of facts the
 * seller cannot type about themselves — which is why they are worth trusting, and why the seller
 * should be able to see them too, not only buyers.
 */
export default function SellerTrustBadges({
  realSeller = false,
  realSellerStatus = 'none',
  reliableSeller = false,
  reliableSellerStatus = 'none',
  size = 'md',
  showEmpty = false,
  style,
}: Props) {
  if (!realSeller && !reliableSeller) {
    if (!showEmpty) return null
    return (
      <span style={{ ...emptyStyle, fontSize: size === 'sm' ? 11 : 12, ...style }}>
        No seller badge yet
      </span>
    )
  }

  const small = size === 'sm'
  const chip = {
    ...chipStyle,
    fontSize: small ? 10.5 : 11,
    padding: small ? '2px 8px' : '4px 11px',
  } as const

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', ...style }}>
      {realSeller && (
        <span
          title={realSellerStatus === 'grace'
            ? "This seller's verification is being renewed"
            : 'Phone verified and shop complete — checked by rachett'}
          style={{
            ...chip,
            background: realSellerStatus === 'grace' ? '#666' : green,
            color: realSellerStatus === 'grace' ? '#fff' : '#000',
            opacity: realSellerStatus === 'grace' ? 0.72 : 1,
          }}
        >
          🟢 {getBadgeStatusLabel(realSellerStatus, 'Real Seller')}
        </span>
      )}
      {reliableSeller && (
        <span
          title="Rachett measured this seller: they finish their orders and reply to buyers within two hours"
          style={{ ...chip, background: purple, color: '#fff' }}
        >
          💎 {getBadgeStatusLabel(reliableSellerStatus, 'Reliable Seller')}
        </span>
      )}
    </span>
  )
}

const chipStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  borderRadius: 999,
  fontWeight: 800,
  lineHeight: 1.5,
  whiteSpace: 'nowrap',
}

const emptyStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '3px 9px',
  borderRadius: 999,
  border: '1px dashed #333',
  color: '#777',
  fontWeight: 700,
}
