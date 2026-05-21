import { useState, useEffect } from 'react'
import { doc, getDoc, updateDoc } from 'firebase/firestore'
import { db } from './firebase'
import { useNavigate } from 'react-router-dom'
import { useSellerOrders, isUnread, type SellerOrder } from './useSellerOrders'

const green = '#adff2f'

function orderTotal(price: string, quantity: number | string): number {
  const unit = Number(String(price).replace(/,/g, '')) || 0
  const qty = Number(quantity) || 1
  return unit * qty
}

function formatDate(createdAt: SellerOrder['createdAt']): string {
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
  const { orders, unreadCount, loading, userId } = useSellerOrders()
  const [filter, setFilter] = useState('unread')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [seller, setSeller] = useState<{ whatsapp?: string } | null>(null)

  useEffect(() => {
    if (!userId) return
    getDoc(doc(db, 'sellers', userId)).then(snap => {
      if (snap.exists()) setSeller(snap.data() as { whatsapp?: string })
    })
  }, [userId])

  const markAsRead = async (orderId: string) => {
    if (!userId) return
    await updateDoc(doc(db, 'sellers', userId, 'orders', orderId), { read: true })
  }

  const selectOrder = async (order: SellerOrder) => {
    setSelectedId(order.id)
    if (isUnread(order)) {
      await markAsRead(order.id)
    }
  }

  const openWhatsApp = (order: SellerOrder) => {
    if (seller?.whatsapp) {
      const message = `Hi ${order.buyerName}, following up on your order for ${order.productName} x${order.quantity}.`
      window.open(`https://wa.me/${seller.whatsapp}?text=${encodeURIComponent(message)}`, '_blank')
    }
  }

  const filteredOrders = orders.filter(o => {
    if (filter === 'unread') return isUnread(o)
    if (filter === 'pending') return o.status === 'pending' || !o.status
    if (filter === 'confirmed') return o.status === 'fulfilled'
    return true
  })

  const selectedOrder = orders.find(o => o.id === selectedId) ?? null

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#0f0f0f', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: '#555', fontFamily: 'sans-serif' }}>Loading inbox...</p>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f0f', fontFamily: 'sans-serif', color: '#fff' }}>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px', borderBottom: '1px solid #1a1a1a' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button onClick={() => navigate('/dashboard')}
            style={{ background: 'transparent', border: 'none', color: '#888', cursor: 'pointer', fontSize: '14px', padding: 0 }}>
            ← Back
          </button>
          <h1 style={{ margin: 0, fontSize: '18px', fontWeight: '800' }}>Inbox</h1>
          {unreadCount > 0 && (
            <div style={{ background: green, color: '#000', borderRadius: '20px', padding: '2px 10px', fontSize: '12px', fontWeight: '800' }}>
              {unreadCount} unread
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '8px', padding: '16px 24px', borderBottom: '1px solid #1a1a1a', overflowX: 'auto' }}>
        {(['all', 'unread', 'pending', 'confirmed'] as const).map(f => {
          const count = f === 'unread' ? unreadCount : f === 'pending' ? orders.filter(o => o.status === 'pending' || !o.status).length : f === 'confirmed' ? orders.filter(o => o.status === 'fulfilled').length : orders.length
          const active = filter === f
          return (
            <button key={f} onClick={() => setFilter(f)}
              style={{ padding: '8px 16px', borderRadius: '20px', border: `1px solid ${active ? green : '#333'}`, background: active ? green : 'transparent', color: active ? '#000' : '#aaa', fontWeight: active ? '700' : '500', cursor: 'pointer', fontSize: '13px', whiteSpace: 'nowrap', textTransform: 'capitalize', display: 'flex', alignItems: 'center', gap: '6px' }}>
              {f}
              {f === 'unread' && unreadCount > 0 && (
                <span style={{ background: active ? '#000' : green, color: active ? green : '#000', borderRadius: '50%', minWidth: '20px', height: '20px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: '800', padding: '0 5px' }}>
                  {unreadCount}
                </span>
              )}
              {f !== 'unread' && f !== 'all' && count > 0 && (
                <span style={{ color: active ? '#333' : '#555', fontSize: '11px' }}>({count})</span>
              )}
            </button>
          )
        })}
      </div>

      <div style={{ maxWidth: '640px', margin: '0 auto', padding: '16px' }}>
        {filteredOrders.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '80px 20px' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>📭</div>
            <p style={{ color: '#555', fontSize: '15px' }}>
              {filter === 'unread' ? 'No unread orders — you\'re all caught up' : 'No orders here yet'}
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {filteredOrders.map(o => {
              const unread = isUnread(o)
              const selected = selectedId === o.id
              const st = statusLabel(o.status)
              return (
                <div key={o.id}>
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
                        {unread && (
                          <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: green, flexShrink: 0 }} />
                        )}
                        <div>
                          <p style={{ margin: '0 0 2px', fontWeight: '700', fontSize: '15px', color: '#fff' }}>{o.buyerName}</p>
                          <p style={{ margin: 0, color: '#888', fontSize: '13px' }}>{o.productName} × {o.quantity}</p>
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <p style={{ margin: '0 0 4px', color: green, fontSize: '13px', fontWeight: '700' }}>UGX {o.productPrice}</p>
                        <p style={{ margin: 0, color: '#444', fontSize: '11px' }}>{formatDate(o.createdAt)}</p>
                      </div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ color: '#555', fontSize: '12px' }}>
                        {unread ? 'Tap to view order' : 'Tap to view again'}
                      </span>
                      <span style={{ background: st.bg, color: st.color, padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: '600' }}>
                        {st.text}
                      </span>
                    </div>
                  </div>

                  {selected && (
                    <div style={{
                      background: '#111',
                      border: `1px solid ${green}`,
                      borderTop: 'none',
                      borderRadius: '0 0 12px 12px',
                      padding: '20px',
                      marginBottom: '8px',
                    }}>
                      <p style={{ margin: '0 0 16px', color: green, fontSize: '12px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Order details
                      </p>

                      <div style={{ display: 'grid', gap: '12px', marginBottom: '20px' }}>
                        <DetailRow label="Customer" value={o.buyerName} />
                        <DetailRow label="Product" value={o.productName} />
                        <DetailRow label="Quantity" value={String(o.quantity)} />
                        <DetailRow label="Unit price" value={`UGX ${o.productPrice}`} />
                        <DetailRow label="Total" value={`UGX ${orderTotal(o.productPrice, o.quantity).toLocaleString()}`} highlight />
                        {o.deliveryArea && <DetailRow label="Delivery area" value={o.deliveryArea} />}
                        {o.orderId && <DetailRow label="Order ID" value={`#${o.orderId}`} />}
                        <DetailRow label="Placed" value={formatDate(o.createdAt)} />
                        <DetailRow label="Status" value={st.text} />
                      </div>

                      <button
                        onClick={e => { e.stopPropagation(); openWhatsApp(o) }}
                        style={{ width: '100%', padding: '12px', background: 'transparent', color: green, border: `1px solid ${green}`, borderRadius: '8px', cursor: 'pointer', fontSize: '14px', fontWeight: '600' }}>
                        💬 Open WhatsApp Chat
                      </button>
                    </div>
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

function DetailRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '16px' }}>
      <span style={{ color: '#666', fontSize: '13px', flexShrink: 0 }}>{label}</span>
      <span style={{ color: highlight ? '#adff2f' : '#fff', fontSize: '14px', fontWeight: highlight ? '800' : '600', textAlign: 'right' }}>{value}</span>
    </div>
  )
}

export default Inbox
