import { useEffect, useState } from 'react'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { db, auth } from './firebase'
import { useProductLikes } from './useProductLikes'
import { trackEvent } from './analytics'

type Props = {
  sellerId: string
  productId: string
  productName?: string
  orderId: string
}

/**
 * "Did you love it?" — the post-purchase question, asked once, on the delivery bubble.
 *
 * Yes → the very same ♥ a card tap casts: one per account, at most once, `source: 'purchase'`.
 * Not really → **nothing public anywhere**. That answer only informs the seller's own numbers,
 * and it is remembered so the buyer is never asked twice. A failure leaves the question
 * standing rather than claiming a vote that never landed.
 */
export default function LovePrompt({ sellerId, productId, productName, orderId }: Props) {
  const { isLiked, toggleLike } = useProductLikes()
  const [answer, setAnswer] = useState<'yes' | 'no' | null>(null)
  const [busy, setBusy] = useState(false)
  /** The product's tally — this bubble has no product doc, so it is read once, here. */
  const [count, setCount] = useState<number | undefined>(undefined)
  const uid = auth.currentUser?.uid

  useEffect(() => {
    let cancelled = false
    getDoc(doc(db, 'sellers', sellerId, 'products', productId))
      .then(snap => {
        const raw = Number(snap.data()?.likeCount ?? 0)
        if (!cancelled) setCount(Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0)
      })
      .catch(() => { /* offline — the vote still works, only the number waits */ })
    return () => { cancelled = true }
  }, [sellerId, productId])

  // Already answered on this account? Then there is nothing left to ask.
  useEffect(() => {
    if (!uid) return
    let cancelled = false
    getDoc(doc(db, 'users', uid, 'loveAnswers', orderId))
      .then(snap => {
        if (cancelled || !snap.exists()) return
        setAnswer(snap.data()?.answer === 'no' ? 'no' : 'yes')
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [uid, orderId])

  useEffect(() => {
    trackEvent('love_prompt_shown', { orderId, productId })
  }, [orderId, productId])

  const remember = async (value: 'yes' | 'no') => {
    setAnswer(value)
    trackEvent('love_prompt_answered', { orderId, productId, answer: value })
    if (!uid) return
    try {
      await setDoc(doc(db, 'users', uid, 'loveAnswers', orderId), {
        answer: value,
        productId,
        sellerId,
        at: Date.now(),
      })
    } catch (err) {
      console.warn('Failed to remember the love answer:', err)
    }
  }

  if (!uid) return null

  if (isLiked(productId) || answer === 'yes') {
    return (
      <p style={{ margin: '10px 0 0', fontSize: 12, color: green, fontWeight: 700 }}>
        ♥ Loved — that helps {productName || 'the seller'} get found
      </p>
    )
  }

  if (answer === 'no') {
    return (
      <p style={{ margin: '10px 0 0', fontSize: 12, color: '#777' }}>
        Thanks — that stays private, it only tells the seller what to improve
      </p>
    )
  }

  return (
    <div style={{ marginTop: 10 }}>
      <p style={{ margin: '0 0 8px', fontSize: 12, color: '#ccc', fontWeight: 700 }}>Did you love it?</p>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            const res = await toggleLike({
              sellerId,
              productId,
              currentCount: count,
              source: 'purchase',
              orderId,
              surface: 'inbox',
            })
            setBusy(false)
            if (res.ok) void remember('yes')
          }}
          style={{ padding: '8px 14px', background: '#ff4458', color: '#fff', border: 'none', borderRadius: 999, fontWeight: 800, fontSize: 12, cursor: busy ? 'not-allowed' : 'pointer' }}
        >
          ♥ Yes, I loved it
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void remember('no')}
          style={{ padding: '8px 14px', background: 'transparent', color: '#888', border: '1px solid #333', borderRadius: 999, fontWeight: 700, fontSize: 12, cursor: busy ? 'not-allowed' : 'pointer' }}
        >
          Not really
        </button>
      </div>
    </div>
  )
}

const green = '#adff2f'
