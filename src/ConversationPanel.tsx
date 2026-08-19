import { useEffect, useRef, useState } from 'react'
import { collection, addDoc, serverTimestamp } from 'firebase/firestore'
import { useConversation } from './useConversation'
import { QUICK_REPLIES, SELLER_QUICK_REPLIES } from './quickReplies'
import { createBuyerOrder, incrementProductOrderCount } from './createBuyerOrder'
import { auth, db } from './firebase'
import { notify } from './notifications'
import { useDraft } from './useDraft'

const green = '#adff2f'

type Props = {
  sellerId: string
  buyerId: string
  sellerName?: string
  buyerName?: string
  productName?: string
  productPrice?: string
  productImage?: string
  productId?: string
  orderCount?: number
}

export default function ConversationPanel({ sellerId, buyerId, sellerName, buyerName, productName, productPrice, productImage, productId, orderCount }: Props) {
  const { messages, loading, sendMessage, conversationId } = useConversation(sellerId, buyerId)
  const { text, setText, draft, clearDraft } = useDraft(conversationId ? `convo_${conversationId}` : 'none')
  const [showQuickReplies, setShowQuickReplies] = useState(false)
  const [showOrderModal, setShowOrderModal] = useState(false)
  const [buyerNameOrder, setBuyerNameOrder] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [deliveryArea, setDeliveryArea] = useState('')
  const [orderMessage, setOrderMessage] = useState('')
  const [orderSuccess, setOrderSuccess] = useState(false)
  const [orderRef, setOrderRef] = useState('')
  const [feedbackMessage, setFeedbackMessage] = useState('')
  const [feedbackType, setFeedbackType] = useState<'success' | 'error' | 'info'>('success')
  const [feedbackVisible, setFeedbackVisible] = useState(false)
  const listRef = useRef<HTMLDivElement | null>(null)

  const showFeedback = (msg: string, type: 'success' | 'error' | 'info' = 'success') => {
    setFeedbackMessage(msg)
    setFeedbackType(type)
    setFeedbackVisible(true)
  }

  useEffect(() => {
    if (!feedbackVisible) return
    const timeoutId = window.setTimeout(() => setFeedbackVisible(false), 4500)
    return () => window.clearTimeout(timeoutId)
  }, [feedbackVisible])

  const handleBuyNow = async () => {
    if (!buyerNameOrder.trim()) {
      showFeedback(notify.orderNameRequired, 'error')
      return
    }
    if (!deliveryArea.trim()) {
      showFeedback(notify.orderDeliveryRequired, 'error')
      return
    }
    if (!productName || !productPrice) {
      showFeedback(notify.orderSellerNotFound, 'error')
      return
    }

    try {
      const { orderId } = await createBuyerOrder(sellerId, {
        buyerName: buyerNameOrder,
        buyerUid: buyerId,
        productName,
        productPrice,
        quantity,
        deliveryArea,
        status: 'pending',
        read: false,
        sourcePlatform: 'Chat',
        createdAt: new Date(),
      })

      if (productId) {
        await incrementProductOrderCount(sellerId, productId, orderCount || 0)
      }

      setOrderRef(orderId || '')
      setOrderSuccess(true)
      showFeedback(notify.orderSent, 'success')

      // Persist an order confirmation into the chat thread (visible to both sides)
      if (conversationId) {
        try {
          await addDoc(collection(db, 'conversations', conversationId, 'messages'), {
            senderId: buyerId,
            type: 'order',
            text: `📦 Order placed — Ref: ${orderId || ''}`,
            orderId: orderId || '',
            productName,
            productPrice,
            quantity,
            status: 'sent',
            createdAt: serverTimestamp(),
          })
        } catch (err) {
          console.warn('Failed to write order message:', err)
        }
      }

      setTimeout(() => {
        setBuyerNameOrder(''); setQuantity('1'); setDeliveryArea(''); setOrderMessage('')
        setShowOrderModal(false)
        setOrderSuccess(false)
      }, 2500)
    } catch (err) {
      console.error('Order error:', err)
      showFeedback(notify.orderFailed, 'error')
    }
  }

  // Role-based quick replies: sellers see seller replies, buyers see buyer questions
  const isSellerViewing = auth.currentUser?.uid === sellerId
  const quickReplies = isSellerViewing ? SELLER_QUICK_REPLIES : QUICK_REPLIES

  useEffect(() => {
    const el = listRef.current
    if (!el || loading) return
    // Always snap straight to the latest message — no scroll animation
    el.scrollTop = el.scrollHeight
  }, [messages, loading])

  const handleSend = async (newText?: string) => {
    const messageText = (newText !== undefined ? newText : text).trim()
    if (!messageText) return
    const senderId = auth.currentUser?.uid
    if (!senderId) return
    if (senderId === sellerId && sellerId === buyerId) {
      showFeedback("You can't message your self.", 'error')
      return
    }
    try {
      await sendMessage(senderId, messageText, sellerName || 'Seller', buyerName || 'Buyer')
      clearDraft()
      setShowQuickReplies(false)
    } catch (err) {
      console.error('Failed to send conversation message:', err)
      showFeedback(notify.messageFailed, 'error')
    }
  }

  const handleQuickReply = async (reply: string) => {
    setText(reply)
    await handleSend(reply)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ borderBottom: '1px solid #222', paddingBottom: 12 }}>
        <div style={{ fontWeight: 800, fontSize: 18, color: '#fff' }}>{buyerName || 'Buyer'}</div>
        <div style={{ fontSize: 13, color: '#888', marginTop: 4 }}>Chat with {buyerName || 'the buyer'}</div>
        {productName && productImage && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '12px', padding: '10px', background: '#111', borderRadius: '10px', border: '1px solid #222' }}>
            <img src={productImage} alt={productName}
              style={{ width: '48px', height: '48px', borderRadius: '8px', objectFit: 'cover' }} />
            <div>
              <div style={{ fontWeight: 700, fontSize: '13px', color: '#fff' }}>{productName}</div>
              {productPrice && <div style={{ fontWeight: 800, fontSize: '13px', color: green }}>UGX {productPrice}</div>}
            </div>
          </div>
        )}
      </div>

      <div ref={listRef} style={{ maxHeight: 420, overflowY: 'auto', padding: 12, background: '#0a0a0a', borderRadius: 14, border: '1px solid #222', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {loading ? (
          <>
            <style>{`
              @keyframes rt-shimmer {
                0% { opacity: 0.4 }
                50% { opacity: 1 }
                100% { opacity: 0.4 }
              }
            `}</style>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 4 }}>
              {[0, 1, 2, 3].map(i => (
                <div key={i} style={{ display: 'flex', justifyContent: i % 2 === 0 ? 'flex-start' : 'flex-end' }}>
                  <div style={{ width: '60%', height: 34, borderRadius: 12, background: 'rgba(173,255,47,0.07)', animation: 'rt-shimmer 1.6s linear infinite' }} />
                </div>
              ))}
            </div>
          </>
        ) : messages.length === 0 ? (
          <div style={{ color: '#666' }}>No messages yet</div>
        ) : (
          messages.map((m: any) => {
            if (m.type === 'order') {
              return (
                <div key={m.id} style={{ display: 'flex', justifyContent: 'center', margin: '4px 0' }}>
                  <div style={{ background: '#12210d', border: `1px solid ${green}`, borderRadius: '12px', padding: '12px 16px', maxWidth: '90%', textAlign: 'center' }}>
                    <div style={{ fontSize: 18 }}>📦</div>
                    <div style={{ fontWeight: 800, fontSize: 13, color: green }}>Order Placed</div>
                    <div style={{ fontSize: 12, color: '#fff', fontWeight: 700, marginTop: 4 }}>Ref: {m.orderId || 'RT-...'}</div>
                    <div style={{ fontSize: 12, color: '#aaa', marginTop: 2 }}>{m.productName} · UGX {m.productPrice} × {m.quantity}</div>
                    <div style={{ fontSize: 11, color: '#888', marginTop: 6 }}>{sellerName || 'The seller'} will confirm in your Inbox</div>
                  </div>
                </div>
              )
            }
            const status = m.status || 'sent'
            const statusStyles: Record<string, { color: string; label: string }> = {
              sent: { color: '#adff2f', label: 'Sent' },
              delivered: { color: '#3399ff', label: 'Delivered' },
              seen: { color: '#00e5ff', label: 'Seen' },
            }
            const statusInfo = statusStyles[status] || statusStyles.sent
            const isSeller = m.senderId === sellerId
            const isMe = m.senderId === auth.currentUser?.uid
            const borderColor = isSeller ? '#3399ff' : '#ff4444'
            const senderName = isMe ? 'Me' : (isSeller ? (sellerName || 'Seller') : (buyerName || 'Buyer'))
            const senderIcon = isMe ? '👤' : (isSeller ? '🏪' : '👤')
            return (
              <div key={m.id} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ fontSize: 12, color: borderColor, fontWeight: 600 }}>{senderIcon} {senderName}</div>
                <div style={{ alignSelf: 'flex-start', width: 'fit-content', maxWidth: '80%', background: '#111', color: '#eee', padding: '14px', borderRadius: '4px 12px 12px 12px', borderTop: '1px solid #222', borderRight: '1px solid #222', borderBottom: '1px solid #222', borderLeft: `4px solid ${borderColor}`, fontSize: 14, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {m.text}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 11, color: '#666' }}>
                  <span>{m.createdAt?.toDate ? m.createdAt.toDate().toLocaleString() : 'Now'}</span>
                  {isMe && (
                    <span style={{ color: statusInfo.color, fontWeight: 700 }}>{statusInfo.label}</span>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {draft && (
          <span style={{ color: '#888', fontSize: 12, fontWeight: 700 }}>📝 Draft</span>
        )}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={() => setShowQuickReplies(prev => !prev)} style={{ width: 46, height: 46, borderRadius: 16, background: '#222', border: '1px solid #333', color: '#fff', cursor: 'pointer', fontSize: 24, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
          <input value={text} onChange={e => setText(e.target.value)} placeholder="Write a reply..." style={{ flex: 1, padding: '14px 16px', borderRadius: 16, border: '1px solid #333', background: '#101010', color: '#fff', minHeight: 46 }} />
          <button onClick={() => handleSend()} style={{ background: '#adff2f', color: '#000', padding: '13px 22px', borderRadius: 16, border: 'none', fontWeight: 700, cursor: 'pointer' }}>Send</button>
        </div>

        {showQuickReplies && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8, background: '#111', border: '1px solid #222', borderRadius: 16, padding: 12 }}>
            {quickReplies.map(reply => (
              <button key={reply} onClick={() => handleQuickReply(reply)} style={{ padding: '12px 14px', borderRadius: 14, border: '1px solid #333', background: '#161616', color: '#fff', cursor: 'pointer', textAlign: 'left', fontSize: 13, lineHeight: 1.4 }}>
                {reply}
              </button>
            ))}
          </div>
        )}

        {/* Buy Now Button — only for the buyer (not the seller viewing their own conversation) */}
        {auth.currentUser && auth.currentUser.uid === buyerId && buyerId !== sellerId && productName && productPrice && (
          <button onClick={() => setShowOrderModal(true)}
            style={{ width: '100%', padding: '14px', background: green, color: '#000', border: 'none', borderRadius: '12px', fontWeight: '700', cursor: 'pointer', fontSize: '15px' }}>
            Place Order — UGX {productPrice}
          </button>
        )}
      </div>

      {/* Feedback Toast */}
      {feedbackVisible && (
        <div style={{ position: 'fixed', top: '20px', left: '50%', transform: 'translateX(-50%)', zIndex: 2000, maxWidth: '400px', width: '90%', padding: '14px 16px', borderRadius: '14px', border: `1px solid ${feedbackType === 'success' ? '#2f8' : feedbackType === 'error' ? '#f55' : '#55d'}`, background: feedbackType === 'success' ? '#122a0d' : feedbackType === 'error' ? '#2a0d0d' : '#0d122a', color: '#fff', fontSize: '14px', textAlign: 'center' }}>
          {feedbackMessage}
        </div>
      )}

      {/* Order Modal */}
      {showOrderModal && (
        <div className="rt-modal-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
          <div className="rt-modal-box" style={{ background: '#1a1a1a', borderRadius: '16px', padding: '28px', width: '100%', maxWidth: '400px', border: '1px solid #222', textAlign: 'center' }}>
            {orderSuccess ? (
              <div>
                <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: green, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', fontSize: '28px', color: '#000', fontWeight: '800' }}>
                  ✓
                </div>
                <h3 style={{ color: '#fff', fontWeight: '800', fontSize: '18px', margin: '0 0 8px' }}>Order Placed!</h3>
                <p style={{ color: '#888', fontSize: '14px', margin: 0 }}>
                  Ref: <span style={{ color: green, fontWeight: '800' }}>{orderRef || 'RT-...'}</span> — {sellerName || 'the seller'} will confirm in your Inbox.
                </p>
              </div>
            ) : (
              <>
                <h3 style={{ margin: '0 0 4px', fontSize: '18px', fontWeight: '800', color: '#fff', textAlign: 'left' }}>
                  Order {productName}
                </h3>
                <p style={{ margin: '0 0 24px', color: green, fontSize: '14px', fontWeight: '700', textAlign: 'left' }}>
                  UGX {productPrice} each
                </p>
                <input placeholder="Your name" value={buyerNameOrder} onChange={e => setBuyerNameOrder(e.target.value)}
                  style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #333', marginBottom: '12px', boxSizing: 'border-box', fontSize: '14px', background: '#111', color: '#fff' }} />
                <input placeholder="Quantity" value={quantity} onChange={e => setQuantity(e.target.value)} type="number" min="1"
                  style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #333', marginBottom: '24px', boxSizing: 'border-box', fontSize: '14px', background: '#111', color: '#fff' }} />
                <input placeholder="Delivery area e.g. Nakawa, Kampala" value={deliveryArea} onChange={e => setDeliveryArea(e.target.value)}
                  style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #333', marginBottom: '24px', boxSizing: 'border-box', fontSize: '14px', background: '#111', color: '#fff' }} />
                <textarea placeholder="Write a message to the seller (optional)" value={orderMessage} onChange={e => setOrderMessage(e.target.value)}
                  style={{ width: '100%', minHeight: '100px', padding: '12px', borderRadius: '8px', border: '1px solid #333', marginBottom: '24px', boxSizing: 'border-box', fontSize: '14px', background: '#111', color: '#fff', resize: 'vertical' }} />
                <button onClick={handleBuyNow}
                  style={{ width: '100%', padding: '14px', background: green, color: '#000', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '15px', marginBottom: '12px' }}>
                  Place Order
                </button>
                <button onClick={() => { setShowOrderModal(false); setBuyerNameOrder(''); setQuantity('1'); setDeliveryArea(''); setOrderMessage(''); }}
                  style={{ width: '100%', padding: '12px', background: 'transparent', color: '#555', border: '1px solid #222', borderRadius: '8px', cursor: 'pointer', fontSize: '14px' }}>
                  Cancel
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
