import { useEffect, useRef, useState } from 'react'
import { auth } from './firebase'
import { uploadImageToCloudinary } from './uploadImage'
import { postReview } from './useProductReviews'
import {
  REACTIONS,
  REVIEW_TAGS,
  canEdit,
  canPost,
  cleanReviewText,
  reactionEmoji,
  reactionLabel,
  type Reaction,
  type Review,
} from './reviewUtils'
import { trackEvent } from './analytics'
import { green } from './productCardUtils'

/**
 * "How was it?" — the whole review form, three taps.
 *
 * Written for a phone and for someone who will not type: the reaction is required (one tap), the
 * chips are optional (a tap each, and they double as countable feedback), the words are optional,
 * and a photo is optional. Nothing else is asked — no title, no "would you recommend", no scores
 * per category.
 *
 * It is opened only where the order proves a delivery (`canReview`), and the rules re-check that
 * same order server-side, so `verified: true` is never something a buyer can fake.
 */

type Props = {
  sellerId: string
  productId: string
  /** The delivered order this comment is about — the rules check it belongs to the buyer. */
  orderId: string
  /** The reference a human reads ("RT-AB12CD") — shown in the form, never used for the rules. */
  orderRef?: string
  productName?: string
  businessName?: string
  productImage?: string
  variant?: string
  /** The buyer's own comment, when they are correcting it. */
  existing?: Review | null
  surface?: string
  onClose: () => void
  /** Fired after a successful post, so the host can say "thank you". */
  onPosted?: () => void
}

function ReviewForm({
  sellerId,
  productId,
  orderId,
  orderRef,
  productName,
  businessName,
  productImage,
  variant,
  existing,
  surface = 'orders',
  onClose,
  onPosted,
}: Props) {
  const [reaction, setReaction] = useState<Reaction | null>(existing?.reaction || null)
  const [tags, setTags] = useState<string[]>(existing?.tags || [])
  const [text, setText] = useState(existing?.text || '')
  const [photoUrl, setPhotoUrl] = useState(existing?.photoUrl || '')
  const [uploading, setUploading] = useState(false)
  const [posting, setPosting] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement | null>(null)

  const editing = Boolean(existing) && canEdit(existing?.createdAt)
  const ready = canPost({ reaction, orderId, text })

  useEffect(() => {
    trackEvent('review_form_opened', { productId, sellerId, surface, eligible: Boolean(orderId) })
  }, [productId, sellerId, surface, orderId])

  const toggleTag = (tag: string) => {
    setTags(prev => (prev.includes(tag) ? prev.filter(t => t !== tag) : prev.length >= 4 ? prev : [...prev, tag]))
  }

  const handleFile = async (file?: File | null) => {
    if (!file) return
    setError('')
    setUploading(true)
    try {
      setPhotoUrl(await uploadImageToCloudinary(file))
    } catch (err) {
      console.error('Review photo upload failed:', err)
      setError('That photo did not upload. You can post without it.')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const handlePost = async () => {
    if (!reaction) {
      setError('Tap how it was first.')
      return
    }
    setPosting(true)
    setError('')
    try {
      await postReview({
        sellerId,
        productId,
        orderId,
        orderRef,
        reaction,
        tags,
        text,
        photoUrl: photoUrl || undefined,
        variant,
        buyerName: auth.currentUser?.displayName || '',
        surface,
      })
      onPosted?.()
      onClose()
    } catch (err) {
      console.error('Posting the comment failed:', err)
      const message = err instanceof Error ? err.message : ''
      setError(
        message && !message.toLowerCase().includes('permission')
          ? message
          : 'That did not post. Check your connection and try again.',
      )
    } finally {
      setPosting(false)
    }
  }

  return (
    <div
      className="rt-modal-overlay"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1600, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px', fontFamily: 'sans-serif' }}
    >
      <div
        className="rt-modal-box"
        style={{ background: '#141414', border: '1px solid #262626', borderRadius: '16px', width: '100%', maxWidth: '420px', maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid #222', flexShrink: 0 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#fff' }}>
              {existing ? 'Your comment' : 'How was it?'}
            </h3>
            <p style={{ margin: '2px 0 0', color: '#777', fontSize: '12px' }}>
              {existing ? 'You can fix a typo — only you can change this.' : 'Only buyers who received it can write here.'}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close"
            style={{ background: 'transparent', border: 'none', color: '#888', fontSize: '20px', cursor: 'pointer', padding: '4px 8px' }}>
            ✕
          </button>
        </div>

        <div style={{ overflowY: 'auto', padding: '14px 16px 6px' }}>
          {/* What this is about — the product, what they bought, and the order that proves it */}
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', background: '#1a1a1a', border: '1px solid #262626', borderRadius: '12px', padding: '10px', marginBottom: '14px' }}>
            {productImage && (
              <img src={productImage} alt={productName || ''} style={{ width: '52px', height: '52px', borderRadius: '8px', objectFit: 'cover', flexShrink: 0 }} />
            )}
            <div style={{ minWidth: 0 }}>
              <div style={{ color: '#fff', fontWeight: 700, fontSize: '14px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {productName || 'Product'}
              </div>
              <div style={{ color: '#888', fontSize: '12px' }}>
                {businessName || 'Seller'}
                {variant ? ` · ${variant}` : ''}
                {orderRef ? ` · Ref ${orderRef}` : ''}
              </div>
            </div>
          </div>

          {/* Tap 1 — required */}
          <p style={{ margin: '0 0 8px', color: '#888', fontSize: '11px', fontWeight: 800, letterSpacing: '0.5px', textTransform: 'uppercase' }}>
            {reaction ? `You said: ${reactionLabel(reaction)}` : 'How was it?'}
          </p>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
            {REACTIONS.map(r => {
              const active = reaction === r.key
              const tone = r.key === 'bad' ? '#ff6b6b' : green
              return (
                <button key={r.key} onClick={() => setReaction(r.key)}
                  style={{ flex: 1, padding: '12px 6px', background: active ? tone : '#1c1c1c', color: active ? '#000' : '#ddd', border: `1px solid ${active ? tone : '#333'}`, borderRadius: '12px', fontWeight: 800, fontSize: '12px', cursor: 'pointer', lineHeight: 1.4 }}>
                  <span style={{ display: 'block', fontSize: '20px', marginBottom: '4px' }}>{r.emoji}</span>
                  {r.label}
                </button>
              )
            })}
          </div>

          {/* What stood out — optional, tappable, and countable */}
          <p style={{ margin: '0 0 8px', color: '#888', fontSize: '11px', fontWeight: 800, letterSpacing: '0.5px', textTransform: 'uppercase' }}>
            What stood out? <span style={{ color: '#555', textTransform: 'none', letterSpacing: 0, fontWeight: 600 }}>optional</span>
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '16px' }}>
            {REVIEW_TAGS.map(tag => {
              const active = tags.includes(tag)
              return (
                <button key={tag} onClick={() => toggleTag(tag)}
                  style={{ padding: '7px 12px', borderRadius: '999px', background: active ? '#16240c' : '#1c1c1c', color: active ? green : '#ccc', border: `1px solid ${active ? green : '#333'}`, fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>
                  {tag}
                </button>
              )
            })}
          </div>



          {/* Anything to add — optional */}
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="Anything to add? (optional)"
            rows={3}
            maxLength={400}
            style={{ width: '100%', padding: '12px', borderRadius: '12px', border: '1px solid #333', background: '#101010', color: '#fff', fontSize: '14px', boxSizing: 'border-box', resize: 'vertical' }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '10px', flexWrap: 'wrap' }}>
            <button onClick={() => fileRef.current?.click()} disabled={uploading}
              style={{ padding: '9px 14px', background: '#222', color: '#fff', border: '1px solid #333', borderRadius: '10px', fontSize: '12px', fontWeight: 700, cursor: uploading ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}>
              {uploading ? '⏳ Uploading…' : '📷 Add a photo'}
            </button>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => void handleFile(e.target.files && e.target.files[0])} />
            {photoUrl && (
              <div style={{ position: 'relative' }}>
                <img src={photoUrl} alt="your photo" style={{ width: 44, height: 44, borderRadius: 8, objectFit: 'cover' }} />
                <button onClick={() => setPhotoUrl('')} aria-label="Remove photo"
                  style={{ position: 'absolute', top: -6, right: -6, background: '#ff4444', border: 'none', color: '#fff', borderRadius: '50%', width: 18, height: 18, cursor: 'pointer', fontSize: 11, lineHeight: 1 }}>
                  ✕
                </button>
              </div>
            )}
            <span style={{ color: '#555', fontSize: '11px' }}>{cleanReviewText(text).length}/400</span>
          </div>

          {error && <p style={{ margin: '12px 0 0', color: '#ff6b6b', fontSize: '13px', fontWeight: 700, lineHeight: 1.5 }}>{error}</p>}
        </div>

        <div style={{ padding: '12px 16px 16px', borderTop: '1px solid #222', flexShrink: 0 }}>
          <button onClick={handlePost} disabled={posting || uploading || !ready}
            style={{ width: '100%', padding: '14px', background: posting || uploading || !ready ? '#242424' : green, color: posting || uploading || !ready ? '#777' : '#000', border: 'none', borderRadius: '12px', fontWeight: 800, fontSize: '15px', cursor: posting || uploading || !ready ? 'not-allowed' : 'pointer' }}>
            {posting ? 'Posting…' : reaction ? `Post — ${reactionEmoji(reaction)} ${reactionLabel(reaction)}` : 'Tap a reaction, then post'}
          </button>
          {existing && (
            <p style={{ margin: '8px 0 0', color: '#666', fontSize: '11px', textAlign: 'center' }}>
              {editing ? 'You can edit this for 24 hours after posting.' : 'The 24-hour edit window has passed — this comment stands.'}
            </p>
          )}
          <button onClick={onClose} disabled={posting}
            style={{ width: '100%', padding: '12px', marginTop: '8px', background: 'transparent', color: '#888', border: '1px solid #222', borderRadius: '12px', fontWeight: 700, fontSize: '14px', cursor: 'pointer' }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

export default ReviewForm
