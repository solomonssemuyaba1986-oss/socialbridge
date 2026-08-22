import { useEffect, useRef, useState, useMemo, type ChangeEvent } from 'react'
import { useConversation } from './useConversation'
import { QUICK_REPLIES, SELLER_QUICK_REPLIES } from './quickReplies'
import { createBuyerOrder, incrementProductOrderCount, createOrderConversation } from './createBuyerOrder'
import { auth } from './firebase'
import { notify } from './notifications'
import { useDraft } from './useDraft'
import { uploadImageToCloudinary } from './uploadImage'
import ProductPreview from './ProductPreview'

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
  const { messages, loading, sendMessage, sendImageBatch, conversationId } = useConversation(sellerId, buyerId)
  const { text, setText, clearDraft } = useDraft(conversationId ? `convo_${conversationId}` : 'none')
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
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [pendingImages, setPendingImages] = useState<string[]>([])
  const [previewImage, setPreviewImage] = useState<string | null>(null)

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
        productId,
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

      // Persist the order into the chat thread (creates it if needed) — visible to both sides
      await createOrderConversation({
        sellerId,
        buyerId,
        sellerName: sellerName || 'Seller',
        buyerName: buyerNameOrder,
        orderId: orderId || '',
        productName: productName || '',
        productPrice: productPrice || '',
        quantity,
      })

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

  const PHOTO_CLUSTER_WINDOW_MS = 3 * 60 * 1000

  // Consecutive photo-only messages (same sender, within the window) become one compact cluster.
  const clusters = useMemo(() => {
    const isPhotoOnly = (m: any) =>
      m.type === 'image' && m.imageUrl && !(m.text && m.text !== '📷 Photo')
    const result: ({ kind: 'images'; messages: any[] } | { kind: 'single'; message: any })[] = []
    for (const m of messages) {
      if (!isPhotoOnly(m)) {
        result.push({ kind: 'single', message: m })
        continue
      }
      const prev = result[result.length - 1]
      if (prev && prev.kind === 'images' && prev.messages.length > 0) {
        const last = prev.messages[prev.messages.length - 1]
        const t1 = last.createdAt?.toDate?.()?.getTime() || 0
        const t2 = m.createdAt?.toDate?.()?.getTime() || 0
        if (last.senderId === m.senderId && t2 - t1 <= PHOTO_CLUSTER_WINDOW_MS) {
          prev.messages.push(m)
          continue
        }
      }
      result.push({ kind: 'images', messages: [m] })
    }
    return result
  }, [messages])

  const handleSend = async (newText?: string) => {
    const messageText = (newText !== undefined ? newText : text).trim()
    if (!messageText && pendingImages.length === 0) return
    const senderId = auth.currentUser?.uid
    if (!senderId) return
    if (senderId === sellerId && senderId === buyerId) {
      showFeedback("You can't message your self.", 'error')
      return
    }
    try {
      if (pendingImages.length > 0) {
        await sendImageBatch(senderId, pendingImages, messageText || '📷 Photo', sellerName || 'Seller', buyerName || 'Buyer')
      } else {
        await sendMessage(senderId, messageText, sellerName || 'Seller', buyerName || 'Buyer')
      }
      clearDraft()
      setPendingImages([])
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

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file
    if (!file) return
    setUploadingImage(true)
    try {
      const url = await uploadImageToCloudinary(file)
      setPendingImages(prev => [...prev, url]) // stage it — nothing is sent until you hit Send
    } catch (err) {
      console.error('Photo upload failed:', err)
      showFeedback(notify.messageFailed, 'error')
    } finally {
      setUploadingImage(false)
    }
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
          clusters.map((c: any, ci: number) => {
            if (c.kind === 'images' && c.messages.length > 1) {
              const last = c.messages[c.messages.length - 1]
              const isSeller = last.senderId === sellerId
              const isMe = last.senderId === auth.currentUser?.uid
              const borderColor = isSeller ? '#3399ff' : '#ff4444'
              const senderName = isMe ? 'Me' : (isSeller ? (sellerName || 'Seller') : (buyerName || 'Buyer'))
              const senderIcon = isMe ? '👤' : (isSeller ? '🏪' : '👤')
              const status = last.status || 'sent'
              const statusInfo = { sent: { color: '#adff2f', label: 'Sent' }, delivered: { color: '#3399ff', label: 'Delivered' }, seen: { color: '#00e5ff', label: 'Seen' } }[status as 'sent' | 'delivered' | 'seen'] || { color: '#adff2f', label: 'Sent' }
              const cols = Math.min(c.messages.length, 3)
              return (
                <div key={`img-${ci}`} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ fontSize: 12, color: borderColor, fontWeight: 600 }}>{senderIcon} {senderName}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 6, maxWidth: cols === 1 ? 240 : 360 }}>
                    {c.messages.map((m: any) => (
                      <img key={m.id} src={m.imageUrl} alt="photo" onClick={() => setPreviewImage(m.imageUrl)}
                        style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 10, border: `1px solid ${borderColor}`, cursor: 'zoom-in' }} />
                    ))}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 11, color: '#666' }}>
                    <span>{last.createdAt?.toDate ? last.createdAt.toDate().toLocaleString() : 'Now'}</span>
                    {isMe && <span style={{ color: statusInfo.color, fontWeight: 700 }}>{statusInfo.label}</span>}
                  </div>
                </div>
              )
            }
            const m = c.kind === 'images' ? c.messages[0] : c.message
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
            if (m.type === 'image' && m.imageUrl) {
              const isSeller = m.senderId === sellerId
              const isMe = m.senderId === auth.currentUser?.uid
              const senderName = isMe ? 'Me' : (isSeller ? (sellerName || 'Seller') : (buyerName || 'Buyer'))
              const senderIcon = isMe ? '👤' : (isSeller ? '🏪' : '👤')
              const status = m.status || 'sent'
              const statusInfo = { sent: { color: '#adff2f', label: 'Sent' }, delivered: { color: '#3399ff', label: 'Delivered' }, seen: { color: '#00e5ff', label: 'Seen' } }[status as 'sent' | 'delivered' | 'seen'] || { color: '#adff2f', label: 'Sent' }
              return (
                <div key={m.id} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ fontSize: 12, color: isSeller ? '#3399ff' : '#ff4444', fontWeight: 600 }}>{senderIcon} {senderName}</div>
                  <img src={m.imageUrl} alt="photo" onClick={() => setPreviewImage(m.imageUrl)}
                    style={{ maxWidth: '75%', borderRadius: 12, border: `1px solid ${isSeller ? '#3399ff' : '#ff4444'}`, cursor: 'zoom-in', alignSelf: 'flex-start' }} />
                  {m.text && m.text !== '📷 Photo' && (
                    <div style={{ maxWidth: '75%', background: '#111', color: '#eee', padding: '10px 14px', borderRadius: '4px 12px 12px 12px', borderTop: '1px solid #222', borderRight: '1px solid #222', borderBottom: '1px solid #222', borderLeft: `4px solid ${isSeller ? '#3399ff' : '#ff4444'}`, fontSize: 14, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                      {m.text}
                    </div>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 11, color: '#666' }}>
                    <span>{m.createdAt?.toDate ? m.createdAt.toDate().toLocaleString() : 'Now'}</span>
                    {isMe && <span style={{ color: statusInfo.color, fontWeight: 700 }}>{statusInfo.label}</span>}
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
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={() => setShowQuickReplies(prev => !prev)} style={{ width: 46, height: 46, borderRadius: 16, background: '#222', border: '1px solid #333', color: '#fff', cursor: 'pointer', fontSize: 24, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
          <button onClick={() => fileInputRef.current?.click()} disabled={uploadingImage}
            style={{ width: 46, height: 46, borderRadius: 16, background: uploadingImage ? '#333' : '#222', border: '1px solid #333', color: uploadingImage ? '#888' : '#fff', cursor: uploadingImage ? 'not-allowed' : 'pointer', fontSize: 20, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {uploadingImage ? '⏳' : '📎'}
          </button>
          <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFileChange} />
          <input value={text} onChange={e => setText(e.target.value)} placeholder="Write a reply..." style={{ flex: 1, padding: '14px 16px', borderRadius: 16, border: '1px solid #333', background: '#101010', color: '#fff', minHeight: 46 }} />
          <button onClick={() => handleSend()} disabled={uploadingImage}
            style={{ background: uploadingImage ? '#3a4d2a' : '#adff2f', color: '#000', padding: '13px 22px', borderRadius: 16, border: 'none', fontWeight: 700, cursor: uploadingImage ? 'not-allowed' : 'pointer' }}>Send</button>
        </div>
        {pendingImages.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, background: '#111', border: '1px solid #333', borderRadius: 12, padding: 8 }}>
            <div style={{ display: 'flex', gap: 6, overflowX: 'auto' }}>
              {pendingImages.map((url, i) => (
                <div key={i} style={{ position: 'relative', flexShrink: 0 }}>
                  <img src={url} alt="photo" style={{ width: 56, height: 56, borderRadius: 8, objectFit: 'cover' }} />
                  <button onClick={() => setPendingImages(prev => prev.filter((_, j) => j !== i))} disabled={uploadingImage}
                    style={{ position: 'absolute', top: -6, right: -6, background: '#ff4444', border: 'none', color: '#fff', borderRadius: '50%', width: 18, height: 18, cursor: uploadingImage ? 'not-allowed' : 'pointer', fontSize: 10, lineHeight: 1 }}>✕</button>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ color: '#888', fontSize: 12, lineHeight: 1.4 }}>
                {uploadingImage ? 'Uploading photo…' : `${pendingImages.length} photo${pendingImages.length > 1 ? 's' : ''} — sends together.`}
              </span>
              <button onClick={() => setPendingImages([])} disabled={uploadingImage}
                style={{ padding: '4px 10px', background: 'transparent', color: '#ff6666', border: '1px solid #553333', borderRadius: 8, cursor: uploadingImage ? 'not-allowed' : 'pointer', fontSize: 12 }}>
                Clear all
              </button>
            </div>
          </div>
        ) : uploadingImage ? (
          <p style={{ margin: 0, color: '#888', fontSize: 12 }}>Uploading photo…</p>
        ) : null}

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

      {/* Full-screen photo preview */}
      {previewImage && (
        <ProductPreview images={[previewImage]} startIndex={0} onClose={() => setPreviewImage(null)} />
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
