import { useEffect } from 'react'
import { useProductReviews } from './useProductReviews'
import {
  averageLabel,
  reactionEmoji,
  reactionLabel,
  summaryFromAggregate,
  summaryLabel,
  timeAgo,
  type Eligibility,
  type Review,
} from './reviewUtils'
import { green } from './productCardUtils'
import { trackEvent } from './analytics'

/**
 * What buyers said, inside the details sheet.
 *
 * This is the trust surface: a person is looking at the product and deciding. So it says only what
 * is true — how many commented, how many loved it, and what they actually wrote — and it never
 * invents a number for a product nobody has commented on.
 *
 * It also reads only what it needs: the list comes from one live query, while the header's total
 * comes from the product's own counters, so a product with 200 comments never loads 200 documents
 * just to say "147 of 200 loved it".
 */

type Props = {
  sellerId: string
  productId: string
  /** The counters stored on the product document (they count every comment, not just this page). */
  aggregate?: { count?: unknown; scoreSum?: unknown; loved?: unknown }
  /** Who may write one — the host decides, because the host knows the buyer's orders. */
  eligibility?: Eligibility
  /** Opens the form. Leave it out and the section is read-only. */
  onWrite?: (existing: Review | null) => void
  surface?: string
}

function ProductReviews({ sellerId, productId, aggregate, eligibility, onWrite, surface = 'sheet' }: Props) {
  const { reviews, summary, myReview, loading, error, blocked } = useProductReviews(sellerId, productId)

  // The header counts *everything* (the product's counters); the list may be a shorter page.
  const usingAggregate = Number(aggregate?.count) > 0
  const loaded = summaryFromAggregate(
    Math.max(summary.count, Number(aggregate?.count) || 0),
    usingAggregate ? aggregate?.scoreSum : summary.scoreSum,
    usingAggregate ? aggregate?.loved : summary.loved,
  )
  const total = loaded.count
  const hidden = Math.max(0, total - summary.count)

  // One reading event per product view, so we can see whether anybody actually reads comments.
  useEffect(() => {
    if (loading || total === 0) return
    trackEvent('review_comments_seen', { productId, count: total, surface })
  }, [loading, total, productId, surface])

  // Editing your own comment is always allowed; *creating* one needs the host to have proven a
  // delivery. Without that proof we show the list read-only rather than a button that fails.
  const canWrite = Boolean(onWrite) && (eligibility ? eligibility.ok : Boolean(myReview))

  if (loading) {
    return <p style={{ margin: '14px 0 0', color: '#666', fontSize: 12 }}>Loading comments…</p>
  }

  // The comments' rules are not deployed yet. Show nothing rather than an empty "No comments yet"
  // that isn't true, and rather than an error that blames the connection.
  if (blocked) return null

  return (
    <div style={{ marginTop: 18, borderTop: '1px solid #222', paddingTop: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
        <div>
          <p style={{ margin: 0, color: '#fff', fontSize: 14, fontWeight: 800 }}>What buyers said</p>
          <p style={{ margin: '2px 0 0', color: total > 0 ? green : '#777', fontSize: 12, fontWeight: 700 }}>
            {summaryLabel(loaded)}
            {averageLabel(loaded) && <span style={{ color: '#888', fontWeight: 600 }}> · {averageLabel(loaded)}/5</span>}
          </p>
        </div>
        {canWrite && (
          <button onClick={() => onWrite?.(myReview)}
            style={{ flexShrink: 0, padding: '8px 12px', background: green, color: '#000', border: 'none', borderRadius: 10, fontSize: 12, fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            {myReview ? '✏️ Edit your comment' : '✍️ Write yours'}
          </button>
        )}
      </div>

      {/* Why you can or cannot write — said plainly, once, instead of a dead button. */}
      {onWrite && eligibility && !eligibility.ok && !myReview && (
        <p style={{ margin: '0 0 10px', color: '#777', fontSize: 12, lineHeight: 1.5 }}>{eligibility.reason}</p>
      )}

      {/* The host can't prove a delivery from here (Browse has no orders list), so point at the
          place that can — instead of showing a button that would fail. */}
      {!onWrite && !myReview && (
        <p style={{ margin: '0 0 10px', color: '#777', fontSize: 12, lineHeight: 1.5 }}>
          Received this one? You can comment on it from your orders — it appears right here.
        </p>
      )}

      {summary.topTags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
          {summary.topTags.map(tag => (
            <span key={tag} style={{ padding: '4px 9px', borderRadius: 999, background: '#1c1c1c', border: '1px solid #2a2a2a', color: '#bbb', fontSize: 11, fontWeight: 700 }}>
              {tag} ×{reviews.filter(r => r.tags.includes(tag)).length}
            </span>
          ))}
        </div>
      )}

      {error && <p style={{ margin: '0 0 10px', color: '#ff6b6b', fontSize: 12, fontWeight: 700 }}>{error}</p>}

      {summary.count === 0 ? (
        <p style={{ margin: 0, color: '#666', fontSize: 12, lineHeight: 1.6 }}>
          {total === 0
            ? 'No comments yet. The first buyer who receives one gets to say it here.'
            : 'Nothing to show yet — comments appear here as buyers post them.'}
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {reviews.map(review => (
            <div key={review.buyerUid} style={{ background: '#1a1a1a', border: '1px solid #242424', borderRadius: 12, padding: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 15 }}>{reactionEmoji(review.reaction)}</span>
                <span style={{ color: '#fff', fontSize: 13, fontWeight: 800 }}>{reactionLabel(review.reaction)}</span>
                <span style={{ color: '#666', fontSize: 11 }}>·</span>
                <span style={{ color: '#bbb', fontSize: 12, fontWeight: 700 }}>{review.buyerName || 'Verified buyer'}</span>
                <span style={{ padding: '2px 7px', borderRadius: 999, background: '#12210d', color: green, border: `1px solid ${green}`, fontSize: 10, fontWeight: 800 }}>
                  ✓ Bought it
                </span>
                {review.createdAt && (
                  <span style={{ color: '#666', fontSize: 11, marginLeft: 'auto' }}>{timeAgo(review.createdAt)}</span>
                )}
              </div>
              {review.text && (
                <p style={{ margin: 0, color: '#ccc', fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{review.text}</p>
              )}
              {review.tags.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: review.text ? 8 : 0 }}>
                  {review.tags.map(tag => (
                    <span key={tag} style={{ padding: '3px 8px', borderRadius: 999, background: '#111', border: '1px solid #2a2a2a', color: '#999', fontSize: 11 }}>{tag}</span>
                  ))}
                </div>
              )}
              {review.photoUrl && (
                <img src={review.photoUrl} alt="buyer's photo" style={{ width: 88, height: 88, borderRadius: 10, objectFit: 'cover', marginTop: 8, display: 'block' }} />
              )}
              {review.variant && (
                <p style={{ margin: '6px 0 0', color: '#666', fontSize: 11 }}>Bought: {review.variant}</p>
              )}
            </div>
          ))}
          {hidden > 0 && (
            <p style={{ margin: 0, color: '#666', fontSize: 11, textAlign: 'center' }}>
              Showing the latest {summary.count} of {total}.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export default ProductReviews

