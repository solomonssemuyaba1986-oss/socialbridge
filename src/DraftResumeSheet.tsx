import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { auth } from './firebase'
import { getConversationId, sendConversationMessage } from './useConversation'
import { useDraft } from './useDraft'
import { trackEvent } from './analytics'
import type { DraftMeta } from './draftStore'

const green = '#adff2f'

type Props = {
  draft: DraftMeta
  /** Where the message landed — the Inbox opens that thread if it has a row. */
  onSent: (conversationId: string) => void
  /** Dismissed. The draft stays exactly where it was. */
  onClose: () => void
}

/**
 * "Resume" on a draft: the product, the words you wrote, and one Send button.
 *
 * This is deliberately *not* the chat panel. The chat panel is keyed off the
 * conversation it computes from both uids, which is not always the key the draft
 * was saved under — and that is how a draft could open with an empty box. Here the
 * composer is keyed to the draft's **own** storage key, so the text written on the
 * product page is already in the box, with the product sitting above it.
 */
export default function DraftResumeSheet({ draft, onSent, onClose }: Props) {
  const navigate = useNavigate()
  const myUid = auth.currentUser?.uid || ''
  const iAmBuyer = draft.counterpartRole === 'seller'
  /**
   * A draft typed before auth resolved knows only one side; the signed-in uid fills
   * the other — the same repair the Inbox row does.
   */
  const sellerId = iAmBuyer ? draft.sellerId : (draft.sellerId || myUid)
  const buyerId = iAmBuyer ? (draft.buyerId || myUid) : draft.buyerId
  const canSend = Boolean(myUid && sellerId && buyerId && sellerId !== buyerId)
  const conversationId = canSend ? getConversationId(sellerId, buyerId) : ''
  const sellerName = iAmBuyer ? (draft.counterpartName || 'Seller') : (auth.currentUser?.displayName || 'You')
  const buyerName = iAmBuyer ? (auth.currentUser?.displayName || 'Buyer') : (draft.counterpartName || 'Buyer')

  const { text, setText, clearDraft } = useDraft(
    draft.conversationId,
    {
      sellerId,
      buyerId,
      counterpartName: draft.counterpartName || 'Seller',
      counterpartRole: draft.counterpartRole,
      productId: draft.productId,
      productName: draft.productName,
      productPrice: draft.productPrice,
      productImage: draft.productImage,
      sellerSlug: draft.sellerSlug,
    },
    { surface: 'inbox', seed: draft.text },
  )

  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  const handleSend = async () => {
    const message = (text.trim() || draft.text.trim())
    if (!canSend) {
      setError('This draft has no one to send to yet — open the product page below.')
      return
    }
    if (!message) {
      setError('Write a message first.')
      return
    }
    setSending(true)
    setError('')
    try {
      await sendConversationMessage(sellerId, buyerId, myUid, message, sellerName, buyerName, {
        productId: draft.productId,
        productName: draft.productName,
        productPrice: draft.productPrice,
        productImage: draft.productImage,
      })
      trackEvent('message_sent', {
        conversationId,
        senderRole: iAmBuyer ? 'buyer' : 'seller',
        productId: draft.productId,
        sellerId,
        hasPhoto: false,
        isQuickReply: false,
        length: message.length,
        surface: 'inbox',
      })
      clearDraft()
      onSent(conversationId)
    } catch (err) {
      console.error('Failed to send resumed draft:', err)
      setError('Failed to send. Try again.')
    } finally {
      setSending(false)
    }
  }

  const openProduct = () => {
    if (!draft.sellerSlug || !draft.productId) return
    navigate(`/store/${draft.sellerSlug}?productId=${draft.productId}`)
    onClose()
  }


  return (
    <div onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 80 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: '#141414', borderRadius: '16px 16px 0 0', padding: '20px', width: '100%', maxWidth: '640px', maxHeight: '88vh', overflowY: 'auto', border: '1px solid #222' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '800' }}>📝 Your draft</h3>
            <p style={{ margin: '2px 0 0', color: '#888', fontSize: '12px' }}>
              {iAmBuyer ? 'To' : 'Reply to'} {draft.counterpartName || (iAmBuyer ? 'Seller' : 'Buyer')}
            </p>
          </div>
          <button onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: '#888', fontSize: '20px', cursor: 'pointer', padding: '4px 8px' }}>✕</button>
        </div>

        {/* The product this draft is about — the whole point of resuming it here */}
        {draft.productName && (
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', background: '#1a1a1a', border: '1px solid #262626', borderRadius: '12px', padding: '10px', marginBottom: '14px' }}>
            {draft.productImage && (
              <img src={draft.productImage} alt={draft.productName}
                style={{ width: '56px', height: '56px', borderRadius: '8px', objectFit: 'cover', flexShrink: 0 }} />
            )}
            <div style={{ minWidth: 0 }}>
              <div style={{ color: '#fff', fontWeight: '700', fontSize: '14px' }}>🛍️ {draft.productName}</div>
              {draft.productPrice && (
                <div style={{ color: green, fontWeight: '800', fontSize: '13px', marginTop: '2px' }}>UGX {draft.productPrice}</div>
              )}
            </div>
          </div>
        )}

        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="Write your message..."
          rows={4}
          style={{ width: '100%', padding: '12px', borderRadius: '12px', border: '1px solid #333', background: '#101010', color: '#fff', fontSize: '14px', boxSizing: 'border-box', resize: 'vertical' }}
        />
        <p style={{ margin: '8px 0 0', color: '#888', fontSize: '12px', fontWeight: '700' }}>
          📝 Saved as a draft — it stays in your Inbox until you send or cancel.
        </p>

        {error && (
          <p style={{ margin: '10px 0 0', color: '#ff6b6b', fontSize: '13px', fontWeight: '700' }}>{error}</p>
        )}

        {canSend ? (
          <button onClick={handleSend} disabled={sending}
            style={{ width: '100%', padding: '14px', marginTop: '14px', background: sending ? '#2a2a2a' : green, color: sending ? '#888' : '#000', border: 'none', borderRadius: '12px', fontWeight: '800', fontSize: '15px', cursor: sending ? 'default' : 'pointer' }}>
            {sending ? 'Sending…' : 'Send'}
          </button>
        ) : (
          <>
            <p style={{ margin: '10px 0 0', color: '#ff6b6b', fontSize: '13px', fontWeight: '700' }}>
              This draft doesn't know who it's going to yet — open the product and tap Message once.
            </p>
            {draft.sellerSlug && draft.productId && (
              <button onClick={openProduct}
                style={{ width: '100%', padding: '14px', marginTop: '10px', background: green, color: '#000', border: 'none', borderRadius: '12px', fontWeight: '800', fontSize: '15px', cursor: 'pointer' }}>
                Open the product
              </button>
            )}
          </>
        )}

        <button onClick={() => { clearDraft(); onClose() }}
          style={{ width: '100%', padding: '12px', marginTop: '8px', background: 'transparent', color: '#888', border: '1px solid #222', borderRadius: '12px', fontWeight: '700', fontSize: '14px', cursor: 'pointer' }}>
          Cancel — throw this draft away
        </button>
      </div>
    </div>
  )
}
