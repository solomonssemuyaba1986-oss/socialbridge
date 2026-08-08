import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { collection, getDocs } from 'firebase/firestore'
import { db, auth } from './firebase'
import { onAuthStateChanged } from 'firebase/auth'

const green = '#adff2f'

interface PlatformStat {
  platform: string
  icon: string
  orders: number
  messages: number
  total: number
}

function platformMeta(platform: string) {
  const key = platform.toLowerCase()
  if (key.includes('instagram')) return { icon: '📸', label: 'Instagram', color: '#E4405F' }
  if (key.includes('tiktok')) return { icon: '🎵', label: 'TikTok', color: '#00F2EA' }
  if (key.includes('whatsapp')) return { icon: '💬', label: 'WhatsApp', color: '#25D366' }
  if (key.includes('telegram')) return { icon: '✈️', label: 'Telegram', color: '#2CA5E0' }
  if (key.includes('twitter')) return { icon: '🐦', label: 'Twitter', color: '#1DA1F2' }
  if (key.includes('facebook')) return { icon: '📘', label: 'Facebook', color: '#4267B2' }
  if (key.includes('email')) return { icon: '✉️', label: 'Email', color: '#999' }
  if (key.includes('chat') || key.includes('browse')) return { icon: '🌐', label: 'Web', color: '#888' }
  return { icon: '🌐', label: platform || 'Web', color: '#888' }
}

function AnalyticsPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [loading, setLoading] = useState(true)
  const [platformStats, setPlatformStats] = useState<PlatformStat[]>([])
  const [totalOrders, setTotalOrders] = useState(0)
  const [totalMessages, setTotalMessages] = useState(0)

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) { navigate('/'); return }
      try {
        // Fetch orders
        const ordersSnap = await getDocs(collection(db, 'sellers', user.uid, 'orders'))
        const platformMap = new Map<string, { orders: number; messages: number }>()

        ordersSnap.docs.forEach(doc => {
          const platform = (doc.data().sourcePlatform || 'Web').toLowerCase()
          const existing = platformMap.get(platform) || { orders: 0, messages: 0 }
          existing.orders += 1
          platformMap.set(platform, existing)
        })

        // Fetch messages
        const messagesSnap = await getDocs(collection(db, 'sellers', user.uid, 'messages'))
        messagesSnap.docs.forEach(doc => {
          const platform = (doc.data().sourcePlatform || 'Web').toLowerCase()
          const existing = platformMap.get(platform) || { orders: 0, messages: 0 }
          existing.messages += 1
          platformMap.set(platform, existing)
        })

        const stats: PlatformStat[] = []
        let totalO = 0
        let totalM = 0

        platformMap.forEach((counts, platform) => {
          const meta = platformMeta(platform)
          stats.push({
            platform: meta.label,
            icon: meta.icon,
            orders: counts.orders,
            messages: counts.messages,
            total: counts.orders + counts.messages,
          })
          totalO += counts.orders
          totalM += counts.messages
        })

        stats.sort((a, b) => b.total - a.total)
        setPlatformStats(stats)
        setTotalOrders(totalO)
        setTotalMessages(totalM)
      } catch (err) {
        console.error('Analytics load error:', err)
      } finally {
        setLoading(false)
      }
    })
    return () => unsubscribe()
  }, [navigate])


  const navItems = [
    { label: 'Dashboard', path: '/dashboard', icon: '📊' },
    { label: 'Products', path: '/products', icon: '🛍️' },
    { label: 'Orders', path: '/orders', icon: '📦' },
    { label: 'Inbox', path: '/inbox', icon: '📩' },
    { label: 'Analytics', path: '/analytics', icon: '📈' },
    { label: 'Settings', path: '/edit-store', icon: '⚙️' },
  ]

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#0f0f0f', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: '#555', fontFamily: 'sans-serif' }}>Loading analytics...</p>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f0f', fontFamily: 'sans-serif', color: '#fff', display: 'flex' }}>
      {/* Sidebar */}
      <div style={{ position: 'fixed', left: 0, top: 0, bottom: 0, width: 260, background: '#070707', borderRight: '1px solid #111', padding: '28px 16px', display: 'flex', flexDirection: 'column', gap: '28px', zIndex: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px' }}>
          <div style={{ background: green, width: 34, height: 34, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 16, color: '#000' }}>R</div>
          <div>
            <div style={{ fontWeight: 800, color: '#fff', fontSize: 16 }}>Rachett</div>
            <div style={{ color: '#777', fontSize: 12 }}>Analytics</div>
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

      {/* Main Content */}
      <div style={{ width: '100%', marginLeft: 260, padding: '24px 28px', minHeight: '100vh' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '20px', fontWeight: '800' }}>Analytics</h1>
            <p style={{ margin: '4px 0 0', color: '#888', fontSize: '13px' }}>
              See where your leads and orders come from.
            </p>
          </div>
          <button onClick={() => navigate('/dashboard')}
            style={{ background: '#111', border: '1px solid #222', color: '#fff', borderRadius: '12px', padding: '10px 16px', cursor: 'pointer', fontSize: '13px' }}>
            Back to Dashboard
          </button>
        </div>

        {/* Stats Row */}
        <div className="rt-stats" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px', marginBottom: '32px' }}>
          <div style={{ background: '#1a1a1a', borderRadius: '12px', padding: '24px', border: '1px solid #222' }}>
            <p style={{ fontSize: '32px', fontWeight: '800', margin: '0 0 4px', color: green }}>{totalOrders + totalMessages}</p>
            <p style={{ fontSize: '13px', color: '#888', margin: 0 }}>Total Interactions</p>
          </div>
          <div style={{ background: '#1a1a1a', borderRadius: '12px', padding: '24px', border: '1px solid #222' }}>
            <p style={{ fontSize: '32px', fontWeight: '800', margin: '0 0 4px', color: green }}>{totalOrders}</p>
            <p style={{ fontSize: '13px', color: '#888', margin: 0 }}>Orders</p>
          </div>
          <div style={{ background: '#1a1a1a', borderRadius: '12px', padding: '24px', border: '1px solid #222' }}>
            <p style={{ fontSize: '32px', fontWeight: '800', margin: '0 0 4px', color: green }}>{totalMessages}</p>
            <p style={{ fontSize: '13px', color: '#888', margin: 0 }}>Messages</p>
          </div>
        </div>

        {/* Platform Breakdown */}
        <h2 style={{ fontSize: '18px', fontWeight: '700', marginBottom: '16px' }}>📊 Platform Breakdown</h2>
        {platformStats.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', background: '#1a1a1a', borderRadius: '12px', border: '1px dashed #333', marginBottom: '32px' }}>
            <p style={{ color: '#444', margin: 0 }}>No data yet. Share your store link to start tracking.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '32px' }}>
            {platformStats.map(stat => {
              const meta = platformMeta(stat.platform)
              const maxTotal = platformStats[0]?.total || 1
              const barWidth = Math.round((stat.total / maxTotal) * 100)
              return (
                <div key={stat.platform} style={{ background: '#1a1a1a', borderRadius: '12px', padding: '16px 20px', border: '1px solid #222' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '20px' }}>{stat.icon}</span>
                      <span style={{ fontWeight: '700', fontSize: '15px' }}>{stat.platform}</span>
                    </div>
                    <div style={{ display: 'flex', gap: '16px', fontSize: '13px', color: '#888' }}>
                      <span>📦 {stat.orders} orders</span>
                      <span>💬 {stat.messages} msgs</span>
                      <span style={{ color: green, fontWeight: '700' }}>{stat.total} total</span>
                    </div>
                  </div>
                  <div style={{ height: '6px', background: '#222', borderRadius: '3px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', background: meta.color, borderRadius: '3px', width: `${barWidth}%`, transition: 'width 0.5s ease' }} />
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* One link — auto-detects platform */}
        <h2 style={{ fontSize: '18px', fontWeight: '700', marginBottom: '16px' }}>🔗 Share Your Store</h2>
        <p style={{ color: '#888', fontSize: '13px', margin: '0 0 16px' }}>
          Paste this link anywhere — Instagram, TikTok, WhatsApp, everywhere. Rachett detects where traffic comes from automatically.
        </p>
        <button
          onClick={() => {
            navigator.clipboard.writeText(`${window.location.origin}/store/__YOUR_SLUG__`)
            alert('Link copied! Paste it anywhere you sell.')
          }}
          style={{ width: '100%', padding: '16px', background: green, color: '#000', border: 'none', borderRadius: '12px', fontWeight: '800', cursor: 'pointer', fontSize: '15px', marginBottom: '32px' }}>
          📋 Copy Store Link
        </button>
      </div>
    </div>
  )
}

export default AnalyticsPage