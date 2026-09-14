import { useRef, useState, type ChangeEvent } from 'react'
import { addDoc, collection, serverTimestamp } from 'firebase/firestore'
import { signInAnonymously } from 'firebase/auth'
import { useNavigate } from 'react-router-dom'
import { auth, db } from './firebase'
import {
  createBuyerOrder,
  incrementProductOrderCount,
  createOrderConversation,
  sendGuestOrderRequest,
} from './createBuyerOrder'
import { useGuestOTP } from './useGuestOTP'
import { useDraft } from './useDraft'
import { uploadImageToCloudinary } from './uploadImage'
import { sendConversationMessage } from './useConversation'
import { notify } from './notifications'
import { detectSource, track } from './tracking'
import QuickRepliesPanel from './QuickRepliesPanel'
import { green, type CardProduct } from './productCardUtils'

type Props = {
  orderProduct: CardProduct | null
  messageProduct: CardProduct | null
  onCloseOrder: () => void
  onCloseMessage: () => void
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
  const [placingOrder, setPlacingOrder] = useState(false)
  const [showQuickReplies, setShowQuickReplies] = useState(false)
  const [guestName, setGuestName] = useState('')
  const [guestPhone, setGuestPhone] = useState('')
  const [guestOtpInput, setGuestOtpInput] = useState('')
  const [guestMessageSent, setGuestMessageSent] = useState(false)
  const [photoUrl, setPhotoUrl] = useState('')
  const [photoUploading, setPhotoUploading] = useState(false)
  const photoFileRef = useRef<HTMLInputElement | null>(null)
  const { state: otpState, requestOTP, verifyOTP, reset: resetOTP } = useGuestOTP()
  const {
    text: messageText,
    setText: setMessageText,
    draft: draftMsg,
    clearDraft: clearMsgDraft,
  } = useDraft(messageProduct ? `product_${messageProduct.id}` : 'none')

  const closeOrder = () => {
    setOrderSuccess(false)
    setOrderResult(null)
    setPlacingOrder(false)
    onCloseOrder()
  }

  const closeMessageModal = () => {
    setShowQuickReplies(false)
    setGuestName('')
    setGuestPhone('')
    setGuestOtpInput('')
    setGuestMessageSent(false)
    setPhotoUrl('')
    resetOTP()
    onCloseMessage()
  }

  const handleOrder = async () => {
    if (!auth.currentUser) {
      navigate('/', { state: { scrollToProviders: true } })
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
      track('order_placed', auth.currentUser.uid, sourcePlatform, {
        productId: orderProduct.id,
        productName: orderProduct.name,
        sellerId: orderProduct.sellerId,
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

  /**
   * Guest checkout. The buyer verifies their phone (the same OTP the messaging flow
   * already uses), then we give them a real anonymous account so their order behaves
   * exactly like a signed-in buyer's — real order, real thread, visible to seller.
   *
   * If Anonymous sign-in isn't enabled in Firebase, we fall back to an order request
   * the seller sees in the Inbox they already watch. The buyer is never dead-ended.
   */
  const handleGuestOrder = async () => {
    if (!orderProduct) return
    if (!buyerName.trim() || !deliveryArea.trim()) {
      alert('Please add your name and the area we should deliver to.')
      return
    }
    const phone = (otpState.phone || guestPhone).trim()
    if (!phone) return
    setPlacingOrder(true)
    const sourcePlatform = detectSource()

    let buyerUid = ''
    try {
      const cred = await signInAnonymously(auth)
      buyerUid = cred.user.uid
    } catch (err) {
      console.warn('Anonymous sign-in unavailable — sending an order request instead:', err)
    }

    try {
      if (buyerUid) {
        // Full path: a real order + a conversation the buyer can come back to.
        const { orderId } = await createBuyerOrder(orderProduct.sellerId, {
          buyerName: buyerName.trim(),
          buyerUid,
          buyerPhone: phone,
          verified: true,
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
          buyerId: buyerUid,
          sellerName: orderProduct.businessName,
          buyerName: buyerName.trim(),
          orderId,
          productName: orderProduct.name,
          productPrice: orderProduct.price,
          quantity,
        })
        await incrementProductOrderCount(orderProduct.sellerId, orderProduct.id, orderProduct.orderCount || 0)
        track('order_placed', buyerUid, sourcePlatform, {
          productId: orderProduct.id,
          productName: orderProduct.name,
          sellerId: orderProduct.sellerId,
          guest: true,
        })
        setOrderResult({ ref: orderId, phone, channel: 'account' })
      } else {
        // Fallback: the seller still gets product, quantity, area and the buyer's phone.
        await sendGuestOrderRequest({
          sellerId: orderProduct.sellerId,
          buyerName: buyerName.trim(),
          buyerPhone: phone,
          productName: orderProduct.name,
          productPrice: orderProduct.price,
          productId: orderProduct.id,
          quantity,
          deliveryArea: deliveryArea.trim(),
          note: orderMessage.trim() || undefined,
          sourcePlatform,
        })
        track('order_placed', null, sourcePlatform, {
          productId: orderProduct.id,
          productName: orderProduct.name,
          sellerId: orderProduct.sellerId,
          guest: true,
          channel: 'request',
        })
        setOrderResult({ phone, channel: 'request' })
      }

      setOrderSuccess(true)
      setTimeout(() => {
        setBuyerName('')
        setQuantity('1')
        setDeliveryArea('')
        setOrderMessage('')
        setOrderSuccess(false)
        setOrderResult(null)
        setPlacingOrder(false)
        onCloseOrder()
      }, 5000)
    } catch (err) {
      console.error('Guest order failed:', err)
      alert('Could not send your order. Check your connection and try again.')
    } finally {
      setPlacingOrder(false)
    }
  }

  const handleSendMessage = async () => {
    if ((!messageText.trim() && !photoUrl) || !messageProduct) return
    if (auth.currentUser && messageProduct.sellerId === auth.currentUser.uid) {
      alert(notify.messageSelfBlock)
      return
    }

    if (!auth.currentUser) {
      // Guest flow — verified by phone (OTP), never a full account.
      if (otpState.step === 'verified') {
        try {
          const guestId = `guest_${otpState.phone.replace(/\D/g, '')}`
          await addDoc(collection(db, 'sellers', messageProduct.sellerId, 'messages'), {
            senderName: guestName,
            senderUid: guestId,
            senderPhone: otpState.phone,
            productName: messageProduct.name,
            productPrice: messageProduct.price,
            text: messageText.trim() || '📷 Photo',
            ...(photoUrl ? { imageUrl: photoUrl } : {}),
            read: false,
            sourcePlatform: detectSource(),
            verified: true,
            createdAt: serverTimestamp(),
          })
          setGuestMessageSent(true)
          setTimeout(() => {
            clearMsgDraft()
            closeMessageModal()
          }, 1500)
        } catch (err) {
          console.error('Guest message error:', err)
          alert('Failed to send message. Try again.')
        }
      }
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
      track('message_sent', auth.currentUser.uid, detectSource(), {
        productId: messageProduct.id,
        productName: messageProduct.name,
        sellerId: messageProduct.sellerId,
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
                {!auth.currentUser && (
                  <p style={{ color: '#888', fontSize: '13px', margin: '0 0 16px', textAlign: 'left' }}>
                    No account needed — verify your phone and the seller gets your order.
                  </p>
                )}
                {orderProduct.imageUrl && (
                  <img src={orderProduct.imageUrl} alt={orderProduct.name}
                    style={{ width: '100%', height: '120px', objectFit: 'cover', borderRadius: '10px', marginBottom: '16px' }} />
                )}
                <input placeholder="Your name" value={buyerName} onChange={e => setBuyerName(e.target.value)}
                  style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #333', marginBottom: '12px', boxSizing: 'border-box', fontSize: '14px', background: '#111', color: '#fff' }} />
                {!auth.currentUser && (
                  <input placeholder="Phone number e.g. +256771234567" value={guestPhone} onChange={e => setGuestPhone(e.target.value)}
                    style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #333', marginBottom: '12px', boxSizing: 'border-box', fontSize: '14px', background: '#111', color: '#fff' }} />
                )}
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
                  <>
                    {otpState.step === 'verified' ? (
                      <button onClick={handleGuestOrder} disabled={placingOrder}
                        style={{ width: '100%', padding: '14px', background: placingOrder ? '#333' : green, color: placingOrder ? '#888' : '#000', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: placingOrder ? 'not-allowed' : 'pointer', fontSize: '15px', marginBottom: '12px' }}>
                        {placingOrder ? 'Sending your order…' : 'Place Order'}
                      </button>
                    ) : otpState.step === 'phone' || otpState.step === 'otp' ? (
                      <>
                        <p style={{ color: '#888', fontSize: '13px', marginBottom: '12px', textAlign: 'left' }}>
                          We sent a 6-digit code to <strong style={{ color: '#fff' }}>{otpState.phone}</strong>.
                        </p>
                        <input placeholder="Enter 6-digit code" value={guestOtpInput}
                          onChange={e => setGuestOtpInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                          style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #333', marginBottom: '12px', boxSizing: 'border-box', fontSize: '20px', background: '#111', color: '#fff', textAlign: 'center', letterSpacing: '8px' }} />
                        {otpState.error && <p style={{ color: '#ff4444', fontSize: '12px', marginBottom: '12px' }}>{otpState.error}</p>}
                        <button onClick={async () => {
                          const verified = await verifyOTP(guestOtpInput, buyerName)
                          if (verified) await handleGuestOrder()
                        }} disabled={otpState.loading || guestOtpInput.length !== 6}
                          style={{ width: '100%', padding: '14px', background: (otpState.loading || guestOtpInput.length !== 6) ? '#333' : green, color: '#000', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: (otpState.loading || guestOtpInput.length !== 6) ? 'not-allowed' : 'pointer', fontSize: '15px', marginBottom: '12px' }}>
                          {otpState.loading ? 'Verifying...' : 'Verify & Order'}
                        </button>
                        <button onClick={resetOTP}
                          style={{ width: '100%', padding: '8px', background: 'transparent', color: '#888', border: 'none', cursor: 'pointer', fontSize: '13px', marginBottom: '12px' }}>
                          ← Use a different number
                        </button>
                      </>
                    ) : (
                      <>
                        {otpState.error && <p style={{ color: '#ff4444', fontSize: '12px', marginBottom: '12px' }}>{otpState.error}</p>}
                        <button onClick={() => requestOTP(guestPhone)}
                          disabled={otpState.loading || !buyerName.trim() || !guestPhone.trim() || !deliveryArea.trim()}
                          style={{ width: '100%', padding: '14px', background: (otpState.loading || !buyerName.trim() || !guestPhone.trim() || !deliveryArea.trim()) ? '#333' : green, color: (otpState.loading || !buyerName.trim() || !guestPhone.trim() || !deliveryArea.trim()) ? '#888' : '#000', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: (otpState.loading || !buyerName.trim() || !guestPhone.trim() || !deliveryArea.trim()) ? 'not-allowed' : 'pointer', fontSize: '15px', marginBottom: '12px' }}>
                          {otpState.loading ? 'Sending code…' : 'Verify & Order'}
                        </button>
                      </>
                    )}
                  </>
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
              <>
                {guestMessageSent ? (
                  <div>
                    <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: green, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px', fontSize: '24px', color: '#000', fontWeight: '800' }}>✓</div>
                    <p style={{ color: '#fff', fontSize: '15px', fontWeight: '700', margin: '0 0 4px' }}>Message Sent!</p>
                    <p style={{ color: '#888', fontSize: '13px', margin: 0 }}>The seller will reply soon.</p>
                  </div>
                ) : otpState.step === 'idle' || otpState.step === 'error' ? (
                  <>
                    <p style={{ color: '#888', fontSize: '13px', marginBottom: '16px', textAlign: 'left' }}>
                      No account needed. Just verify your phone to message the seller.
                    </p>
                    <input placeholder="Your name" value={guestName} onChange={e => setGuestName(e.target.value)}
                      style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #333', marginBottom: '12px', boxSizing: 'border-box', fontSize: '14px', background: '#111', color: '#fff' }} />
                    <input placeholder="Phone number e.g. +256771234567" value={guestPhone} onChange={e => setGuestPhone(e.target.value)}
                      style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #333', marginBottom: '12px', boxSizing: 'border-box', fontSize: '14px', background: '#111', color: '#fff' }} />
                    <textarea placeholder="Write your message..." value={messageText} onChange={e => setMessageText(e.target.value)}
                      style={{ width: '100%', minHeight: '80px', padding: '12px', borderRadius: '8px', border: '1px solid #333', marginBottom: '8px', boxSizing: 'border-box', fontSize: '14px', background: '#111', color: '#fff', resize: 'vertical' }} />
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
                    {otpState.error && <p style={{ color: '#ff4444', fontSize: '12px', marginBottom: '12px' }}>{otpState.error}</p>}
                    <button onClick={() => requestOTP(guestPhone)} disabled={otpState.loading || !guestName.trim() || !guestPhone.trim()}
                      style={{ width: '100%', padding: '14px', background: (otpState.loading || !guestName.trim() || !guestPhone.trim()) ? '#333' : green, color: '#000', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: (otpState.loading || !guestName.trim() || !guestPhone.trim()) ? 'not-allowed' : 'pointer', fontSize: '15px', marginBottom: '12px' }}>
                      {otpState.loading ? 'Sending…' : 'Send Code'}
                    </button>
                  </>
                ) : (
                  <>
                    <p style={{ color: '#888', fontSize: '13px', marginBottom: '16px', textAlign: 'left' }}>
                      We sent a 6-digit code to <strong style={{ color: '#fff' }}>{otpState.phone}</strong>. Enter it below.
                    </p>
                    <input placeholder="Enter 6-digit code" value={guestOtpInput} onChange={e => setGuestOtpInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #333', marginBottom: '12px', boxSizing: 'border-box', fontSize: '20px', background: '#111', color: '#fff', textAlign: 'center', letterSpacing: '8px' }} />
                    {otpState.error && <p style={{ color: '#ff4444', fontSize: '12px', marginBottom: '12px' }}>{otpState.error}</p>}
                    <button onClick={async () => {
                      const verified = await verifyOTP(guestOtpInput, guestName)
                      if (verified) await handleSendMessage()
                    }} disabled={otpState.loading || guestOtpInput.length !== 6}
                      style={{ width: '100%', padding: '14px', background: (otpState.loading || guestOtpInput.length !== 6) ? '#333' : green, color: '#000', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: (otpState.loading || guestOtpInput.length !== 6) ? 'not-allowed' : 'pointer', fontSize: '15px', marginBottom: '12px' }}>
                      {otpState.loading ? 'Verifying...' : 'Verify & Send'}
                    </button>
                    <button onClick={resetOTP}
                      style={{ width: '100%', padding: '8px', background: 'transparent', color: '#888', border: 'none', cursor: 'pointer', fontSize: '13px', marginBottom: '12px' }}>
                      ← Use a different number
                    </button>
                  </>
                )}

                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: '16px 0' }}>
                  <div style={{ flex: 1, height: '1px', background: '#222' }} />
                  <span style={{ color: '#555', fontSize: '12px' }}>OR</span>
                  <div style={{ flex: 1, height: '1px', background: '#222' }} />
                </div>
                <button onClick={() => { closeMessageModal(); navigate('/', { state: { scrollToProviders: true } }) }}
                  style={{ width: '100%', padding: '12px', background: 'transparent', color: '#aaa', border: '1px solid #333', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', marginBottom: '12px' }}>
                  Sign in with Google
                </button>
              </>
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
