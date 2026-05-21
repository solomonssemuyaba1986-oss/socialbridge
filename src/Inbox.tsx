import { useEffect, useState } from 'react'
import { collection, getDocs, query, orderBy, doc, getDoc, updateDoc } from 'firebase/firestore'
import { db, auth } from './firebase'
import { onAuthStateChanged } from 'firebase/auth'
import { useNavigate } from 'react-router-dom'

interface Order {
  id: string
  buyerName: string
  productName: string
  productPrice: string
  quantity: string
  deliveryArea?: string
  orderId?: string
  status: string
  createdAt: any
  read?: boolean
  whatsapp?: string
}

const green = '#adff2f'

function Inbox() {
  const [orders, setOrders] = useState<Order[]>([])
  const [seller, setSeller] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [userId, setUserId] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) { navigate('/'); return }
      setUserId(user.uid)
      const docSnap = await getDoc(doc(db, 'sellers', user.uid))
      if (docSnap.exists()) {
        setSeller(docSnap.data())
        const ordSnap = await getDocs(query(
          collection(db, 'sellers', user.uid, 'orders'),
          orderBy('createdAt', 'desc')
        ))
        setOrders(ordSnap.docs.map(d => ({ id: d.id, ...d.data() })) as Order[])
      }
      setLoading(false)
    })
    return () => unsubscribe()
  }, [])

  const markAsRead = async (orderId: string) => {
    await updateDoc(doc(db, 'sellers', userId, 'orders', orderId), { read: true })
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, read: true } : o))
  }

  const openWhatsApp = (order: Order) => {
    if (seller?.whatsapp) {
      const message = `Hi ${order.buyerName}, following up on your order for ${order.productName} x${order.quantity}.`
      window.open(`https://wa.me/${seller.whatsapp}?text=${encodeURIComponent(message)}`, '_blank')
    }
  }

  const filteredOrders = orders.filter(o => {
    if (filter === 'unread') return !o.read
    if (filter === 'pending') return o.status === 'pending' || !o.status
    if (filter === 'confirmed') return o.status === 'fulfilled'
    return true
  })

  const unreadCount = orders.filter(o => !o.read).length

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#0f0f0f', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: '#555', fontFamily: 'sans-serif' }}>Loading inbox...</p>
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f0f', fontFamily: 'sans-serif', color: '#fff' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px', borderBottom: '1px solid #1a1a1a' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button onClick={() => navigate('/dashboard')}
            style={{ background: 'transparent', border: 'none', color: '#888', cursor: 'pointer', fontSize: '14px', padding: 0 }}>
            ← Back
          </button>
          <h1 style={{ margin: 0, fontSize: '18px', fontWeight: '800' }}>Inbox</h1>
          {unreadCount > 0 && (
            <div style={{ background: green, color: '#000', borderRadius: '20px', padding: '2px 10px', fontSize: '12px', fontWeight: '800' }}>
              {unreadCount} new
            </div>
          )}
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '8px', padding: '16px 24px', borderBottom: '1px solid #1a1a1a', overflowX: 'auto' }}>
        {['all', 'unread', 'pending', 'confirmed'].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            style={{ padding: '8px 16px', borderRadius: '20px', border: `1px solid ${filter === f ? green : '#333'}`, background: filter === f ? green : 'transparent', color: filter === f ? '#000' : '#aaa', fontWeight: filter === f ? '700' : '500', cursor: 'pointer', fontSize: '13px', whiteSpace: 'nowrap', textTransform: 'capitalize' }}>
            {f}
          </button>
        ))}
      </div>

      {/* Orders List */}
      <div style={{ maxWidth: '640px', margin: '0 auto', padding: '16px' }}>
        {filteredOrders.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '80px 20px' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>📭</div>
            <p style={{ color: '#555', fontSize: '15px' }}>No orders here yet</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {filteredOrders.map(o => (
              <div key={o.id}
                onClick={() => markAsRead(o.id)}
                style={{ background: o.read ? '#1a1a1a' : '#1a2a1a', borderRadius: '12px', padding: '16px', border: `1px solid ${o.read ? '#222' : green}`, cursor: 'pointer' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    {!o.read && (
                      <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: green, flexShrink: 0 }} />
                    )}
                    <div>
                      <p style={{ margin: '0 0 2px', fontWeight: '700', fontSize: '15px', color: '#fff' }}>{o.buyerName}</p>
                      <p style={{ margin: 0, color: '#888', fontSize: '13px' }}>{o.productName} × {o.quantity}</p>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <p style={{ margin: '0 0 4px', color: green, fontSize: '13px', fontWeight: '700' }}>UGX {o.productPrice}</p>
                    <p style={{ margin: 0, color: '#444', fontSize: '11px' }}>
                      {o.createdAt?.toDate?.()?.toLocaleDateString() || 'Just now'}
                    </p>
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '14px' }}>💬</span>
                    <span style={{ color: '#555', fontSize: '12px' }}>WhatsApp</span>
                    {o.deliveryArea && (
                      <>
                        <span style={{ color: '#333' }}>•</span>
                        <span style={{ color: '#555', fontSize: '12px' }}>📍 {o.deliveryArea}</span>
                      </>
                    )}
                    {o.orderId && (
                      <>
                        <span style={{ color: '#333' }}>•</span>
                        <span style={{ color: '#444', fontSize: '11px' }}>#{o.orderId}</span>
                      </>
                    )}
                  </div>
                  <span style={{
                    background: o.status === 'fulfilled' ? '#1a2a1a' : o.status === 'out_of_stock' ? '#2a1a1a' : '#222',
                    color: o.status === 'fulfilled' ? green : o.status === 'out_of_stock' ? '#ff4444' : '#888',
                    padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: '600'
                  }}>
                    {o.status === 'fulfilled' ? '✓ Confirmed' : o.status === 'out_of_stock' ? 'Out of Stock' : 'Pending'}
                  </span>
                </div>

                {/* Open WhatsApp */}
                <button
                  onClick={e => { e.stopPropagation(); openWhatsApp(o) }}
                  style={{ width: '100%', marginTop: '12px', padding: '10px', background: 'transparent', color: green, border: `1px solid ${green}`, borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}>
                  💬 Open WhatsApp Chat
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default Inbox