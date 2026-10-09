import { useEffect, useState } from 'react'
import { hasReviewed, postReview } from './useProductReviews'
import { SCORES, scoreLabel, starRow, type Score } from './reviewUtils'
import { trackEvent } from './analytics'
import { green } from './productCardUtils'

/**
 * "How was it?" — one tap, and the rating is in.
 *
 * This is the *asking* side of a comment. The delivered bubble in a thread, the line under a
 * thread's composer, and the quiet fallback on My Orders all render this, so a buyer meets the same
 * question wherever they already are. A tap on a star posts: `postReview` writes the score with no
 * words at all, which the rules accept and the product counters count. The chips, the words and a
 * photo stay one link away, for the buyer who has more to say than a number.
 *
 * Three things it will not do:
 *  - ask about an order that is not delivered (the rules would refuse the write anyway, and a
 *    button that always fails is worse than no button);
 *  - ask twice — one read of the comment says whether this buyer has already rated this product;
 *  - invent a number. Nothing is shown until that read has answered, so the stars never flash in
 *    and out for someone who rated it last week.
 */

type Props = {
  sellerId: string
  productId: string
  /**
   * The **document id** of the delivered order that proves the purchase — the security rules look
   * this document up, so it is what actually authorises the rating.
   */
  orderId: string
  /** The reference a human reads ("RT-AB12CD"). Display only; the rules ignore it. */
  orderRef?: string
  productName?: string
  /** Which surface asked — 'inbox' · 'inbox-thread' · 'orders'. */
  surface: string
  /** The line above the stars. */
  prompt?: string
  /** A buyer who wants to say more than a number: opens the full form. */
  onWriteMore?: (score?: Score) => void
  /** Told when a rating lands here, so the host can retire the row that asked. */
  onRated?: () => void
}

function RatePrompt({
  sellerId,
  productId,
  orderId,
  orderRef,
  productName,
  surface,
  prompt,
  onWriteMore,
  onRated,
}: Props) {
  /** Which order we have looked up, and what the look-up said. Keyed by the request, so a fresh
   *  order starts unseen rather than inheriting the previous order's answer. */
  const [looked, setLooked] = useState<{ key: string; rated: boolean } | null>(null)
  /** The score they gave *here*, so the confirmation can name it. */
  const [mine, setMine] = useState<Score | null>(null)
  /** Which star the pointer is over, so a buyer on a keyboard or a mouse can see which one they
   *  are about to tap — five identical stars in a row say nothing until one of them lights up. */
  const [hover, setHover] = useState<Score | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const key = `${sellerId}/${productId}/${orderId}`

  useEffect(() => {
    let cancelled = false
    void (async () => {
      // Offline or blocked reads as "already rated": better to ask nothing than to show stars that
      // would fail the moment they are tapped.
      const rated = await hasReviewed(sellerId, productId).catch(() => true)
      if (!cancelled) setLooked({ key, rated })
    })()
    return () => { cancelled = true }
  }, [key, sellerId, productId])

  /**
   * Has this been answered already — or is there nothing to ask? `null` = still looking, and it is
   * derived rather than stored: a look-up belongs to the order it was made for, so a row that
   * changes under us starts unseen instead of borrowing the previous order's answer.
   */
  const answered = looked && looked.key === key ? looked.rated : null

  useEffect(() => {
    if (answered !== false) return
    trackEvent('review_prompt_shown', { productId, sellerId, surface, orderRef: orderRef || '' })
  }, [answered, productId, sellerId, surface, orderRef])

  const rate = async (score: Score) => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await postReview({ sellerId, productId, orderId, orderRef, score, surface })
      setMine(score)
      setLooked({ key, rated: true })
      trackEvent('review_prompt_answered', { productId, sellerId, surface, score })
      onRated?.()
    } catch (err) {
      console.error('Rating failed:', err)
      // A refused write is our setup, not the buyer's mistake — so it is not dressed up as one.
      setError('That did not go through. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  if (mine !== null) {
    return (
      <p style={{ margin: '10px 0 0', fontSize: 12, color: green, fontWeight: 700, lineHeight: 1.5 }}>
        Thank you — {starRow(mine)} is on {productName || 'this product'}.
      </p>
    )
  }

  // Nothing that proves the purchase: the rules would refuse the write, and a button that always
  // fails is worse than no button.
  if (!sellerId || !productId || !orderId) return null
  // Nothing left to ask: they have rated it, or we have not finished looking.
  if (answered !== false) return null

  return (
    <div style={{ marginTop: 10 }}>
      <p style={{ margin: '0 0 6px', fontSize: 12, color: '#ccc', fontWeight: 700 }}>
        {prompt || 'How was it?'}
      </p>
      <div role="group" aria-label="Rate this order, 1 to 5 stars" style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
        {SCORES.map(s => {
          const lit = hover !== null && s <= hover
          return (
            <button
              key={s}
              type="button"
              disabled={busy}
              aria-label={`Rate ${s} out of 5${scoreLabel(s) ? ` — ${scoreLabel(s)}` : ''}`}
              title={scoreLabel(s)}
              onClick={() => void rate(s)}
              onMouseEnter={() => setHover(s)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(s)}
              onBlur={() => setHover(null)}
              style={{ width: 44, height: 44, padding: 0, background: '#1c1c1c', color: busy ? '#555' : lit ? green : '#8a8a8a', border: '1px solid #333', borderRadius: 12, fontSize: 22, lineHeight: 1, cursor: busy ? 'wait' : 'pointer' }}
            >
              ★
            </button>
          )
        })}
      </div>
      <p style={{ margin: '6px 0 0', fontSize: 11, color: '#777', lineHeight: 1.5 }}>
        {busy ? 'Saving…' : 'One tap is a rating — no words needed.'}
        {onWriteMore && !busy && (
          <>
            {' '}
            <button
              type="button"
              onClick={() => onWriteMore()}
              style={{ background: 'none', border: 'none', padding: 0, color: '#aaa', fontSize: 11, textDecoration: 'underline', cursor: 'pointer' }}
            >
              Add a photo or a few words
            </button>
          </>
        )}
      </p>
      {error && <p style={{ margin: '6px 0 0', color: '#ff6b6b', fontSize: 11, fontWeight: 700 }}>{error}</p>}
    </div>
  )
}

export default RatePrompt
