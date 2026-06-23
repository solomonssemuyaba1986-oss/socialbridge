import { useState, useEffect, type ReactNode } from 'react'
import { doc, getDoc, updateDoc } from 'firebase/firestore'
import { db } from './firebase'
import { useNavigate } from 'react-router-dom'
import { useSellerOrders, isUnread, type SellerOrder } from './useSellerOrders'
import { useSellerMessages, isUnreadMessage, type SellerMessage } from './useSellerMessages'

const green = '#adff2f'

type InboxFilter = 'all' | 'messages' | 'unread' | 'pending' | 'confirmed'

function orderTotal(price: string, quantity: number | string): number {
  const unit = Number(String(price).replace(/,/g, '')) || 0
  const qty = Number(quantity) || 1
  return unit * qty
}

function formatDate(createdAt: { toDate?: () => Date } | null | undefined): string {
  if (createdAt?.toDate) return createdAt.toDate().toLocaleString()
  return 'Just now'
}

function statusLabel(status?: string): { text: string; color: string; bg: string } {
  if (status === 'fulfilled') return { text: '✓ Confirmed', color: green, bg: '#1a2a1a' }
  if (status === 'out_of_stock') return { text: 'Out of Stock', color: '#ff4444', bg: '#2a1a1a' }
  if (status === 'needs_details') return { text: 'Need Details', color: '#888', bg: '#222' }
  return { text: 'Pending', color: '#888', bg: '#222' }
}

function Inbox() {
  const navigate = useNavigate()
  const { orders, unreadCount: unreadOrders, loading: ordersLoading, userId } = useSellerOrders()
  const { messages, unreadCount: unreadMessages, loading: messagesLoading } = useSellerMessages()
  const [filter, setFilter] = useState<InboxFilter>('unread')
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null)
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null)
  const [seller, setSeller] = useState<{ whatsapp?: string } | null>(null)

  const loading = ordersLoading || messagesLoading
  const showingMessages = filter === 'messages'

  useEffect(() => {
    if (!userId) return
    getDoc(doc(db, 'sellers', userId)).then(snap => {
      if (snap.exists()) setSeller(snap.data() as { whatsapp?: string })
    })
  }, [userId])

  const markOrderRead = async (orderId: string) => {
    if (!userId) return
    await updateDoc(doc(db, 'sellers', userId, 'orders', orderId), { read: true })
  }

  const markMessageRead = async (messageId: string) => {
    if (!userId) return
    await updateDoc(doc(db, 'sellers', userId, 'messages', messageId), { read: true })
  }

  const selectOrder = async (order: SellerOrder) => {
    setSelectedOrderId(order.id)
    setSelectedMessageId(null)
    if (isUnread(order)) await markOrderRead(order.id)
  }

  const selectMessage = async (message: SellerMessage) => {
    setSelectedMessageId(message.id)
    setSelectedOrderId(null)
    if (isUnreadMessage(message)) await markMessageRead(message.id)
  }

  const openWhatsAppForOrder = (order: SellerOrder) => {
    if (seller?.whatsapp) {
      const text = `Hi ${order.buyerName}, following up on your order for ${order.productName} x${order.quantity}.`
      window.open(`https://wa.me/${seller.whatsapp}?text=${encodeURIComponent(text)}`, '_blank')
    }
  }

  const openWhatsAppForMessage = (message: SellerMessage) => {
    if (seller?.whatsapp) {
      const text = `Hi ${message.senderName}, thanks for your message about ${message.productName}. You wrote: "${message.text}"`
      window.open(`https://wa.me/${seller.whatsapp}?text=${encodeURIComponent(text)}`, '_blank')
    }
  }

  const filteredOrders = orders.filter(o => {
    if (filter === 'unread') return isUnread(o)
    if (filter === 'pending') return o.status === 'pending' || !o.status
    if (filter === 'confirmed') return o.status === 'fulfilled'
    if (filter === 'all') return true
    return false
  })

  const filteredMessages = filter === 'messages' || filter === 'all'
    ? messages
    : []

  const selectedOrder = orders.find(o => o.id === selectedOrderId) ?? null
  const selectedMessage = messages.find(m => m.id === selectedMessageId) ?? null

  const totalUnread = unreadOrders + unreadMessages

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#0f0f0f', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: '#555', fontFamily: 'sans-serif' }}>Loading inbox...</p>
      </div>
    )
  }

  const emptyCopy = filter === 'messages'
    ? 'No buyer messages yet'
    : filter === 'unread'
      ? 'No unread orders — you\'re all caught up'
      : 'Nothing here yet'

  const listEmpty = showingMessages
    ? filteredMessages.length === 0
    : filter === 'all'
      ? filteredOrders.length === 0 && filteredMessages.length === 0
      : filteredOrders.length === 0

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f0f', fontFamily: 'sans-serif', color: '#fff' }}>

      <div className="rt-topnav" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px', borderBottom: '1px solid #1a1a1a' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button onClick={() => navigate('/dashboard')}
            style={{ background: 'transparent', border: 'none', color: '#888', cursor: 'pointer', fontSize: '14px', padding: 0 }}>
            ← Back
          </button>
          <h1 style={{ margin: 0, fontSize: '18px', fontWeight: '800' }}>Inbox</h1>
          {totalUnread > 0 && (
            <div style={{ background: green, color: '#000', borderRadius: '20px', padding: '2px 10px', fontSize: '12px', fontWeight: '800' }}>
              {totalUnread} new
            </div>
          )}
        </div>
      </div>

      <div className="rt-filters" style={{ display: 'flex', gap: '8px', padding: '16px 24px', borderBottom: '1px solid #1a1a1a', overflowX: 'auto' }}>
        {([
          { key: 'all' as const, count: orders.length + messages.length },
          { key: 'messages' as const, count: messages.length },
          { key: 'unread' as const, count: unreadOrders },
          { key: 'pending' as const, count: orders.filter(o => o.status === 'pending' || !o.status).length },
          { key: 'confirmed' as const, count: orders.filter(o => o.status === 'fulfilled').length },
        ]).map(({ key, count }) => {
          const active = filter === key
          const badgeCount = key === 'messages' ? unreadMessages : key === 'unread' ? unreadOrders : 0
          return (
            <button key={key} onClick={() => { setFilter(key); setSelectedOrderId(null); setSelectedMessageId(null) }}
              style={{ padding: '8px 16px', borderRadius: '20px', border: `1px solid ${active ? green : '#333'}`, background: active ? green : 'transparent', color: active ? '#000' : '#aaa', fontWeight: active ? '700' : '500', cursor: 'pointer', fontSize: '13px', whiteSpace: 'nowrap', textTransform: 'capitalize', display: 'flex', alignItems: 'center', gap: '6px' }}>
              {key}
              {badgeCount > 0 && (key === 'messages' || key === 'unread') && (
                <span style={{ background: active ? '#000' : green, color: active ? green : '#000', borderRadius: '50%', minWidth: '20px', height: '20px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: '800', padding: '0 5px' }}>
                  {badgeCount}
                </span>
              )}
              {key !== 'unread' && key !== 'messages' && count > 0 && (
                <span style={{ color: active ? '#333' : '#555', fontSize: '11px' }}>({count})</span>
              )}
            </button>
          )
        })}
      </div>

      <div className="rt-container" style={{ maxWidth: '640px', margin: '0 auto', padding: '16px' }}>
        {listEmpty ? (
          <div style={{ textAlign: 'center', padding: '80px 20px' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>📭</div>
            <p style={{ color: '#555', fontSize: '15px' }}>{emptyCopy}</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>

            {!showingMessages && filteredOrders.map(o => {
              const unread = isUnread(o)
              const selected = selectedOrderId === o.id
              const st = statusLabel(o.status)
              return (
                <div key={`order-${o.id}`}>
                  <div
                    onClick={() => selectOrder(o)}
                    style={{
                      background: selected ? '#1a2a1a' : unread ? '#152015' : '#1a1a1a',
                      borderRadius: selected && selectedOrder ? '12px 12px 0 0' : '12px',
                      padding: '16px',
                      border: `1px solid ${selected ? green : unread ? green : '#222'}`,
                      cursor: 'pointer',
                    }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        {unread && <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: green, flexShrink: 0 }} />}
                        <div>
                          <p style={{ margin: '0 0 2px', fontWeight: '700', fontSize: '15px', color: '#fff' }}>{o.buyerName}</p>
                          <p style={{ margin: 0, color: '#888', fontSize: '13px' }}>Order · {o.productName} × {o.quantity}</p>
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <p style={{ margin: '0 0 4px', color: green, fontSize: '13px', fontWeight: '700' }}>UGX {o.productPrice}</p>
                        <p style={{ margin: 0, color: '#444', fontSize: '11px' }}>{formatDate(o.createdAt)}</p>
                      </div>
                    </div>
                    <span style={{ color: '#555', fontSize: '12px' }}>{unread ? 'Tap to view order' : 'Tap to view again'}</span>
                    <span style={{ float: 'right', background: st.bg, color: st.color, padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: '600' }}>{st.text}</span>
                  </div>

                  {selected && selectedOrder && (
                    <DetailPanel title="Order details" action={<ActionButton label="💬 Open WhatsApp Chat" onClick={() => openWhatsAppForOrder(o)} />}>
                      <DetailRow label="Customer" value={o.buyerName} />
                      <DetailRow label="Product" value={o.productName} />
                      <DetailRow label="Quantity" value={String(o.quantity)} />
                      <DetailRow label="Unit price" value={`UGX ${o.productPrice}`} />
                      <DetailRow label="Total" value={`UGX ${orderTotal(o.productPrice, o.quantity).toLocaleString()}`} highlight />
                      {o.deliveryArea && <DetailRow label="Delivery area" value={o.deliveryArea} />}
                      {o.orderId && <DetailRow label="Order ID" value={`#${o.orderId}`} />}
                      <DetailRow label="Placed" value={formatDate(o.createdAt)} />
                      <DetailRow label="Status" value={st.text} />
                    </DetailPanel>
                  )}
                </div>
              )
            })}

            {(showingMessages || filter === 'all') && filteredMessages.map(m => {
              const unread = isUnreadMessage(m)
              const selected = selectedMessageId === m.id
              return (
                <div key={`msg-${m.id}`}>
                  <div
                    onClick={() => selectMessage(m)}
                    style={{
                      background: selected ? '#1a2a1a' : unread ? '#152015' : '#1a1a1a',
                      borderRadius: selected && selectedMessage ? '12px 12px 0 0' : '12px',
                      padding: '16px',
                      border: `1px solid ${selected ? green : unread ? green : '#222'}`,
                      cursor: 'pointer',
                    }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                        {unread && <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: green, flexShrink: 0 }} />}
                        <div style={{ minWidth: 0 }}>
                          <p style={{ margin: '0 0 2px', fontWeight: '700', fontSize: '15px', color: '#fff' }}>{m.senderName}</p>
                          <p style={{ margin: 0, color: '#888', fontSize: '13px' }}>Message · {m.productName}</p>
                        </div>
                      </div>
                      <p style={{ margin: 0, color: '#444', fontSize: '11px', flexShrink: 0, marginLeft: '8px' }}>{formatDate(m.createdAt)}</p>
                    </div>
                    <p style={{ margin: '0 0 8px', color: '#aaa', fontSize: '13px', lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {m.text}
                    </p>
                    <span style={{ color: '#555', fontSize: '12px' }}>{unread ? 'Tap to read message' : 'Tap to view again'}</span>
                  </div>

                  {selected && selectedMessage && (
                    <DetailPanel title="Message" action={<ActionButton label="💬 Reply on WhatsApp" onClick={() => openWhatsAppForMessage(m)} />}>
                      <DetailRow label="From" value={m.senderName} />
                      {m.senderEmail && <DetailRow label="Email" value={m.senderEmail} />}
                      <DetailRow label="Product" value={m.productName} />
                      <DetailRow label="Sent" value={formatDate(m.createdAt)} />
                      <p style={{ margin: 0, padding: '12px', background: '#0a0a0a', borderRadius: '8px', color: '#ccc', fontSize: '14px', lineHeight: 1.5, textAlign: 'left' }}>
                        {m.text}
                      </p>
                    </DetailPanel>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function DetailPanel({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div style={{
      background: '#111', border: `1px solid ${green}`, borderTop: 'none',
      borderRadius: '0 0 12px 12px', padding: '20px', marginBottom: '8px',
    }}>
      <p style={{ margin: '0 0 16px', color: green, fontSize: '12px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {title}
      </p>
      <div style={{ display: 'grid', gap: '12px', marginBottom: action ? '16px' : 0 }}>{children}</div>
      {action}
    </div>
  )
}

function DetailRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '16px' }}>
      <span style={{ color: '#666', fontSize: '13px', flexShrink: 0 }}>{label}</span>
      <span style={{ color: highlight ? green : '#fff', fontSize: '14px', fontWeight: highlight ? '800' : '600', textAlign: 'right' }}>{value}</span>
    </div>
  )
}

function ActionButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={e => { e.stopPropagation(); onClick() }}
      style={{ width: '100%', padding: '12px', background: 'transparent', color: green, border: `1px solid ${green}`, borderRadius: '8px', cursor: 'pointer', fontSize: '14px', fontWeight: '600' }}>
      {label}
    </button>
  )
}

export default Inbox
