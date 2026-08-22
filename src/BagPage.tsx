import { useState, useRef, useEffect, type ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, getDocs, query, where, addDoc, serverTimestamp, getDoc, doc } from 'firebase/firestore'
import { db, auth } from './firebase'
import { track, detectSource } from './tracking'
import { useBag } from './useBag'
import { createBuyerOrder, incrementProductOrderCount, createOrderConversation } from './createBuyerOrder'
import { useGuestOTP } from './useGuestOTP'
import { useDraft } from './useDraft'
import { QUICK_REPLIES } from './quickReplies'
import { uploadImageToCloudinary } from './uploadImage'

const green = '#adff2f'
const SUPPORT_WHATSAPP = (import.meta.env.VITE_SUPPORT_WHATSAPP || '256703174968').trim()
const SUPPORT_EMAIL = 'rachettcommerce@gmail.com'

function formatCount(n: number) {
  if (n < 1000) return String(n)
  if (n < 10000) return (n / 1000).toFixed(1) + 'K'
  if (n < 1000000) return Math.round(n / 1000) + 'K'
  return (n / 1000000).toFixed(1) + 'M'
}

interface BagTarget {
  id: string
  name: string
  price: string
  description: string
  imageUrl: string
  sellerSlug: string
  sellerId: string
  businessName: string
  orderCount?: number
}

function BagPage() {
  const navigate = useNavigate()
  const { items, removeFromBag, clearBag, setQuantity, count } = useBag()

  const [orderTarget, setOrderTarget] = useState<BagTarget | null>(null)
  const [messageTarget, setMessageTarget] = useState<BagTarget | null>(null)
  const [orderSuccess, setOrderSuccess] = useState(false)
  const [buyerName, setBuyerName] = useState('')
  const [orderQty, setOrderQty] = useState('1')
  const [deliveryArea, setDeliveryArea] = useState('')
  const [orderMessage, setOrderMessage] = useState('')
  const { text: messageText, setText: setMessageText, draft: draftMsg, clearDraft: clearMsgDraft } = useDraft(messageTarget ? `product_${messageTarget.id}` : 'none')
  const [showQuickReplies, setShowQuickReplies] = useState(false)
  const [guestName, setGuestName] = useState('')
  const [guestPhone, setGuestPhone] = useState('')
  const [guestOtpInput, setGuestOtpInput] = useState('')
  const [guestMessageSent, setGuestMessageSent] = useState(false)
  const { state: otpState, requestOTP, verifyOTP, reset: resetOTP } = useGuestOTP()
  const sellerIdCache = useRef<Map<string, string>>(new Map())
  const guestFileRef = useRef<HTMLInputElement | null>(null)
  const [guestImageUrl, setGuestImageUrl] = useState('')
  const [guestUploading, setGuestUploading] = useState(false)
  const [salesMap, setSalesMap] = useState<Record<string, number>>({})
  const [missingProducts, setMissingProducts] = useState<Record<string, boolean>>({})
  const [previewItem, setPreviewItem] = useState<typeof items[number] | null>(null)

  // Fetch each item's sold count (social proof) + detect deleted products
  useEffect(() => {
    const ids = new Set(items.map(i => i.productId))
    if (ids.size === 0) { setSalesMap({}); setMissingProducts({}); return }
    let cancelled = false
    Promise.all(Array.from(ids).map(async pid => {
      const item = items.find(i => i.productId === pid)
      if (!item) return
      try {
        const snap = await getDoc(doc(db, 'sellers', item.sellerId, 'products', pid))
        if (cancelled) return
        if (snap.exists()) {
          setSalesMap(prev => ({ ...prev, [pid]: snap.data().salesCount || 0 }))
          setMissingProducts(prev => {
            if (!prev[pid]) return prev
            const next = { ...prev }
            delete next[pid]
            return next
          })
        } else {
          // Product was deleted — flag it so the bag shows a clean "unavailable" state
          setMissingProducts(prev => ({ ...prev, [pid]: true }))
          setSalesMap(prev => {
            if (!(pid in prev)) return prev
            const next = { ...prev }
            delete next[pid]
            return next
          })
        }
      } catch (err) {
        console.warn('Failed to fetch product:', err)
      }
    }))
    return () => { cancelled = true }
  }, [items])

  // Deleted products can't be bought — keep them out of the total
  const total = items
    .filter(i => !missingProducts[i.productId])
    .reduce((sum, i) => sum + (Number(String(i.productPrice).replace(/[^0-9]/g, '')) || 0) * i.quantity, 0)

  const toTarget = (item: typeof items[number]): BagTarget => ({
    id: item.productId,
    name: item.productName,
    price: item.productPrice,
    description: '',
    imageUrl: item.imageUrl,
    sellerSlug: item.sellerSlug,
    sellerId: item.sellerId,
    businessName: item.businessName,
  })

  const resolveSellerId = async (slug: string, cached: string): Promise<string> => {
    if (cached) return cached
    if (sellerIdCache.current.has(slug)) return sellerIdCache.current.get(slug)!
    try {
      const snap = await getDocs(query(collection(db, 'sellers'), where('slug', '==', slug)))
      if (!snap.empty) {
        const id = snap.docs[0].id
        sellerIdCache.current.set(slug, id)
        return id
      }
    } catch (err) {
      console.error('resolveSellerId error:', err)
    }
    return ''
  }

  const openOrder = async (item: typeof items[number]) => {
    const sid = await resolveSellerId(item.sellerSlug, item.sellerId)
    if (!sid) { alert('Could not find this seller. They may have closed their store.'); return }
    setOrderTarget(toTarget(item))
    setBuyerName('')
    setOrderQty('1')
    setDeliveryArea('')
    setOrderMessage('')
    setOrderSuccess(false)
  }

  const openMessage = async (item: typeof items[number]) => {
    const sid = await resolveSellerId(item.sellerSlug, item.sellerId)
    if (!sid) { alert('Could not find this seller. They may have closed their store.'); return }
    setMessageTarget(toTarget(item))
    setShowQuickReplies(false)
    setGuestName('')
    setGuestPhone('')
    setGuestOtpInput('')
    setGuestMessageSent(false)
    resetOTP()
  }

  const handleOrder = async () => {
    if (!auth.currentUser) {
      navigate('/', { state: { scrollToProviders: true } })
      return
    }
    if (!buyerName.trim() || !deliveryArea.trim() || !orderTarget) return
    const sourcePlatform = detectSource()
    try {
      const { orderId } = await createBuyerOrder(orderTarget.sellerId, {
        buyerName: buyerName.trim(),
        buyerUid: auth.currentUser.uid,
        productName: orderTarget.name,
        productPrice: orderTarget.price,
        productId: orderTarget.id,
        quantity: orderQty,
        deliveryArea: deliveryArea.trim(),
        status: 'pending',
        read: false,
        sourcePlatform,
        createdAt: new Date(),
      })
      await createOrderConversation({
        sellerId: orderTarget.sellerId,
        buyerId: auth.currentUser.uid,
        sellerName: orderTarget.businessName,
        buyerName: buyerName.trim(),
        orderId,
        productName: orderTarget.name,
        productPrice: orderTarget.price,
        quantity: orderQty,
      })
      await incrementProductOrderCount(orderTarget.sellerId, orderTarget.id, orderTarget.orderCount || 0)
      track('order_placed', auth.currentUser.uid, sourcePlatform, { productId: orderTarget.id, productName: orderTarget.name, sellerId: orderTarget.sellerId })
      setOrderSuccess(true)
      setTimeout(() => {
        setOrderTarget(null)
        setOrderSuccess(false)
      }, 2500)
    } catch (err) {
      console.error('Order failed:', err)
      alert('Failed to place order. Try again.')
    }
  }

  const closeMessageModal = () => {
    setMessageTarget(null)
    setShowQuickReplies(false)
    setGuestName('')
    setGuestPhone('')
    setGuestOtpInput('')
    setGuestMessageSent(false)
    setGuestImageUrl('')
    resetOTP()
  }

  const handleGuestPhoto = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setGuestUploading(true)
    try {
      const url = await uploadImageToCloudinary(file)
      setGuestImageUrl(url)
    } catch (err) {
      console.error('Photo upload failed:', err)
      alert('Photo upload failed. Try again.')
    } finally {
      setGuestUploading(false)
    }
  }

  const handleSendMessage = async () => {
    if ((!messageText.trim() && !guestImageUrl) || !messageTarget) return
    if (!auth.currentUser) {
      // Guest flow
      if (otpState.step === 'verified') {
        try {
          const guestId = `guest_${otpState.phone.replace(/\D/g, '')}`
          await addDoc(collection(db, 'sellers', messageTarget.sellerId, 'messages'), {
            senderName: guestName,
            senderUid: guestId,
            senderPhone: otpState.phone,
            productName: messageTarget.name,
            productPrice: messageTarget.price,
            text: messageText.trim() || '📷 Photo',
            ...(guestImageUrl ? { imageUrl: guestImageUrl } : {}),
            read: false,
            sourcePlatform: detectSource(),
            verified: true,
            createdAt: serverTimestamp(),
          })
          setGuestMessageSent(true)
          clearMsgDraft()
          setTimeout(() => closeMessageModal(), 1500)
        } catch (err) {
          console.error('Guest message error:', err)
          alert('Failed to send message. Try again.')
        }
      }
      return
    }
    // Signed-in flow
    try {
      await addDoc(collection(db, 'sellers', messageTarget.sellerId, 'messages'), {
        senderName: auth.currentUser.displayName || 'Buyer',
        senderUid: auth.currentUser.uid,
        receiverUid: messageTarget.sellerId,
        productName: messageTarget.name,
        productPrice: messageTarget.price,
        text: messageText.trim() || '📷 Photo',
        ...(guestImageUrl ? { imageUrl: guestImageUrl } : {}),
        read: false,
        sourcePlatform: detectSource(),
        createdAt: serverTimestamp(),
      })
      track('message_sent', auth.currentUser.uid, detectSource(), { productId: messageTarget.id, productName: messageTarget.name, sellerId: messageTarget.sellerId })
      clearMsgDraft()
      closeMessageModal()
      alert('Message sent! The seller will reply soon.')
    } catch (err) {
      console.error('Message error:', err)
      alert('Failed to send message. Try again.')
    }
  }

  if (count === 0) {
    return (
      <div style={{ minHeight: '100vh', background: '#0f0f0f', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '20px', fontFamily: 'sans-serif', color: '#fff' }}>
        <p style={{ fontSize: '48px', margin: '0 0 16px' }}>🛍️</p>
        <h2 style={{ fontWeight: '800', margin: '0 0 8px', fontSize: '22px' }}>Your bag is empty</h2>
        <p style={{ color: '#888', fontSize: '14px', margin: '0 0 24px', textAlign: 'center' }}>Browse stores and tap 🛍️ on any product to save it here.</p>
        <button onClick={() => navigate('/browse')}
          style={{ padding: '14px 32px', background: green, color: '#000', border: 'none', borderRadius: '12px', fontWeight: '800', cursor: 'pointer', fontSize: '15px' }}>
          Browse Stores
        </button>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f0f', fontFamily: 'sans-serif', color: '#fff', padding: '20px' }}>
      <div style={{ maxWidth: '640px', margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h1 style={{ margin: 0, fontSize: '22px', fontWeight: '800' }}>🛍️ Your Bag ({count})</h1>
          <button onClick={clearBag}
            style={{ padding: '8px 16px', background: 'transparent', color: '#888', border: '1px solid #333', borderRadius: '8px', cursor: 'pointer', fontSize: '13px' }}>
            Clear All
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {items.map(item => {
            const isMissing = !!missingProducts[item.productId]
            return (
              <div key={item.productId}
                style={{ background: '#1a1a1a', borderRadius: '12px', padding: '14px', border: isMissing ? '1px solid #333' : '1px solid #222', display: 'flex', gap: '14px', alignItems: 'center', opacity: isMissing ? 0.85 : 1 }}>
                <img src={item.imageUrl || 'https://placehold.co/80/1a1a1a/333333'} alt={item.productName}
                  style={{ width: '72px', height: '72px', borderRadius: '8px', objectFit: 'cover', flexShrink: 0, cursor: 'pointer', filter: isMissing ? 'grayscale(80%)' : 'none' }}
                  onClick={() => setPreviewItem(item)} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: '0 0 4px', fontWeight: '700', fontSize: '14px', color: isMissing ? '#888' : '#fff', cursor: 'pointer' }} onClick={() => setPreviewItem(item)}>{item.productName}</p>
                  <p style={{ margin: '0 0 4px', fontSize: '12px', color: '#888' }}>{item.businessName}</p>
                  {isMissing ? (
                    <p style={{ margin: 0, color: '#ff6b6b', fontSize: '12px', fontWeight: '700' }}>❌ Product no longer available</p>
                  ) : (
                    <>
                      <p style={{ margin: 0, fontWeight: '800', fontSize: '14px', color: green }}>UGX {item.productPrice}</p>
                      {(salesMap[item.productId] || 0) > 0 && (
                        <p style={{ display: 'inline-block', margin: '6px 0 0', padding: '3px 10px', background: green, color: '#000', borderRadius: '999px', fontSize: '12px', fontWeight: '800', lineHeight: 1.4 }}>
                          ✓ {formatCount(salesMap[item.productId] || 0)} bought
                        </p>
                      )}
                    </>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'center' }}>
                  {!isMissing && (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: '#0f0f0f', borderRadius: '8px', padding: '2px' }}>
                        <button onClick={() => setQuantity(item.productId, item.quantity - 1)}
                          style={{ width: '28px', height: '28px', background: '#222', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '14px', fontWeight: '700', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
                        <span style={{ width: '28px', textAlign: 'center', fontSize: '13px', fontWeight: '700', color: '#fff' }}>{item.quantity}</span>
                        <button onClick={() => setQuantity(item.productId, item.quantity + 1)}
                          style={{ width: '28px', height: '28px', background: '#222', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '14px', fontWeight: '700', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
                      </div>
                      <button onClick={() => openMessage(item)}
                        style={{ padding: '6px 12px', background: '#222', color: '#fff', border: '1px solid #333', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '11px', whiteSpace: 'nowrap' }}>
                        💬 Message
                      </button>
                      <button onClick={() => openOrder(item)}
                        style={{ padding: '6px 12px', background: green, color: '#000', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '11px', whiteSpace: 'nowrap' }}>
                        Buy Now
                      </button>
                    </>
                  )}
                  <button onClick={() => removeFromBag(item.productId)}
                    style={{ padding: '6px 12px', background: isMissing ? '#2a1515' : 'transparent', color: isMissing ? '#ff6b6b' : '#888', border: isMissing ? '1px solid #ff6b6b' : '1px solid #333', borderRadius: '8px', cursor: 'pointer', fontSize: '11px', whiteSpace: 'nowrap', fontWeight: isMissing ? 700 : 400 }}>
                    Remove{isMissing ? ' item' : ''}
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        {/* Total */}
        <div style={{ marginTop: '20px', padding: '16px', background: '#1a1a1a', borderRadius: '12px', border: '1px solid #222', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: '#888', fontSize: '14px' }}>Total</span>
          <span style={{ fontWeight: '800', fontSize: '18px', color: green }}>UGX {total.toLocaleString()}</span>
        </div>

        {/* Bag support row */}
        <div style={{ marginTop: '16px', padding: '16px', background: '#1a1a1a', borderRadius: '12px', border: '1px solid #222', textAlign: 'center' }}>
          <p style={{ margin: '0 0 10px', color: '#888', fontSize: '13px' }}>❓ Need help with your bag or an order?</p>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <button onClick={() => navigate('/help?topic=bag')} style={{ padding: '8px 14px', background: '#222', color: '#fff', border: '1px solid #333', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: '700', whiteSpace: 'nowrap' }}>📖 Help Center</button>
            <a href={`https://wa.me/${SUPPORT_WHATSAPP}`} target="_blank" rel="noreferrer" style={{ padding: '8px 14px', background: '#222', color: '#fff', border: '1px solid #333', borderRadius: '8px', fontSize: '12px', fontWeight: '700', textDecoration: 'none', whiteSpace: 'nowrap' }}>💬 WhatsApp us</a>
            <a href={`mailto:${SUPPORT_EMAIL}`} style={{ padding: '8px 14px', background: '#222', color: '#fff', border: '1px solid #333', borderRadius: '8px', fontSize: '12px', fontWeight: '700', textDecoration: 'none', whiteSpace: 'nowrap' }}>✉️ Email</a>
          </div>
        </div>
      </div>

      {/* Order Modal */}
      {orderTarget && (
        <div onClick={() => { setOrderTarget(null); setOrderSuccess(false) }}
          style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', overflowY: 'auto' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: '#1a1a1a', borderRadius: '16px', padding: '28px', width: '100%', maxWidth: '400px', border: '1px solid #222', textAlign: 'center' }}>
            {orderSuccess ? (
              <div>
                <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: green, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', fontSize: '28px', color: '#000', fontWeight: '800' }}>
                  ✓
                </div>
                <h3 style={{ color: '#fff', fontWeight: '800', fontSize: '18px', margin: '0 0 8px' }}>Order Sent!</h3>
                <p style={{ color: '#888', fontSize: '14px', margin: 0 }}>The seller will contact you to confirm delivery.</p>
                <button onClick={() => navigate('/inbox')} style={{ marginTop: '14px', padding: '10px 16px', background: green, color: '#000', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '13px' }}>Track it in your Inbox →</button>
              </div>
            ) : (
              <>
                <h3 style={{ margin: '0 0 4px', fontSize: '18px', fontWeight: '800', color: '#fff', textAlign: 'left' }}>
                  Order {orderTarget.name}
                </h3>
                <p style={{ margin: '0 0 24px', color: green, fontSize: '14px', fontWeight: '700', textAlign: 'left' }}>
                  UGX {orderTarget.price} each
                </p>
                <input placeholder="Your name" value={buyerName} onChange={e => setBuyerName(e.target.value)}
                  style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #333', marginBottom: '12px', boxSizing: 'border-box', fontSize: '14px', background: '#111', color: '#fff' }} />
                <input placeholder="Quantity" value={orderQty} onChange={e => setOrderQty(e.target.value)} type="number" min="1"
                  style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #333', marginBottom: '12px', boxSizing: 'border-box', fontSize: '14px', background: '#111', color: '#fff' }} />
                <input placeholder="Delivery area e.g. Nakawa, Kampala" value={deliveryArea} onChange={e => setDeliveryArea(e.target.value)}
                  style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #333', marginBottom: '12px', boxSizing: 'border-box', fontSize: '14px', background: '#111', color: '#fff' }} />
                <textarea placeholder="Write a message to the seller (optional)" value={orderMessage} onChange={e => setOrderMessage(e.target.value)}
                  style={{ width: '100%', minHeight: '80px', padding: '12px', borderRadius: '8px', border: '1px solid #333', marginBottom: '20px', boxSizing: 'border-box', fontSize: '14px', background: '#111', color: '#fff', resize: 'vertical' }} />
                <button onClick={handleOrder}
                  style={{ width: '100%', padding: '14px', background: green, color: '#000', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '15px', marginBottom: '12px' }}>
                  Send Order
                </button>
                <button onClick={() => { setOrderTarget(null); setOrderSuccess(false) }}
                  style={{ width: '100%', padding: '12px', background: 'transparent', color: '#555', border: '1px solid #222', borderRadius: '8px', cursor: 'pointer', fontSize: '14px' }}>
                  Cancel
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Message Modal */}
      {messageTarget && (
        <div onClick={closeMessageModal}
          style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', overflowY: 'auto' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: '#1a1a1a', borderRadius: '16px', padding: '28px', width: '100%', maxWidth: '400px', border: '1px solid #222', textAlign: 'center' }}>
            <h3 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: '800', color: '#fff', textAlign: 'left' }}>
              Message about {messageTarget.name}
            </h3>
            <div style={{ marginBottom: '20px', padding: '12px', background: '#111', borderRadius: '8px', border: '1px solid #333' }}>
              <img src={messageTarget.imageUrl || 'https://placehold.co/300x120/1a1a1a/333333'} alt={messageTarget.name}
                style={{ width: '100%', height: '120px', objectFit: 'cover', borderRadius: '6px', marginBottom: '8px' }} />
              <p style={{ margin: '0 0 4px', fontWeight: '700', fontSize: '13px', color: '#fff', textAlign: 'left' }}>{messageTarget.name}</p>
              <p style={{ margin: 0, color: green, fontSize: '13px', fontWeight: '700', textAlign: 'left' }}>UGX {messageTarget.price}</p>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: showQuickReplies ? '12px' : '16px' }}>
              <button onClick={() => setShowQuickReplies(!showQuickReplies)}
                style={{ padding: '6px 12px', background: showQuickReplies ? '#1a2a1a' : '#111', color: green, border: `1px solid ${green}`, borderRadius: '20px', cursor: 'pointer', fontSize: '12px', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '5px' }}>
                ⚡ Quick replies {showQuickReplies ? '▲' : '▼'}
              </button>
            </div>
            {showQuickReplies && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '16px', background: '#111', borderRadius: '10px', padding: '10px', border: '1px solid #2a2a2a' }}>
                {QUICK_REPLIES.map(q => (
                  <button key={q} onClick={() => { setMessageText(q); setShowQuickReplies(false) }}
                    style={{ textAlign: 'left', padding: '9px 12px', background: '#1a1a1a', color: '#ddd', border: '1px solid #2a2a2a', borderRadius: '8px', cursor: 'pointer', fontSize: '13px' }}>
                    {q}
                  </button>
                ))}
              </div>
            )}

            {auth.currentUser ? (
              <>
                {/* Message Input */}
                {draftMsg && (
                  <span style={{ color: '#888', fontSize: 12, fontWeight: 700, display: 'block', marginBottom: 4 }}>📝 Draft</span>
                )}
                <textarea placeholder="Write your message..." value={messageText} onChange={e => setMessageText(e.target.value)}
                  style={{ width: '100%', minHeight: '100px', padding: '12px', borderRadius: '8px', border: '1px solid #333', marginBottom: '8px', boxSizing: 'border-box', fontSize: '14px', background: '#111', color: '#fff', resize: 'vertical' }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '20px' }}>
                  <button onClick={() => guestFileRef.current?.click()} disabled={guestUploading}
                    style={{ padding: '8px 12px', background: '#222', color: '#fff', border: '1px solid #333', borderRadius: '8px', cursor: guestUploading ? 'not-allowed' : 'pointer', fontSize: '12px', fontWeight: 700, whiteSpace: 'nowrap' }}>
                    {guestUploading ? '⏳ Uploading…' : '📎 Add photo'}
                  </button>
                  <input ref={guestFileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleGuestPhoto} />
                  {guestImageUrl && (
                    <div style={{ position: 'relative' }}>
                      <img src={guestImageUrl} alt="photo" style={{ width: 48, height: 48, borderRadius: 8, objectFit: 'cover' }} />
                      <button onClick={() => setGuestImageUrl('')} style={{ position: 'absolute', top: -6, right: -6, background: '#ff4444', border: 'none', color: '#fff', borderRadius: '50%', width: 18, height: 18, cursor: 'pointer', fontSize: 11, lineHeight: 1 }}>✕</button>
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
                    <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: green, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px', fontSize: '24px', color: '#000', fontWeight: '800' }}>
                      ✓
                    </div>
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
                      style={{ width: '100%', minHeight: '80px', padding: '12px', borderRadius: '8px', border: '1px solid #333', marginBottom: '20px', boxSizing: 'border-box', fontSize: '14px', background: '#111', color: '#fff', resize: 'vertical' }} />
                    {otpState.error && <p style={{ color: '#ff4444', fontSize: '12px', marginBottom: '12px' }}>{otpState.error}</p>}
                    <button onClick={() => requestOTP(guestPhone)} disabled={otpState.loading || !guestName.trim() || !guestPhone.trim()}
                      style={{ width: '100%', padding: '14px', background: (otpState.loading || !guestName.trim() || !guestPhone.trim()) ? '#333' : green, color: '#000', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: (otpState.loading || !guestName.trim() || !guestPhone.trim()) ? 'not-allowed' : 'pointer', fontSize: '15px', marginBottom: '12px' }}>
                      {otpState.loading ? 'Sending code...' : 'Send Verification Code'}
                    </button>
                  </>
                ) : otpState.step === 'otp' ? (
                  <>
                    <p style={{ color: '#888', fontSize: '13px', marginBottom: '16px', textAlign: 'left' }}>
                      A 6-digit code was sent to <strong style={{ color: '#fff' }}>{otpState.phone}</strong>. Enter it below.
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
                ) : null}

                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: '16px 0' }}>
                  <div style={{ flex: 1, height: '1px', background: '#222' }} />
                  <span style={{ color: '#555', fontSize: '12px' }}>OR</span>
                  <div style={{ flex: 1, height: '1px', background: '#222' }} />
                </div>
                <button onClick={() => { navigate('/', { state: { scrollToProviders: true } }); closeMessageModal() }}
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

      {/* Product Preview Modal */}
      {previewItem && (
        <div onClick={() => setPreviewItem(null)}
          style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.92)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', overflowY: 'auto' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: '#1a1a1a', borderRadius: '16px', padding: '20px', width: '100%', maxWidth: '400px', border: '1px solid #222', maxHeight: '92vh', overflowY: 'auto', textAlign: 'center' }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '12px' }}>
              <button onClick={() => setPreviewItem(null)} style={{ background: 'transparent', border: 'none', color: '#666', fontSize: 20, cursor: 'pointer', padding: '0 4px' }}>✕</button>
            </div>
            <img src={previewItem.imageUrl || 'https://placehold.co/600x400/1a1a1a/333333'} alt={previewItem.productName}
              style={{ width: '100%', height: '240px', objectFit: 'cover', borderRadius: '12px', marginBottom: '16px' }} />
            <h3 style={{ margin: '0 0 4px', fontSize: '18px', fontWeight: '800', color: '#fff' }}>{previewItem.productName}</h3>
            <p style={{ margin: '0 0 8px', color: '#888', fontSize: '13px' }}>{previewItem.businessName}</p>
            <p style={{ margin: '0 0 10px', fontWeight: '800', fontSize: '16px', color: green }}>UGX {previewItem.productPrice}</p>
            {(salesMap[previewItem.productId] || 0) > 0 && (
              <p style={{ display: 'inline-block', margin: '0 0 18px', padding: '3px 10px', background: green, color: '#000', borderRadius: '999px', fontSize: '12px', fontWeight: '800', lineHeight: 1.4 }}>
                ✓ {formatCount(salesMap[previewItem.productId] || 0)} bought
              </p>
            )}
            <button onClick={() => navigate(`/store/${previewItem.sellerSlug}`)}
              style={{ width: '100%', padding: '14px', background: green, color: '#000', border: 'none', borderRadius: '10px', fontWeight: '800', cursor: 'pointer', fontSize: '15px', marginBottom: '8px' }}>
              🏪 Visit seller
            </button>
            <button onClick={() => setPreviewItem(null)}
              style={{ width: '100%', padding: '12px', background: 'transparent', color: '#888', border: '1px solid #333', borderRadius: '10px', cursor: 'pointer', fontSize: '14px' }}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default BagPage
