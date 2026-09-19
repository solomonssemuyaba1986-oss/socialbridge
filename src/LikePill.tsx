import type { CSSProperties } from 'react'
import { formatCount } from './productCardUtils'

type Props = {
  liked: boolean
  /** The universal tally — the same number for every visitor. */
  count: number
  /** Omit to show the number only (your own product, or a surface where voting makes no sense). */
  onToggle?: () => void
}

/**
 * ♥ The one like control in the app.
 *
 * It sits at the far right of a card's product-name row, inside the info section, and it is
 * deliberately small — the card already carries the bag and "bought" pills. Empty is a muted
 * ♡ with no number; once anybody has loved it the tally shows, abbreviated (1.2K, 1.0M).
 * Tap to love, tap again to take it back — one vote per account, enforced by the rules.
 */
export default function LikePill({ liked, count, onToggle }: Props) {
  const base: CSSProperties = {
    flexShrink: 0,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 3,
    padding: '2px 8px',
    borderRadius: '999px',
    fontSize: 12,
    fontWeight: 800,
    lineHeight: 1.5,
    whiteSpace: 'nowrap',
    background: liked ? '#ff4458' : 'transparent',
    color: liked ? '#fff' : '#888',
    border: liked ? '1px solid #ff4458' : '1px solid #333',
  }
  const glyph = liked ? '♥' : '♡'
  const number = count > 0 ? ` ${formatCount(count)}` : ''

  if (!onToggle) {
    return (
      <span style={base} title={`${count} ${count === 1 ? 'like' : 'likes'}`} aria-label={`${count} likes`}>
        {glyph}{number}
      </span>
    )
  }

  return (
    <button
      type="button"
      aria-pressed={liked}
      aria-label={liked ? `${count} likes — remove yours` : 'Love this product'}
      onClick={e => { e.stopPropagation(); onToggle() }}
      style={{ ...base, cursor: 'pointer' }}
    >
      {glyph}{number}
    </button>
  )
}
