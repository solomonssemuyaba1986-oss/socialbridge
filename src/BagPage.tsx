import { useState, useRef, useEffect, type ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, getDocs, query, where, doc, onSnapshot } from 'firebase/firestore'
import { db, auth } from './firebase'
import { detectSource } from './tracking'
import { trackEvent } from './analytics'
import { useBag } from './useBag'
import { createBuyerOrder, incrementProductOrderCount, createOrderConversation } from './createBuyerOrder'
import { useAllDrafts, useDraft } from './useDraft'
import QuickRepliesPanel from './QuickRepliesPanel'
import { uploadImageToCloudinary } from './uploadImage'
import ProductPreview from './ProductPreview'
import { getConversationId, sendConversationMessage } from './useConversation'
import { notify } from './notifications'
import { consumePendingAction, requireSignIn } from './signInGate'
import SignInPrompt from './SignInPrompt'

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
  /**
   * One thread, one draft — keyed by the conversation this message would create;
   * product-keyed when the uid isn't known yet, so nothing is ever dropped.
   */
  const draftUid = auth.currentUser?.uid ?? ''
  const messageDraftKey = messageTarget
    ? (draftUid && messageTarget.sellerId
        ? `convo_${getConversationId(messageTarget.sellerId, draftUid)}`
        : `product_${messageTarget.id}`)
    : 'none'
  const {
    text: messageText,
    setText: setMessageText,
    draft: draftMsg,
    clearDraft: clearMsgDraft,
    saveNow: saveMsgDraft,
  } = useDraft(
    messageDraftKey,
    messageTarget
      ? {
          sellerId: messageTarget.sellerId || '',
          buyerId: draftUid,
          counterpartName: messageTarget.businessName || 'Seller',
          counterpartRole: 'seller',
          productId: messageTarget.id,
          productName: messageTarget.name,
          productPrice: messageTarget.price,
          productImage: messageTarget.imageUrl,
        }
      : undefined,
    { surface: 'bag' },
  )
  const [showQuickReplies, setShowQuickReplies] = useState(false)
  const sellerIdCache = useRef<Map<string, string>>(new Map())
  // Unsent messages, so a row in the bag can say "you already wrote about this".
  const { drafts: myDrafts } = useAllDrafts()
  const draftProductIds = new Set(myDrafts.map(d => d.productId).filter((id): id is string => Boolean(id)))
  const guestFileRef = useRef<HTMLInputElement | null>(null)
  const [guestImageUrl, setGuestImageUrl] = useState('')
  const [guestUploading, setGuestUploading] = useState(false)
  const [salesMap, setSalesMap] = useState<Record<string, number>>({})
  const [missingProducts, setMissingProducts] = useState<Record<string, boolean>>({})
  const [liveProducts, setLiveProducts] = useState<Record<string, { imageUrl?: string; images?: string[]; name?: string; price?: string; outOfStock?: boolean }>>({})
  const [previewItem, setPreviewItem] = useState<typeof items[number] | null>(null)
  const [previewImageIndex, setPreviewImageIndex] = useState(0)
  const [fullPreview, setFullPreview] = useState(false)
  const previewSwipeStart = useRef<{ x: number; y: number } | null>(null)

  // Reset the preview carousel whenever a different product is opened
  useEffect(() => {
    setPreviewImageIndex(0)
    setFullPreview(false)
  }, [previewItem])

  // Live product data: images, name, price, sold count + deleted-product detection.
  // Listens to each product so seller edits (image/price/name) reflect live in the bag.
  useEffect(() => {
    const ids = new Set(items.map(i => i.productId))
    if (ids.size === 0) { setSalesMap({}); setMissingProducts({}); setLiveProducts({}); return }
    const unsubs: Array<() => void> = []
    items.forEach(item => {
      const unsub = onSnapshot(
        doc(db, 'sellers', item.sellerId, 'products', item.productId),
        (snap) => {
          if (snap.exists()) {
            const d = snap.data()
            setSalesMap(prev => ({ ...prev, [item.productId]: d.salesCount || 0 }))
            setLiveProducts(prev => ({ ...prev, [item.productId]: { imageUrl: d.imageUrl || '', images: d.images || [], name: d.name || '', price: d.price || '', outOfStock: !!d.outOfStock } }))
            setMissingProducts(prev => {
              if (!prev[item.productId]) return prev
              const next = { ...prev }
              delete next[item.productId]
              return next
            })
          } else {
            // Product was deleted — flag it so the bag shows a clean "unavailable" state
            setMissingProducts(prev => ({ ...prev, [item.productId]: true }))
            setSalesMap(prev => {
              if (!(item.productId in prev)) return prev
              const next = { ...prev }
              delete next[item.productId]
              return next
            })
            setLiveProducts(prev => {
              if (!(item.productId in prev)) return prev
              const next = { ...prev }
              delete next[item.productId]
              return next
            })
          }
        },
        (err) => console.warn('Failed to listen to product:', err)
      )
      unsubs.push(unsub)
    })
    return () => { unsubs.forEach(u => u()) }
  }, [items])

  // Live view of a bag item: current image/name/price from the product doc,
  // falling back to the saved snapshot only when the product was deleted.
  const liveView = (item: typeof items[number]) => {
    const live = liveProducts[item.productId]
    return {
      imageUrl: live?.imageUrl || item.imageUrl,
      images: (live?.images?.length ? live.images : item.images) || [],
      name: live?.name || item.productName,
      price: live?.price || item.productPrice,
      isMissing: !!missingProducts[item.productId],
    }
  }

  // Deleted products can't be bought — keep them out of the total; otherwise use the live price.
  const total = items
    .filter(i => !missingProducts[i.productId])
    .reduce((sum, i) => {
      const live = liveProducts[i.productId]
      const price = live?.price || i.productPrice
      return sum + (Number(String(price).replace(/[^0-9]/g, '')) || 0) * i.quantity
    }, 0)

  const toTarget = (item: typeof items[number]): BagTarget => {
    const lv = liveView(item)
    return {
      id: item.productId,
      name: lv.name,
      price: lv.price,
      description: '',
      imageUrl: lv.imageUrl,
      sellerSlug: item.sellerSlug,
      sellerId: item.sellerId,
      businessName: item.businessName,
    }
  }

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

  /**
   * The bag is our only "save": one `bag_opened` per visit, and `bag_abandoned`
   * if they leave with items still in it — the clearest lost-intent signal we have.
   */
  const bagOpenedRef = useRef(false)
  const bagSizeRef = useRef(0)
  /** Set inside the mount effect — `Date.now()` must not run during render. */
  const bagOpenedAtRef = useRef(0)
  useEffect(() => {
    bagSizeRef.current = items.length
  }, [items.length])
  useEffect(() => {
    if (bagOpenedRef.current) return
    bagOpenedRef.current = true
    bagOpenedAtRef.current = Date.now()
    trackEvent('bag_opened', { size: items.length })
  }, [items.length])
  useEffect(() => {
    return () => {
      if (bagSizeRef.current === 0) return
      const openedAt = bagOpenedAtRef.current || Date.now()
      trackEvent('bag_abandoned', {
        size: bagSizeRef.current,
        idleMinutes: Math.max(0, Math.round((Date.now() - openedAt) / 60000)),
      })
    }
  }, [])

  const openOrder = async (item: typeof items[number]) => {
    const sid = await resolveSellerId(item.sellerSlug, item.sellerId)
    if (!sid) { alert('Could not find this seller. They may have closed their store.'); return }
    trackEvent('checkout_started', { size: items.length })
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
  }

  // Coming back from sign-in? Reopen the sheet they were blocked on.
  const restoredRef = useRef(false)
  useEffect(() => {
    if (restoredRef.current || items.length === 0) return
    restoredRef.current = true
    consumePendingAction(items.map(item => ({ id: item.productId })), {
      order: ref => {
        const item = items.find(i => i.productId === ref.id)
        if (item) void openOrder(item)
      },
      message: ref => {
        const item = items.find(i => i.productId === ref.id)
        if (item) void openMessage(item)
      },
    })
    // Runs once, the moment the bag is on screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items])

  const handleOrder = async () => {
    if (!auth.currentUser) {
      // Sign in first — then straight back to this bag item.
      requireSignIn(navigate, { action: 'order', returnTo: '/bag', productId: orderTarget?.id })
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
      trackEvent('order_placed', {
        productId: orderTarget.id,
        sellerId: orderTarget.sellerId,
        price: orderTarget.price,
        quantity: orderQty,
        bagSize: items.length,
        channel: sourcePlatform,
        surface: 'bag',
      })
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
    // Flush before the key changes to 'none' — a last-millisecond draft must survive.
    saveMsgDraft()
    setMessageTarget(null)
    setShowQuickReplies(false)
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
    if (auth.currentUser && messageTarget.sellerId === auth.currentUser.uid) {
      alert(notify.messageSelfBlock)
      return
    }
    if (!auth.currentUser || auth.currentUser.isAnonymous) {
      // Sign in with a real account — that is how the seller can reply to you.
      requireSignIn(navigate, {
        action: 'message',
        returnTo: '/bag',
        productId: messageTarget.id,
      })
      return
    }
    // Signed-in flow
    try {
      const buyerUid = auth.currentUser.uid
      await sendConversationMessage(
        messageTarget.sellerId,
        buyerUid,
        buyerUid,
        messageText.trim() || (guestImageUrl ? '📷 Photo' : '🛍️ Product'),
        messageTarget.businessName || 'Seller',
        auth.currentUser.displayName || 'Buyer',
        {
          ...(guestImageUrl ? { imageUrl: guestImageUrl, type: 'image' } : {}),
          productId: messageTarget.id,
          productName: messageTarget.name,
          productPrice: messageTarget.price,
          productImage: messageTarget.imageUrl
        }
      )
      trackEvent('message_sent', {
        productId: messageTarget.id,
        sellerId: messageTarget.sellerId,
        hasPhoto: Boolean(guestImageUrl),
        length: messageText.trim().length,
        surface: 'bag',
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
          <button onClick={() => { trackEvent('bag_cleared', { size: items.length }); clearBag() }}
            style={{ padding: '8px 16px', background: 'transparent', color: '#888', border: '1px solid #333', borderRadius: '8px', cursor: 'pointer', fontSize: '13px' }}>
            Clear All
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {items.map(item => {
            const isMissing = !!missingProducts[item.productId]
            const lv = liveView(item)
            return (
              <div key={item.productId}
                style={{ background: '#1a1a1a', borderRadius: '12px', padding: '14px', border: isMissing ? '1px solid #333' : '1px solid #222', display: 'flex', gap: '14px', alignItems: 'center', opacity: isMissing ? 0.85 : 1 }}>
                <div style={{ position: 'relative', flexShrink: 0 }}>
                  <img src={lv.imageUrl || 'https://placehold.co/80/1a1a1a/333333'} alt={lv.name}
                    style={{ width: '72px', height: '72px', borderRadius: '8px', objectFit: 'cover', cursor: 'pointer', filter: isMissing ? 'grayscale(80%)' : 'none' }}
                    onClick={() => setPreviewItem(item)} />
                  {(lv.images.length || 0) > 1 && (
                    <span style={{ position: 'absolute', bottom: 2, right: 2, background: 'rgba(0,0,0,0.7)', color: '#fff', padding: '1px 5px', borderRadius: 10, fontSize: 9, fontWeight: 700, lineHeight: 1.5 }}>
                      📷 {lv.images.length}
                    </span>
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: '0 0 4px', fontWeight: '700', fontSize: '14px', color: isMissing ? '#888' : '#fff', cursor: 'pointer' }} onClick={() => setPreviewItem(item)}>{lv.name}</p>
                  <p style={{ margin: '0 0 4px', fontSize: '12px', color: '#888' }}>{item.businessName}</p>
                  {isMissing ? (
                    <p style={{ margin: 0, color: '#ff6b6b', fontSize: '12px', fontWeight: '700' }}>❌ Product no longer available</p>
                  ) : (
                    <>
                      <p style={{ margin: 0, fontWeight: '800', fontSize: '14px', color: green }}>UGX {lv.price}</p>
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
                        <button onClick={() => { trackEvent('bag_quantity_changed', { productId: item.productId, from: item.quantity, to: Math.max(1, item.quantity - 1) }); setQuantity(item.productId, item.quantity - 1) }}
                          style={{ width: '28px', height: '28px', background: '#222', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '14px', fontWeight: '700', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
                        <span style={{ width: '28px', textAlign: 'center', fontSize: '13px', fontWeight: '700', color: '#fff' }}>{item.quantity}</span>
                        <button onClick={() => { trackEvent('bag_quantity_changed', { productId: item.productId, from: item.quantity, to: item.quantity + 1 }); setQuantity(item.productId, item.quantity + 1) }}
                          style={{ width: '28px', height: '28px', background: '#222', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '14px', fontWeight: '700', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
                      </div>
                      {draftProductIds.has(item.productId) && (
                        <span style={{ padding: '2px 8px', background: 'rgba(176,38,255,0.12)', color: '#b026ff', border: '1px solid #b026ff', borderRadius: '999px', fontSize: '10px', fontWeight: '800', whiteSpace: 'nowrap' }}>
                          📝 Draft
                        </span>
                      )}
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
                  <button onClick={() => { trackEvent('bag_removed', { productId: item.productId, sellerId: item.sellerId, price: item.productPrice, surface: 'bag', bagSize: Math.max(0, items.length - 1) }); removeFromBag(item.productId) }}
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
            ) : !auth.currentUser || auth.currentUser.isAnonymous ? (
              <SignInPrompt
                action="order"
                returnTo="/bag"
                productId={orderTarget?.id}
                onLeave={() => { setOrderTarget(null); setOrderSuccess(false) }}
              />
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
              <div style={{ marginBottom: '16px' }}>
                <QuickRepliesPanel onPick={q => { setMessageText(q); setShowQuickReplies(false) }} />
              </div>
            )}

            {auth.currentUser ? (
              <>
                {/* Message Input */}
                {draftMsg && (
                  <span style={{ color: '#888', fontSize: 12, fontWeight: 700, display: 'block', marginBottom: 4 }}>📝 Saved as a draft — it stays in your Inbox until you send or cancel.</span>
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
              <SignInPrompt
                action="message"
                returnTo="/bag"
                productId={messageTarget?.id}
                onLeave={closeMessageModal}
              />
            )}

            <button onClick={() => { clearMsgDraft(); setGuestImageUrl(''); setMessageTarget(null); setShowQuickReplies(false) }}
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
            {(() => {
              const lv = liveView(previewItem)
              const imgs = lv.images.length ? lv.images : [lv.imageUrl].filter(Boolean)
              const current = imgs[previewImageIndex] || lv.imageUrl || ''
              return (
                <div style={{ position: 'relative', marginBottom: '16px' }}>
                  <img src={current || 'https://placehold.co/600x400/1a1a1a/333333'} alt={lv.name}
                    onPointerDown={(e) => { previewSwipeStart.current = { x: e.clientX, y: e.clientY } }}
                    onPointerUp={(e) => {
                      const s = previewSwipeStart.current
                      previewSwipeStart.current = null
                      if (!s) return
                      const dx = e.clientX - s.x
                      const dy = e.clientY - s.y
                      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
                        setPreviewImageIndex(prev => (dx < 0 ? Math.min(prev + 1, imgs.length - 1) : Math.max(prev - 1, 0)))
                        return
                      }
                      setFullPreview(true)
                    }}
                    style={{ width: '100%', height: '240px', objectFit: 'cover', borderRadius: '12px', cursor: 'zoom-in' }} />
                  {imgs.length > 1 && (
                    <>
                      <button onClick={() => setPreviewImageIndex(prev => (prev === 0 ? imgs.length - 1 : prev - 1))}
                        style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', background: 'rgba(0,0,0,0.5)', border: 'none', color: '#fff', borderRadius: '50%', width: '30px', height: '30px', cursor: 'pointer', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>‹</button>
                      <button onClick={() => setPreviewImageIndex(prev => (prev === imgs.length - 1 ? 0 : prev + 1))}
                        style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'rgba(0,0,0,0.5)', border: 'none', color: '#fff', borderRadius: '50%', width: '30px', height: '30px', cursor: 'pointer', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>›</button>
                      <div style={{ position: 'absolute', bottom: '8px', right: '8px', background: 'rgba(0,0,0,0.6)', color: '#fff', padding: '3px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: '700' }}>
                        {previewImageIndex + 1}/{imgs.length}
                      </div>
                    </>
                  )}
                </div>
              )
            })()}
            <h3 style={{ margin: '0 0 4px', fontSize: '18px', fontWeight: '800', color: '#fff' }}>{liveView(previewItem).name}</h3>
            <p style={{ margin: '0 0 8px', color: '#888', fontSize: '13px' }}>{previewItem.businessName}</p>
            <p style={{ margin: '0 0 10px', fontWeight: '800', fontSize: '16px', color: green }}>UGX {liveView(previewItem).price}</p>
            {(salesMap[previewItem.productId] || 0) > 0 && (
              <p style={{ display: 'inline-block', margin: '0 0 18px', padding: '3px 10px', background: green, color: '#000', borderRadius: '999px', fontSize: '12px', fontWeight: '800', lineHeight: 1.4 }}>
                ✓ {formatCount(salesMap[previewItem.productId] || 0)} bought
              </p>
            )}
            {previewItem.sellerSlug && (
              <button onClick={() => navigate(`/store/${previewItem.sellerSlug}`)}
                style={{ width: '100%', padding: '14px', background: green, color: '#000', border: 'none', borderRadius: '10px', fontWeight: '800', cursor: 'pointer', fontSize: '15px', marginBottom: '8px' }}>
                🏪 Visit seller
              </button>
            )}
            <button onClick={() => setPreviewItem(null)}
              style={{ width: '100%', padding: '12px', background: 'transparent', color: '#888', border: '1px solid #333', borderRadius: '10px', cursor: 'pointer', fontSize: '14px' }}>
              Close
            </button>
          </div>
        </div>
      )}

      {/* Full-screen photo preview (tap the product photo to zoom/swipe all images) */}
      {fullPreview && previewItem && (
        <ProductPreview
          images={(() => { const lv = liveView(previewItem); return lv.images.length ? lv.images : [lv.imageUrl].filter(Boolean) })()}
          startIndex={previewImageIndex}
          onClose={() => setFullPreview(false)}
        />
      )}
    </div>
  )
}

export default BagPage
