import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useSellerOrders, type SellerOrder } from './useSellerOrders.ts'

const green = '#adff2f'

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

function OrderHistory() {
  const navigate = useNavigate()
  const location = useLocation()
  const { orders, loading } = useSellerOrders()
  const [filter, setFilter] = useState<'all' | 'pending' | 'fulfilled' | 'out_of_stock'>('pending')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const navItems = [
    { label: 'Dashboard', path: '/dashboard', icon: '📊' },
    { label: 'Products', path: '/products', icon: '🛍️' },
    { label: 'Orders', path: '/orders', icon: '📦' },
    { label: 'Inbox', path: '/inbox', icon: '📩' },
    { label: 'Settings', path: '/edit-store', icon: '⚙️' },
  ]

  const filtered = orders.filter(o => {
    if (filter === 'pending') return o.status === 'pending' || !o.status || o.status === 'needs_details'
    if (filter === 'fulfilled') return o.status === 'fulfilled'
    if (filter === 'out_of_stock') return o.status === 'out_of_stock'
    return true
  })

  const selected = filtered.find(o => o.id === selectedId) ?? null

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#0f0f0f', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: '#555', fontFamily: 'sans-serif' }}>Loading orders...</p>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f0f', fontFamily: 'sans-serif', color: '#fff', display: 'flex' }}>
      <div style={{ position: 'fixed', left: 0, top: 0, bottom: 0, width: 260, background: '#070707', borderRight: '1px solid #111', padding: '28px 16px', display: 'flex', flexDirection: 'column', gap: '28px', zIndex: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px' }}>
          <div style={{ background: green, width: 34, height: 34, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 16, color: '#000' }}>R</div>
          <div>
            <div style={{ fontWeight: 800, color: '#fff', fontSize: 16 }}>Rachett</div>
            <div style={{ color: '#777', fontSize: 12 }}>Seller panel</div>
          </div>
        </div>

        <div style={{ display: 'grid', gap: '6px' }}>
          {navItems.map(item => {
            const active = location.pathname === item.path
            return (
              <button key={item.path} onClick={() => navigate(item.path)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 14px', borderRadius: '14px', border: 'none', cursor: 'pointer', textAlign: 'left', background: active ? '#0f2910' : 'transparent', color: active ? '#fff' : '#aaa', fontWeight: active ? 700 : 600, fontSize: '14px'
                }}>
                <span>{item.icon}</span>
                <span style={{ flex: 1 }}>{item.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div style={{ width: '100%', marginLeft: 260, padding: '24px 28px', minHeight: '100vh' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '20px', fontWeight: '800' }}>New Orders</h1>
            <p style={{ margin: '4px 0 0', color: '#888', fontSize: '13px' }}>Tap any order to see the details.</p>
          </div>
          <button onClick={() => navigate('/dashboard')}
            style={{ background: '#111', border: '1px solid #222', color: '#fff', borderRadius: '12px', padding: '10px 16px', cursor: 'pointer', fontSize: '13px' }}>
            Back to Dashboard
          </button>
        </div>

        <div className="rt-filters" style={{ display: 'flex', gap: '8px', padding: '0 0 16px', overflowX: 'auto' }}>
          {([
            { key: 'all' as const, label: 'All' },
            { key: 'pending' as const, label: 'Pending' },
            { key: 'fulfilled' as const, label: 'Confirmed' },
            { key: 'out_of_stock' as const, label: 'Out of Stock' },
          ]).map(f => (
            <button key={f.key} onClick={() => { setFilter(f.key); setSelectedId(null) }}
              style={{
                padding: '8px 16px', borderRadius: '20px', whiteSpace: 'nowrap',
                border: `1px solid ${filter === f.key ? green : '#333'}`,
                background: filter === f.key ? green : 'transparent',
                color: filter === f.key ? '#000' : '#aaa',
                fontWeight: filter === f.key ? '700' : '500', cursor: 'pointer', fontSize: '13px',
              }}>
              {f.label}
            </button>
          ))}
        </div>

        <div className="rt-container" style={{ maxWidth: '720px', margin: 0, padding: 0 }}>
          {filtered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '80px 20px', background: '#1a1a1a', borderRadius: '12px', border: '1px dashed #333' }}>
              <p style={{ color: '#555', fontSize: '15px' }}>No orders in this filter yet.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {filtered.map(o => {
                const st = statusLabel(o.status)
                const isSelected = selectedId === o.id
                return (
                  <div key={o.id}>
                    <div
                      onClick={() => setSelectedId(isSelected ? null : o.id)}
                      style={{
                        background: isSelected ? '#1a2a1a' : '#1a1a1a',
                        borderRadius: isSelected && selected ? '12px 12px 0 0' : '12px',
                        padding: '16px',
                        border: `1px solid ${isSelected ? green : '#222'}`,
                        cursor: 'pointer',
                      }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <p style={{ margin: '0 0 4px', fontWeight: '700', fontSize: '15px' }}>{o.buyerName}</p>
                          <p style={{ margin: 0, color: '#888', fontSize: '13px' }}>{o.productName} × {o.quantity}</p>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <p style={{ margin: '0 0 6px', color: green, fontSize: '13px', fontWeight: '700' }}>UGX {o.productPrice}</p>
                          <span style={{ background: st.bg, color: st.color, padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: '600' }}>
                            {st.text}
                          </span>
                        </div>
                      </div>
                      <p style={{ margin: '8px 0 0', color: '#444', fontSize: '11px' }}>{formatDate(o.createdAt)}</p>
                    </div>

                    {isSelected && selected && (
                      <div style={{
                        background: '#111', border: `1px solid ${green}`, borderTop: 'none',
                        borderRadius: '0 0 12px 12px', padding: '16px', marginBottom: '8px',
                      }}>
                        {o.deliveryArea && <p style={{ margin: '0 0 8px', color: '#888', fontSize: '13px' }}>📍 {o.deliveryArea}</p>}
                        {o.orderId && <p style={{ margin: '0 0 8px', color: '#666', fontSize: '13px' }}>#{o.orderId}</p>}
                        <p style={{ margin: 0, color: '#555', fontSize: '12px' }}>Placed {formatDate(o.createdAt)}</p>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default OrderHistory
