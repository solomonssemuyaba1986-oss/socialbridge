import { useRef, useState, type ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { auth } from './firebase'
import {
  createBuyerOrder,
  incrementProductOrderCount,
  createOrderConversation,
} from './createBuyerOrder'
import { useDraft } from './useDraft'
import { uploadImageToCloudinary } from './uploadImage'
import { getConversationId, sendConversationMessage } from './useConversation'
import { notify } from './notifications'
import { detectSource } from './tracking'
import { trackEvent } from './analytics'
import { requireSignIn } from './signInGate'
import SignInPrompt from './SignInPrompt'
import QuickRepliesPanel from './QuickRepliesPanel'
import { green, type CardProduct } from './productCardUtils'

type Props = {
  orderProduct: CardProduct | null
  messageProduct: CardProduct | null
  onCloseOrder: () => void
  onCloseMessage: () => void
  /** Which page opened these modals — stamped on order/message events. */
  surface?: string
}

/**
 * The Order + Message modals shared by Browse and Nearby — same fields, same
 * guest verification flow (OTP), same drafts, quick replies and photo attach.
 * The host page only owns which product is open.
 */
export default function ProductActions({
  orderProduct,
  messageProduct,
  onCloseOrder,
  onCloseMessage,
  surface = 'nearby',
}: Props) {
  const navigate = useNavigate()
  const [buyerName, setBuyerName] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [deliveryArea, setDeliveryArea] = useState('')
  const [orderMessage, setOrderMessage] = useState('')
  const [orderSuccess, setOrderSuccess] = useState(false)
  /** What to tell the buyer after a guest order: the ref, their phone, which channel we used. */
  const [orderResult, setOrderResult] = useState<{
    ref?: string
    phone: string
    channel: 'account' | 'request'
  } | null>(null)
  const [showQuickReplies, setShowQuickReplies] = useState(false)
  const [photoUrl, setPhotoUrl] = useState('')
  const [photoUploading, setPhotoUploading] = useState(false)
  const photoFileRef = useRef<HTMLInputElement | null>(null)
  /** One thread, one draft — product-keyed until the uid is known, so nothing is lost. */
  const draftUid = auth.currentUser?.uid ?? ''
  const messageDraftKey = messageProduct
    ? (draftUid && messageProduct.sellerId
        ? `convo_${getConversationId(messageProduct.sellerId, draftUid)}`
        : `product_${messageProduct.id}`)
    : 'none'
  const {
    text: messageText,
    setText: setMessageText,
    draft: draftMsg,
    clearDraft: clearMsgDraft,
    saveNow: saveMsgDraft,
  } = useDraft(
    messageDraftKey,
    messageProduct
      ? {
          sellerId: messageProduct.sellerId || '',
          buyerId: draftUid,
          counterpartName: messageProduct.businessName || 'Seller',
          counterpartRole: 'seller',
          productId: messageProduct.id,
          productName: messageProduct.name,
          productPrice: messageProduct.price,
          productImage: messageProduct.imageUrl,
        }
      : undefined,
    { surface },
  )

  const closeOrder = () => {
    setOrderSuccess(false)
    setOrderResult(null)
    onCloseOrder()
  }

  const closeMessageModal = () => {
    // Flush before the key changes to 'none' — a last-millisecond draft must survive.
    saveMsgDraft()
    setShowQuickReplies(false)
    setPhotoUrl('')
    onCloseMessage()
  }

  const handleOrder = async () => {
    if (!auth.currentUser) {
      // Sign in first — then straight back to this product.
      requireSignIn(navigate, {
        action: 'order',
        returnTo: window.location.pathname + window.location.search,
        productId: orderProduct?.id,
        sellerSlug: orderProduct?.sellerSlug,
      })
      return
    }
    if (orderProduct && orderProduct.sellerId === auth.currentUser.uid) {
      alert(notify.messageSelfBlock)
      return
    }
    if (!buyerName.trim() || !deliveryArea.trim() || !orderProduct) return
    const sourcePlatform = detectSource()
    try {
      const { orderId } = await createBuyerOrder(orderProduct.sellerId, {
        buyerName: buyerName.trim(),
        buyerUid: auth.currentUser.uid,
        productName: orderProduct.name,
        productPrice: orderProduct.price,
        productId: orderProduct.id,
        quantity,
        deliveryArea: deliveryArea.trim(),
        status: 'pending',
        read: false,
        sourcePlatform,
        createdAt: new Date(),
      })
      await createOrderConversation({
        sellerId: orderProduct.sellerId,
        buyerId: auth.currentUser.uid,
        sellerName: orderProduct.businessName,
        buyerName: buyerName.trim(),
        orderId,
        productName: orderProduct.name,
        productPrice: orderProduct.price,
        quantity,
      })
      await incrementProductOrderCount(orderProduct.sellerId, orderProduct.id, orderProduct.orderCount || 0)
      trackEvent('order_placed', {
        productId: orderProduct.id,
        sellerId: orderProduct.sellerId,
        price: orderProduct.price,
        quantity,
        channel: sourcePlatform,
        surface,
      })
      setOrderSuccess(true)
      setTimeout(() => {
        setBuyerName('')
        setQuantity('1')
        setDeliveryArea('')
        setOrderMessage('')
        setOrderSuccess(false)
        onCloseOrder()
      }, 2500)
    } catch (err) {
      console.error('Order failed:', err)
      alert('Failed to place order. Try again.')
    }
  }

  const handleSendMessage = async () => {
    if ((!messageText.trim() && !photoUrl) || !messageProduct) return
    if (auth.currentUser && messageProduct.sellerId === auth.currentUser.uid) {
      alert(notify.messageSelfBlock)
      return
    }

    if (!auth.currentUser || auth.currentUser.isAnonymous) {
      // No guest shortcuts any more — a real account is what lets the seller reply.
      requireSignIn(navigate, {
        action: 'message',
        returnTo: window.location.pathname + window.location.search,
        productId: messageProduct.id,
        sellerSlug: messageProduct.sellerSlug,
      })
      return
    }

    // Signed-in flow — lands in the shared conversation with the seller.
    try {
      const buyerUid = auth.currentUser.uid
      await sendConversationMessage(
        messageProduct.sellerId,
        buyerUid,
        buyerUid,
        messageText.trim() || (photoUrl ? '📷 Photo' : '🛍️ Product'),
        messageProduct.businessName || 'Seller',
        auth.currentUser.displayName || 'Buyer',
        {
          ...(photoUrl ? { imageUrl: photoUrl, type: 'image' } : {}),
          productId: messageProduct.id,
          productName: messageProduct.name,
          productPrice: messageProduct.price,
          productImage: messageProduct.imageUrl,
        },
      )
      trackEvent('message_sent', {
        productId: messageProduct.id,
        sellerId: messageProduct.sellerId,
        hasPhoto: Boolean(photoUrl),
        length: messageText.trim().length,
        surface,
        channel: detectSource(),
      })
      clearMsgDraft()
      closeMessageModal()
      alert('Message sent! The seller will reply soon.')
    } catch (err) {
      console.error('Message error:', err)
      alert('Failed to send message. Try again.')
    }
  }

  const handlePhoto = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setPhotoUploading(true)
    try {
      const url = await uploadImageToCloudinary(file)
      setPhotoUrl(url)
    } catch (err) {
      console.error('Photo upload failed:', err)
      alert('Could not upload that photo. Try another one.')
    } finally {
      setPhotoUploading(false)
    }
  }

  return (
    <>
      {/* ── Order modal ─────────────────────────────────────────────── */}
      {orderProduct && (
        <div onClick={closeOrder}
          style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', overflowY: 'auto' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: '#1a1a1a', borderRadius: '16px', padding: '28px', width: '100%', maxWidth: '400px', border: '1px solid #222', textAlign: 'center' }}>
            {orderSuccess ? (
              <div>
                <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: green, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', fontSize: '28px', color: '#000', fontWeight: '800' }}>
                  ✓
                </div>
                <h3 style={{ color: '#fff', fontWeight: '800', fontSize: '18px', margin: '0 0 8px' }}>
                  {orderResult?.channel === 'request' ? 'Order request sent!' : 'Order Sent!'}
                </h3>
                {orderResult?.ref && (
                  <p style={{ color: green, fontSize: '14px', fontWeight: '800', margin: '0 0 8px' }}>Ref: {orderResult.ref}</p>
                )}
                <p style={{ color: '#888', fontSize: '14px', margin: 0 }}>
                  {orderResult
                    ? orderResult.channel === 'request'
                      ? `${orderProduct.businessName} will call you on ${orderResult.phone} to confirm.`
                      : `${orderProduct.businessName} will reply in your Inbox — and call you on ${orderResult.phone}.`
                    : 'The seller will contact you to confirm delivery.'}
                </p>
              </div>
            ) : (
              <>
                <h3 style={{ margin: '0 0 4px', fontSize: '18px', fontWeight: '800', color: '#fff', textAlign: 'left' }}>
                  Order {orderProduct.name}
                </h3>
                <p style={{ margin: '0 0 24px', color: green, fontSize: '14px', fontWeight: '700', textAlign: 'left' }}>
                  UGX {orderProduct.price} each
                </p>
                {orderProduct.imageUrl && (
                  <img src={orderProduct.imageUrl} alt={orderProduct.name}
                    style={{ width: '100%', height: '120px', objectFit: 'cover', borderRadius: '10px', marginBottom: '16px' }} />
                )}
                <input placeholder="Your name" value={buyerName} onChange={e => setBuyerName(e.target.value)}
                  style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #333', marginBottom: '12px', boxSizing: 'border-box', fontSize: '14px', background: '#111', color: '#fff' }} />
                <input placeholder="Quantity" value={quantity} onChange={e => setQuantity(e.target.value)} type="number" min="1"
                  style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #333', marginBottom: '12px', boxSizing: 'border-box', fontSize: '14px', background: '#111', color: '#fff' }} />
                <input placeholder="Delivery area e.g. Nakawa, Kampala" value={deliveryArea} onChange={e => setDeliveryArea(e.target.value)}
                  style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #333', marginBottom: '12px', boxSizing: 'border-box', fontSize: '14px', background: '#111', color: '#fff' }} />
                <textarea placeholder="Write a message to the seller (optional)" value={orderMessage} onChange={e => setOrderMessage(e.target.value)}
                  style={{ width: '100%', minHeight: '80px', padding: '12px', borderRadius: '8px', border: '1px solid #333', marginBottom: '20px', boxSizing: 'border-box', fontSize: '14px', background: '#111', color: '#fff', resize: 'vertical' }} />
                {auth.currentUser ? (
                  <button onClick={handleOrder}
                    style={{ width: '100%', padding: '14px', background: green, color: '#000', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '15px', marginBottom: '12px' }}>
                    Send Order
                  </button>
                ) : (
                  <SignInPrompt
                    action="order"
                    returnTo={window.location.pathname + window.location.search}
                    productId={orderProduct?.id}
                    sellerSlug={orderProduct?.sellerSlug}
                    onLeave={closeOrder}
                  />
                )}
                <button onClick={closeOrder}
                  style={{ width: '100%', padding: '12px', background: 'transparent', color: '#555', border: '1px solid #222', borderRadius: '8px', cursor: 'pointer', fontSize: '14px' }}>
                  Cancel
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Message modal ───────────────────────────────────────────── */}
      {messageProduct && (
        <div onClick={closeMessageModal}
          style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', overflowY: 'auto' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: '#1a1a1a', borderRadius: '16px', padding: '24px', width: '100%', maxWidth: '400px', border: '1px solid #222', textAlign: 'center', maxHeight: '92vh', overflowY: 'auto' }}>
            <h3 style={{ margin: '0 0 16px', fontSize: '17px', fontWeight: '800', color: '#fff' }}>
              Message {messageProduct.businessName}
            </h3>

            <div style={{ marginBottom: '16px', padding: '12px', background: '#111', borderRadius: '8px', border: '1px solid #333' }}>
              <img src={messageProduct.imageUrl || 'https://placehold.co/300x120/1a1a1a/333333'} alt={messageProduct.name}
                style={{ width: '100%', height: '120px', objectFit: 'cover', borderRadius: '6px', marginBottom: '8px' }} />
              <p style={{ margin: '0 0 4px', fontWeight: '700', fontSize: '13px', color: '#fff', textAlign: 'left' }}>{messageProduct.name}</p>
              <p style={{ margin: 0, color: green, fontSize: '13px', fontWeight: '700', textAlign: 'left' }}>UGX {messageProduct.price}</p>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: showQuickReplies ? '12px' : '16px' }}>
              <button onClick={() => setShowQuickReplies(!showQuickReplies)}
                style={{ padding: '6px 12px', background: showQuickReplies ? '#1a2a1a' : '#111', color: green, border: `1px solid ${green}`, borderRadius: '20px', cursor: 'pointer', fontSize: '12px', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '5px' }}>
                ⚡ Quick replies {showQuickReplies ? '▲' : '▼'}
              </button>
            </div>
            {showQuickReplies && (
              <div style={{ marginBottom: '16px' }}>
                <QuickRepliesPanel onPick={q => { setMessageText(q); setShowQuickReplies(false) }} />
              </div>
            )}

            {auth.currentUser ? (
              <>
                {draftMsg && (
                  <span style={{ color: '#888', fontSize: 12, fontWeight: 700, display: 'block', marginBottom: 4 }}>📝 Draft</span>
                )}
                <textarea placeholder="Write your message..." value={messageText} onChange={e => setMessageText(e.target.value)}
                  style={{ width: '100%', minHeight: '100px', padding: '12px', borderRadius: '8px', border: '1px solid #333', marginBottom: '8px', boxSizing: 'border-box', fontSize: '14px', background: '#111', color: '#fff', resize: 'vertical' }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '20px' }}>
                  <button onClick={() => photoFileRef.current?.click()} disabled={photoUploading}
                    style={{ padding: '8px 12px', background: '#222', color: '#fff', border: '1px solid #333', borderRadius: '8px', cursor: photoUploading ? 'not-allowed' : 'pointer', fontSize: '12px', fontWeight: 700, whiteSpace: 'nowrap' }}>
                    {photoUploading ? '⏳ Uploading…' : '📎 Add photo'}
                  </button>
                  <input ref={photoFileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handlePhoto} />
                  {photoUrl && (
                    <div style={{ position: 'relative' }}>
                      <img src={photoUrl} alt="photo" style={{ width: 48, height: 48, borderRadius: 8, objectFit: 'cover' }} />
                      <button onClick={() => setPhotoUrl('')} style={{ position: 'absolute', top: -6, right: -6, background: '#ff4444', border: 'none', color: '#fff', borderRadius: '50%', width: 18, height: 18, cursor: 'pointer', fontSize: 11, lineHeight: 1 }}>✕</button>
                    </div>
                  )}
                </div>
                <button onClick={handleSendMessage}
                  style={{ width: '100%', padding: '14px', background: green, color: '#000', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '15px', marginBottom: '12px' }}>
                  Send Message
                </button>
              </>
            ) : (
              <SignInPrompt
                action="message"
                returnTo={window.location.pathname + window.location.search}
                productId={messageProduct?.id}
                sellerSlug={messageProduct?.sellerSlug}
                onLeave={closeMessageModal}
              />
            )}

            <button onClick={closeMessageModal}
              style={{ width: '100%', padding: '12px', background: 'transparent', color: '#555', border: '1px solid #222', borderRadius: '8px', cursor: 'pointer', fontSize: '14px' }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  )
}
