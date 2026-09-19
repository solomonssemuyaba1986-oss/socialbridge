import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { db, auth } from './firebase'
import { useBuyerOrders, type BuyerOrder } from './useBuyerOrders'
import {
  buyerStatusLabel,
  countNewOrders,
  isOrderNew,
  matchesBuyerFilter,
  orderAge,
  orderTotal,
  wasUpdatedAfterPlacing,
  type BuyerOrderFilter,
  type OrderTone,
} from './buyerOrderUtils'
import { green, toMillis } from './productCardUtils'
import { useBag } from './useBag'
import { useProductLikes } from './useProductLikes'
import LikePill from './LikePill'
import LovePrompt from './LovePrompt'
import { notify } from './notifications'
import { trackEvent } from './analytics'

/** In plain words — `pending`, `paid` and `awaiting_payment` mean nothing to a buyer. */
const FILTERS: { key: BuyerOrderFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Still coming' },
  { key: 'delivered', label: 'Delivered' },
]

const TONES: Record<OrderTone, { bg: string; fg: string; border: string }> = {
  green: { bg: '#12210d', fg: green, border: '#2f4a1a' },
  amber: { bg: '#241f0c', fg: '#ffcc33', border: '#4a3d12' },
  red: { bg: '#241010', fg: '#ff6b6b', border: '#4a1d1d' },
  grey: { bg: '#1a1a1a', fg: '#888', border: '#333' },
}

export interface ShopInfo {
  name: string
  slug: string
  logo: string
}

/** Firestore timestamps → plain milliseconds, in the shape the order helpers expect. */
function orderChangedTimes(order: BuyerOrder): { createdAt: number; updatedAt: number } {
  const placedMs = toMillis(order.createdAt) ?? 0
  return { createdAt: placedMs, updatedAt: toMillis(order.updatedAt) ?? placedMs }
}

interface NoticeProps {
  icon: string
  title: string
  body: string
  action?: { label: string; onClick: () => void }
}

/** The one card used for "no orders", "couldn't load", "setting switched off". */
function Notice({ icon, title, body, action }: NoticeProps) {
  return (
    <div style={{ background: '#1a1a1a', border: '1px solid #262626', borderRadius: 14, padding: '28px 20px', textAlign: 'center' }}>
      <div style={{ fontSize: 30, marginBottom: 10 }}>{icon}</div>
      <p style={{ margin: '0 0 6px', fontWeight: 800, fontSize: 16, color: '#fff' }}>{title}</p>
      <p style={{ margin: '0 auto 16px', color: '#888', fontSize: 13, maxWidth: 460, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{body}</p>
      {action && (
        <button
          onClick={action.onClick}
          style={{ padding: '11px 20px', background: green, color: '#000', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 14, cursor: 'pointer' }}
        >
          {action.label}
        </button>
      )}
    </div>
  )
}

/**
 * 📦 My Orders — every order this buyer has placed, from every shop, in one list.
 *
 * The seller already had an orders screen (`/orders`); the buyer had to dig through chats.
 * Read-only on purpose: nothing here changes an order, so no safety rule had to be widened.
 */
function BuyerOrders() {
  const navigate = useNavigate()
  const { orders, loading, error, hasMore, loadMore, reload } = useBuyerOrders()
  const { addToBag, isInBag } = useBag()
  const { isLiked, toggleLike } = useProductLikes()
  const [filter, setFilter] = useState<BuyerOrderFilter>('all')
  const [shops, setShops] = useState<Map<string, ShopInfo>>(new Map())
  /**
   * When this person last opened their orders. Read **first**, then moved forward — so the
   * dots they see right now describe their previous visit instead of vanishing under them.
   */
  const [seenAt, setSeenAt] = useState(0)
  const uid = auth.currentUser?.uid || ''

  useEffect(() => {
    if (!uid) return
    let cancelled = false
    getDoc(doc(db, 'users', uid))
      .then(snap => {
        if (cancelled) return
        setSeenAt(Number(snap.data()?.ordersSeenAt) || 0)
        // Next visit compares against now.
        return setDoc(doc(db, 'users', uid), { ordersSeenAt: Date.now() }, { merge: true })
      })
      .catch(err => console.warn('Could not read when the orders were last seen:', err))
    return () => { cancelled = true }
  }, [uid])

  /** One read per *distinct* shop (usually a handful), remembered for the rest of the visit. */
  useEffect(() => {
    const wanted = [...new Set(orders.map(o => o.sellerId))].filter(id => id && !shops.has(id))
    if (wanted.length === 0) return
    let cancelled = false
    Promise.all(wanted.map(async id => {
      try {
        const data = (await getDoc(doc(db, 'sellers', id))).data() || {}
        return {
          id,
          info: {
            name: (data.businessName as string) || 'Shop',
            slug: (data.slug as string) || '',
            logo: (data.logoUrl as string) || '',
          },
        }
      } catch {
        // A shop that no longer exists must not break the whole list.
        return { id, info: { name: 'Shop', slug: '', logo: '' } }
      }
    })).then(found => {
      if (cancelled) return
      setShops(prev => {
        const next = new Map(prev)
        found.forEach(({ id, info }) => next.set(id, info))
        return next
      })
    })
    return () => { cancelled = true }
  }, [orders, shops])

  const visible = useMemo(() => orders.filter(o => matchesBuyerFilter(o.status, filter)), [orders, filter])
  const stillComing = orders.filter(o => matchesBuyerFilter(o.status, 'active')).length
  /** Orders that changed (or arrived) since this person last opened the page. */
  const updatedCount = countNewOrders(orders.map(orderChangedTimes), seenAt)

  /**
   * Who gets asked "did you love it?". Only the newest delivered order — asking it on five
   * rows at once would be a nag and would fire the same event five times.
   */
  const promptedOrderId = useMemo(
    () => orders.find(o => o.status === 'fulfilled' && o.productId && o.orderId)?.id || '',
    [orders],
  )

  useEffect(() => {
    if (orders.length > 0) trackEvent('buyer_orders_viewed', { count: orders.length })
  }, [orders.length])

  const openShop = (order: BuyerOrder) => {
    trackEvent('order_viewed', { orderId: order.orderId || order.id, status: order.status })
    const slug = shops.get(order.sellerId)?.slug
    if (slug) navigate(`/store/${slug}`)
  }

  const buyAgain = (order: BuyerOrder) => {
    if (!order.productId) return
    const shop = shops.get(order.sellerId)
    if (!isInBag(order.productId)) {
      addToBag({
        productId: order.productId,
        productName: order.productName || 'Product',
        productPrice: order.productPrice || '',
        imageUrl: order.productImage || '',
        sellerSlug: shop?.slug || '',
        sellerId: order.sellerId,
        businessName: shop?.name || 'Shop',
      })
    }
    navigate('/bag')
  }

  /**
   * The ♥ on a delivered row. No count rides along: this page never loaded the product doc, and
   * the hook refuses to invent a tally — the heart flips, the real number waits for a card.
   */
  const toggleLove = (order: BuyerOrder) => {
    if (!order.productId) return
    void toggleLike({ sellerId: order.sellerId, productId: order.productId, surface: 'orders' })
      .then(res => { if (res.failed) alert(notify.likeFailed) })
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f0f', fontFamily: 'sans-serif', color: '#fff', padding: '20px 16px 60px' }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <h1 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 800 }}>📦 My Orders</h1>
        <p style={{ margin: '0 0 16px', color: '#888', fontSize: 13 }}>
          {loading
            ? 'Loading your orders…'
            : orders.length === 0
              ? 'Everything you order will show up here.'
              : `${orders.length} order${orders.length === 1 ? '' : 's'}${stillComing > 0 ? ` · ${stillComing} still coming` : ''}${updatedCount > 0 ? ` · ${updatedCount} updated` : ''}`}
        </p>

        {error ? (
          <Notice
            icon={error === 'index' ? '⚙️' : '📡'}
            title={error === 'index' ? 'One setting is still switched off' : "Couldn't reach your orders"}
            body={error === 'index'
              ? 'Firebase needs the orders setting switched on before it can gather all your orders.\nRun this in your terminal once, then tap Try again:\n\nnpm run deploy:indexes'
              : 'Check your connection and try again — your orders are safe.'}
            action={{ label: 'Try again', onClick: reload }}
          />
        ) : loading ? (
          <p style={{ color: '#555', fontSize: 14 }}>Loading your orders…</p>
        ) : orders.length === 0 ? (
          <Notice
            icon="🧺"
            title="No orders yet"
            body="When you order from a shop it lands here, with what you paid and whether it has arrived."
            action={{ label: 'Browse products', onClick: () => navigate('/browse') }}
          />
        ) : (
          <OrdersBody
            orders={visible}
            filter={filter}
            hasMore={hasMore && filter === 'all'}
            shops={shops}
            promptedOrderId={promptedOrderId}
            seenAt={seenAt}
            isLiked={isLiked}
            isInBag={isInBag}
            onFilter={setFilter}
            onOpenShop={openShop}
            onBuyAgain={buyAgain}
            onToggleLove={toggleLove}
            onChat={() => navigate('/inbox')}
            onLoadMore={loadMore}
          />
        )}
      </div>
    </div>
  )
}

interface OrdersBodyProps {
  orders: BuyerOrder[]
  filter: BuyerOrderFilter
  hasMore: boolean
  shops: Map<string, ShopInfo>
  promptedOrderId: string
  /** When the person last looked — anything changed after this gets a ● NEW. */
  seenAt: number
  isLiked: (productId: string) => boolean
  isInBag: (productId: string) => boolean
  onFilter: (filter: BuyerOrderFilter) => void
  onOpenShop: (order: BuyerOrder) => void
  onBuyAgain: (order: BuyerOrder) => void
  onToggleLove: (order: BuyerOrder) => void
  onChat: () => void
  onLoadMore: () => void
}

/** The chips + the list. Split out so the page above stays readable. */
function OrdersBody({
  orders,
  filter,
  hasMore,
  shops,
  promptedOrderId,
  seenAt,
  isLiked,
  isInBag,
  onFilter,
  onOpenShop,
  onBuyAgain,
  onToggleLove,
  onChat,
  onLoadMore,
}: OrdersBodyProps) {
  return (
    <>
      <div className="rt-filters" style={{ display: 'flex', gap: 8, marginBottom: 16, overflowX: 'auto' }}>
        {FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => onFilter(f.key)}
            style={{
              padding: '8px 14px',
              borderRadius: 999,
              border: `1px solid ${filter === f.key ? green : '#333'}`,
              background: filter === f.key ? '#1a2a1a' : '#1a1a1a',
              color: filter === f.key ? green : '#ccc',
              fontWeight: 700,
              fontSize: 13,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {orders.length === 0 ? (
        <p style={{ color: '#666', fontSize: 14 }}>Nothing in this list yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {orders.map(order => {
            const times = orderChangedTimes(order)
            return (
              <OrderRow
                key={order.id}
                order={order}
                shop={shops.get(order.sellerId)}
                liked={Boolean(order.productId && isLiked(order.productId))}
                inBag={Boolean(order.productId && isInBag(order.productId))}
                askLove={order.id === promptedOrderId}
                placedMs={times.createdAt}
                changedMs={times.updatedAt}
                isNew={isOrderNew(times, seenAt)}
                onOpenShop={() => onOpenShop(order)}
                onBuyAgain={() => onBuyAgain(order)}
                onToggleLove={() => onToggleLove(order)}
                onChat={onChat}
              />
            )
          })}
        </div>
      )}

      {hasMore && (
        <button
          onClick={onLoadMore}
          style={{ width: '100%', marginTop: 16, padding: 12, background: '#1a1a1a', color: '#ccc', border: '1px solid #333', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
        >
          Show older orders
        </button>
      )}
    </>
  )
}

interface OrderRowProps {
  order: BuyerOrder
  shop?: ShopInfo
  liked: boolean
  inBag: boolean
  /** The one delivered row that gets asked "did you love it?". */
  askLove: boolean
  /** Milliseconds — when it was ordered, and when it last changed. */
  placedMs: number
  changedMs: number
  /** Changed after this person last looked at the list. */
  isNew: boolean
  onOpenShop: () => void
  onBuyAgain: () => void
  onToggleLove: () => void
  onChat: () => void
}

/** One order: what it was, what it cost, which shop, and where it has got to. */
function OrderRow({
  order,
  shop,
  liked,
  inBag,
  askLove,
  placedMs,
  changedMs,
  isNew,
  onOpenShop,
  onBuyAgain,
  onToggleLove,
  onChat,
}: OrderRowProps) {
  const status = buyerStatusLabel(order.status)
  const tone = TONES[status.tone]
  const age = orderAge(changedMs || null)
  const updated = wasUpdatedAfterPlacing({ createdAt: placedMs, updatedAt: changedMs })
  const quantity = Number(order.quantity) || 1
  const total = orderTotal(order.productPrice, order.quantity)
  const delivered = order.status === 'fulfilled'

  return (
    <div style={{ background: '#1a1a1a', border: '1px solid #222', borderRadius: 14, padding: 14 }}>
      <div style={{ display: 'flex', gap: 12 }}>
        {order.productImage ? (
          <img src={order.productImage} alt="" style={{ width: 64, height: 64, borderRadius: 10, objectFit: 'cover', flexShrink: 0, background: '#111' }} />
        ) : (
          <div style={{ width: 64, height: 64, borderRadius: 10, background: '#111', border: '1px solid #262626', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>🛍️</div>
        )}

        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {order.productName || 'Product'}
          </p>
          <p style={{ margin: '3px 0 0', color: green, fontWeight: 800, fontSize: 13 }}>
            UGX {order.productPrice || '—'}{quantity > 1 ? ` × ${quantity}` : ''}
          </p>
          {quantity > 1 && total > 0 && (
            <p style={{ margin: '2px 0 0', color: '#777', fontSize: 12 }}>Total UGX {total.toLocaleString()}</p>
          )}
          <button
            onClick={onOpenShop}
            disabled={!shop?.slug}
            style={{ background: 'transparent', border: 'none', color: shop?.slug ? '#99a' : '#666', padding: 0, marginTop: 5, fontSize: 12, textAlign: 'left', cursor: shop?.slug ? 'pointer' : 'default' }}
          >
            🏪 {shop?.name || 'Shop'}{shop?.slug ? ' →' : ''}
          </button>
        </div>

        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: tone.bg, color: tone.fg, border: `1px solid ${tone.border}`, borderRadius: 999, padding: '3px 9px', fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap' }}>
            {status.icon} {status.text}
          </span>
          {order.orderId && <p style={{ margin: '6px 0 0', color: '#555', fontSize: 11 }}>{order.orderId}</p>}
          {age && <p style={{ margin: '2px 0 0', color: '#555', fontSize: 11 }}>{updated ? `Updated ${age}` : `Placed ${age}`}</p>}
          {isNew && (
            <p style={{ margin: '4px 0 0', color: '#ff4458', fontSize: 10, fontWeight: 800, letterSpacing: '0.4px' }}>● NEW</p>
          )}
        </div>
      </div>

      {askLove && order.productId && (
        <div style={{ borderTop: '1px solid #222', marginTop: 10, paddingTop: 2 }}>
          <LovePrompt
            sellerId={order.sellerId}
            productId={order.productId}
            productName={order.productName}
            orderId={order.orderId || order.id}
          />
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
        <button
          onClick={onChat}
          style={{ flex: 1, padding: '9px', background: '#222', color: '#fff', border: '1px solid #333', borderRadius: 9, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}
        >
          💬 Ask the seller
        </button>
        {order.productId && (
          <button
            onClick={onBuyAgain}
            style={{ flex: 1, padding: '9px', background: green, color: '#000', border: 'none', borderRadius: 9, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}
          >
            {inBag ? '🛒 In your bag' : '🛒 Buy again'}
          </button>
        )}
        {order.productId && delivered && !askLove && (
          <LikePill liked={liked} count={0} onToggle={onToggleLove} />
        )}
      </div>
    </div>
  )
}

export default BuyerOrders

