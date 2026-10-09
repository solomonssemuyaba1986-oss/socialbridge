import type { CSSProperties } from 'react'
import {
  formatRatingValue,
  hasRating,
  ratingCountLabel,
  sellerRatingOf,
  type RatingSource,
} from './sellerRatingUtils'

const green = '#adff2f'

type Props = {
  /**
   * Anything carrying the shop's two fields: the seller document itself, a product row a caller has
   * joined the shop onto, a store tile. Nothing renders when the shop has no rating yet.
   */
  source?: RatingSource | null
  /** `pill` — the bordered chip a card wears · `line` — plain words, for one place with room. */
  variant?: 'pill' | 'line'
  /** The noun being counted, singular: "buyer rating" → "12 buyer ratings". `line` only. */
  word?: string
  style?: CSSProperties
}

/**
 * The shop's rating — `★ 4.7 (12)` on a card, `★ 4.7 · 12 buyer ratings` on the storefront.
 *
 * One component, so the same shop can never be ★ 4.7 on Browse and 4.8 in its own shop: the number
 * comes from the seller document (`recomputeSellerRating`, Cloud Functions), the reading rule from
 * `sellerRatingUtils.ts`, and the shape from here. Nothing is drawn for a shop nobody has rated —
 * an absent average beats an invented 0.0.
 */
function SellerRating({ source, variant = 'pill', word = 'rating', style }: Props) {
  const rating = sellerRatingOf(source)
  if (!hasRating(rating)) return null
  const value = formatRatingValue(rating.avg)

  if (variant === 'line') {
    return (
      <span style={{ color: green, fontSize: '15px', fontWeight: 800, ...style }}>
        ★ {value} · {ratingCountLabel(rating.count, word)}
      </span>
    )
  }

  return (
    <span
      title={`${value} out of 5, from ${ratingCountLabel(rating.count, word)}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        flexShrink: 0,
        background: 'rgba(173,255,47,0.10)',
        border: `1px solid ${green}`,
        color: green,
        borderRadius: '999px',
        padding: '1px 7px',
        fontSize: '11px',
        fontWeight: 800,
        lineHeight: 1.6,
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      ★ {value}
      <span style={{ color: '#999', fontWeight: 700 }}>({rating.count})</span>
    </span>
  )
}

export default SellerRating
