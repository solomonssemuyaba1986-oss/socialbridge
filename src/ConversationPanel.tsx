import { useEffect, useRef, useState } from 'react'
import { useConversation } from './useConversation'
import { collection, addDoc, doc, updateDoc } from 'firebase/firestore'
import { db } from './firebase'

const green = '#adff2f'

type Props = {
  sellerId: string
  buyerId: string
  sellerName?: string
  buyerName?: string
  productName?: string
  productPrice?: string
  productImage?: string
  sellerWhatsapp?: string
  productId?: string
  orderCount?: number
}

export default function ConversationPanel({ sellerId, buyerId, sellerName, buyerName, productName, productPrice, productImage, sellerWhatsapp, productId, orderCount }: Props) {
  const { messages, loading, sendMessage } = useConversation(sellerId, buyerId)
  const [text, setText] = useState('')
  const [showQuickReplies, setShowQuickReplies] = useState(false)
  const [showOrderModal, setShowOrderModal] = useState(false)
  const [buyerNameOrder, setBuyerNameOrder] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [deliveryArea, setDeliveryArea] = useState('')
  const [orderMessage, setOrderMessage] = useState('')
  const [orderSuccess, setOrderSuccess] = useState(false)
  const [feedbackMessage, setFeedbackMessage] = useState('')
  const [feedbackType, setFeedbackType] = useState<'success' | 'error'>('success')
  const [feedbackVisible, setFeedbackVisible] = useState(false)
  const listRef = useRef<HTMLDivElement | null>(null)

  const showFeedback = (msg: string, type: 'success' | 'error' = 'success') => {
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
      showFeedback('Please enter your name', 'error')
      return
    }
    if (!deliveryArea.trim()) {
      showFeedback('Please add your delivery area', 'error')
      return
    }
    if (!productName || !productPrice) {
      showFeedback('Product info not available', 'error')
      return
    }

    try {
      const orderRef = await addDoc(collection(db, 'sellers', sellerId, 'orders'), {
        buyerName: buyerNameOrder,
        productName,
        productPrice,
        quantity,
        deliveryArea,
        status: 'pending',
        read: false,
        sourcePlatform: 'Chat',
        createdAt: new Date()
      })

      const orderId = `RT-${orderRef.id.slice(0, 6).toUpperCase()}`
      await updateDoc(doc(db, 'sellers', sellerId, 'orders', orderRef.id), { orderId })

      if (productId) {
        await updateDoc(doc(db, 'sellers', sellerId, 'products', productId), {
          orderCount: (orderCount || 0) + 1
        })
      }

      const whatsappText =
`🟢 NEW ORDER — Rachett

Customer: ${buyerNameOrder}
Product: ${productName}
Price: UGX ${productPrice}
Quantity: ${quantity}
Total: UGX ${Number(String(productPrice).replace(/,/g, '')) * Number(quantity)}
Delivery Area: ${deliveryArea}
${orderMessage ? `Message: ${orderMessage}\n` : ''}
Order ID: #${orderId}`

      const whatsappNumber = sellerWhatsapp || ''
      setOrderSuccess(true)
      showFeedback('Order sent! Opening WhatsApp...', 'success')
      setTimeout(() => {
        window.open(`https://wa.me/${whatsappNumber}?text=${encodeURIComponent(whatsappText)}`, '_blank')
        setBuyerNameOrder(''); setQuantity('1'); setDeliveryArea(''); setOrderMessage('')
        setShowOrderModal(false)
        setOrderSuccess(false)
      }, 1500)
    } catch (err) {
      console.error('Order error:', err)
      showFeedback('Failed to place order', 'error')
    }
  }

  const quickReplies = [
    'Yes, I can reserve it for you now.',
    'I have one ready to ship today.',
    'Would you like delivery or pickup?',
    'Can I get your exact address for delivery?',
    'I can bundle it with another item if you want.',
    'This is the last piece available, grab it now.',
    'waiting for your order, its your move.',
    'Thanks! I will confirm your order in a minute.',
    'I can hold it for you until this evening.',
    'Do you want the same color or a different one?',
    'I can offer free delivery for this order.',
    'yes, thanks for reaching on to me, what would you want to purchase?'
  ]

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const handleSend = async (newText?: string) => {
    const messageText = (newText !== undefined ? newText : text).trim()
    if (!messageText) return
    try {
      await sendMessage(sellerId, messageText, sellerName || 'Seller', buyerName || 'Buyer')
      setText('')
      setShowQuickReplies(false)
    } catch (err) {
      console.error('Failed to send conversation message:', err)
      alert('Failed to send message')
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
          <div style={{ color: '#666' }}>Loading conversation…</div>
        ) : messages.length === 0 ? (
          <div style={{ color: '#666' }}>No messages yet</div>
        ) : (
          messages.map((m: any) => {
            const status = m.status || 'sent'
            const statusStyles: Record<string, { color: string; label: string }> = {
              sent: { color: '#adff2f', label: 'Sent' },
              delivered: { color: '#3399ff', label: 'Delivered' },
              seen: { color: '#a457ff', label: 'Seen' },
            }
            const statusInfo = statusStyles[status] || statusStyles.sent
            return (
              <div key={m.id} style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
                <div style={{ fontSize: 12, color: '#888' }}>{m.senderId === sellerId ? sellerName || 'Seller' : buyerName || 'Buyer'}</div>
                <div style={{ width: '100%', background: '#111', color: '#eee', padding: '14px', borderRadius: 16, border: '1px solid #222', fontSize: 14, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {m.text}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 11, color: '#666' }}>
                  <span>{m.createdAt?.toDate ? m.createdAt.toDate().toLocaleString() : 'Now'}</span>
                  <span style={{ color: statusInfo.color, fontWeight: 700 }}>{statusInfo.label}</span>
                </div>
              </div>
            )
          })
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
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

        {/* Buy Now Button */}
        {productName && productPrice && (
          <button onClick={() => setShowOrderModal(true)}
            style={{ width: '100%', padding: '14px', background: green, color: '#000', border: 'none', borderRadius: '12px', fontWeight: '700', cursor: 'pointer', fontSize: '15px' }}>
            Buy Now — UGX {productPrice}
          </button>
        )}
      </div>

      {/* Feedback Toast */}
      {feedbackVisible && (
        <div style={{ position: 'fixed', top: '20px', left: '50%', transform: 'translateX(-50%)', zIndex: 2000, maxWidth: '400px', width: '90%', padding: '14px 16px', borderRadius: '14px', border: `1px solid ${feedbackType === 'success' ? '#2f8' : '#f55'}`, background: feedbackType === 'success' ? '#122a0d' : '#2a0d0d', color: '#fff', fontSize: '14px', textAlign: 'center' }}>
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
                <h3 style={{ color: '#fff', fontWeight: '800', fontSize: '18px', margin: '0 0 8px' }}>Order Sent!</h3>
                <p style={{ color: '#888', fontSize: '14px', margin: 0 }}>Opening WhatsApp...</p>
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
                  Send Order on WhatsApp
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
