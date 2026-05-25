import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
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
  const { orders, loading } = useSellerOrders()
  const [filter, setFilter] = useState<'all' | 'pending' | 'fulfilled' | 'out_of_stock'>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const filtered = orders.filter(o => {
    if (filter === 'pending') return o.status === 'pending' || !o.status || o.status === 'needs_details'
    if (filter === 'fulfilled') return o.status === 'fulfilled'
    if (filter === 'out_of_stock') return o.status === 'out_of_stock'
    return true
  })

  const selected = orders.find(o => o.id === selectedId) ?? null

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#0f0f0f', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: '#555', fontFamily: 'sans-serif' }}>Loading orders...</p>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f0f', fontFamily: 'sans-serif', color: '#fff' }}>
      <div className="rt-topnav" style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '16px 24px', borderBottom: '1px solid #1a1a1a' }}>
        <button onClick={() => navigate('/dashboard')}
          style={{ background: 'transparent', border: 'none', color: '#888', cursor: 'pointer', fontSize: '14px', padding: 0 }}>
          ← Dashboard
        </button>
        <h1 style={{ margin: 0, fontSize: '18px', fontWeight: '800' }}>All Orders</h1>
        <span style={{ color: '#555', fontSize: '13px' }}>({orders.length})</span>
      </div>

      <div className="rt-filters" style={{ display: 'flex', gap: '8px', padding: '16px 24px', borderBottom: '1px solid #1a1a1a', overflowX: 'auto' }}>
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

      <div className="rt-container" style={{ maxWidth: '640px', margin: '0 auto', padding: '16px' }}>
        {filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '80px 20px' }}>
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
  )
}

export default OrderHistory
