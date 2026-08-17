import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { collection, onSnapshot } from 'firebase/firestore'
import { db, auth } from './firebase'
import { onAuthStateChanged } from 'firebase/auth'

const green = '#adff2f'
const amber = '#ffaa00'
const red = '#ff4444'

interface PlatformStat {
  platform: string
  icon: string
  orders: number
  messages: number
  visits: number
  total: number
}

interface RecentItem {
  type: 'order' | 'message'
  from: string
  detail: string
  time: string
}

interface WeeklyReport {
  thisWeek: { visits: number; orders: number; conversion: number }
  lastWeek: { visits: number; orders: number; conversion: number } | null
  trend: number // percentage point change
  trendPct: number // percentage change relative to last week
  insight: string
  dailyThis: number[] // 7 values Mon-Sun, conversion %
  dailyLast: number[] // 7 values Mon-Sun, conversion %
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function getWeekBounds(date: Date): { start: Date; end: Date } {
  const d = new Date(date)
  const day = d.getDay()
  const diff = day === 0 ? 6 : day - 1 // Monday = 0
  const start = new Date(d)
  start.setDate(d.getDate() - diff)
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(start.getDate() + 6)
  end.setHours(23, 59, 59, 999)
  return { start, end }
}

function bucketByDay(items: { createdAt: Date | null }[], weekStart: Date): number[] {
  const counts = new Array(7).fill(0)
  for (const item of items) {
    if (!item.createdAt) continue
    const dayIdx = Math.floor((item.createdAt.getTime() - weekStart.getTime()) / 86400000)
    if (dayIdx >= 0 && dayIdx < 7) counts[dayIdx]++
  }
  return counts
}

function dailyConversion(visitsPerDay: number[], ordersPerDay: number[]): number[] {
  return visitsPerDay.map((v, i) => v > 0 ? Math.round((ordersPerDay[i] / v) * 1000) / 10 : 0)
}

function computeWeeklyReport(
  allVisits: { createdAt: Date | null; sourcePlatform: string }[],
  allOrderDates: { createdAt: Date | null }[]
): WeeklyReport {
  const now = new Date()
  const thisWeek = getWeekBounds(now)
  const lastWeekStart = new Date(thisWeek.start)
  lastWeekStart.setDate(lastWeekStart.getDate() - 7)
  const lastWeek = getWeekBounds(lastWeekStart)

  const thisVisits = bucketByDay(allVisits, thisWeek.start)
  const thisOrders = bucketByDay(allOrderDates, thisWeek.start)
  const lastVisits = bucketByDay(allVisits, lastWeek.start)
  const lastOrders = bucketByDay(allOrderDates, lastWeek.start)

  const thisV = thisVisits.reduce((a, b) => a + b, 0)
  const thisO = thisOrders.reduce((a, b) => a + b, 0)
  const lastV = lastVisits.reduce((a, b) => a + b, 0)
  const lastO = lastOrders.reduce((a, b) => a + b, 0)

  const thisConv = thisV > 0 ? (thisO / thisV) * 100 : 0
  const lastConv = lastV > 0 ? (lastO / lastV) * 100 : 0
  const trendPts = thisConv - lastConv
  const trendPct = lastConv > 0 ? ((thisConv - lastConv) / lastConv) * 100 : 0

  const dailyThis = dailyConversion(thisVisits, thisOrders)
  const dailyLast = dailyConversion(lastVisits, lastOrders)

  // Insight text
  let insight = ''
  if (lastV === 0 && lastO === 0) {
    insight = `📊 Your first weekly report is here. ${thisV} visits, ${thisO} orders. Keep sharing your store link — come back next week to see your trend.`
  } else if (trendPts >= 0) {
    const msgs = [
      `📈 Conversion is up ${Math.abs(trendPct).toFixed(0)}% from last week. Your store is connecting with more buyers — keep sharing.`,
      `🚀 More visitors are converting this week. +${Math.abs(trendPct).toFixed(0)}% vs last week. Your link is working.`,
      `💪 Solid week. ${thisConv.toFixed(1)}% conversion — up from ${lastConv.toFixed(1)}%. The momentum is real.`,
    ]
    insight = msgs[Math.floor(Math.random() * msgs.length)]
  } else {
    // Troubleshooting insight based on data
    if (thisV < lastV * 0.7) {
      insight = `💡 Visits dropped ${Math.round((1 - thisV / lastV) * 100)}% this week. Try sharing your store link more often — every post and bio link counts.`
    } else if (thisO === 0) {
      insight = `💡 ${thisV} visits but no orders this week. Make sure your products have clear names, prices, and images. Buyers need to see what you're selling at a glance.`
    } else {
      insight = `💡 ${thisV} visits, ${thisO} orders this week. Conversion is a bit lower than last week, but consistency wins. Keep your store link visible — buyers come back.`
    }
  }

  return {
    thisWeek: { visits: thisV, orders: thisO, conversion: thisConv },
    lastWeek: lastV > 0 || lastO > 0 ? { visits: lastV, orders: lastO, conversion: lastConv } : null,
    trend: trendPts,
    trendPct,
    insight,
    dailyThis,
    dailyLast,
  }
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

function timeAgo(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return 'Just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 7) return `${diffDay}d ago`
  return date.toLocaleDateString()
}

function AnalyticsPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [loading, setLoading] = useState(true)
  const [platformStats, setPlatformStats] = useState<PlatformStat[]>([])
  const [totalOrders, setTotalOrders] = useState(0)
  const [totalVisits, setTotalVisits] = useState(0)
  const [unreadMessages, setUnreadMessages] = useState(0)
  const [pendingOrders, setPendingOrders] = useState(0)
  const [repeatBuyers, setRepeatBuyers] = useState(0)
  const [recentActivity, setRecentActivity] = useState<RecentItem[]>([])
  const [weeklyReport, setWeeklyReport] = useState<WeeklyReport | null>(null)

  // Live snapshot data
  const [ordersData, setOrdersData] = useState<any[]>([])
  const [messagesData, setMessagesData] = useState<any[]>([])
  const [visitsData, setVisitsData] = useState<any[]>([])

  // Live data: subscribe to orders, messages, and visits
  useEffect(() => {
    const unsubs: (() => void)[] = []
    const authUnsub = onAuthStateChanged(auth, (user) => {
      unsubs.forEach(u => u())
      unsubs.length = 0
      if (!user) { navigate('/'); return }
      setOrdersData([])
      setMessagesData([])
      setVisitsData([])
      const onErr = (e: Error) => { console.error('Live analytics fetch failed:', e) }
      unsubs.push(
        onSnapshot(collection(db, 'sellers', user.uid, 'orders'), snap => setOrdersData(snap.docs.map(d => d.data())), onErr),
        onSnapshot(collection(db, 'sellers', user.uid, 'messages'), snap => setMessagesData(snap.docs.map(d => d.data())), onErr),
        onSnapshot(collection(db, 'sellers', user.uid, 'visits'), snap => setVisitsData(snap.docs.map(d => d.data())), onErr),
      )
    })
    return () => { authUnsub(); unsubs.forEach(u => u()) }
  }, [navigate])

  // Recompute all stats whenever any live data changes
  useEffect(() => {
    const platformMap = new Map<string, { orders: number; messages: number }>()
    let pendingCount = 0
    const buyerIds = new Set<string>()
    const allOrders: { buyerName: string; productName: string; createdAt: Date | null }[] = []
    const allActivityOrders: { buyerName: string; productName: string; createdAt: Date | null }[] = []
    let unreadCount = 0
    const allMessages: { senderName: string; text: string; createdAt: Date | null }[] = []
    let totalV = 0
    const visitCounts = new Map<string, number>()
    const allVisits: { createdAt: Date | null; sourcePlatform: string }[] = []

    for (const data of ordersData) {
      const platform = (data.sourcePlatform || 'Web').toLowerCase()
      if (data.status === 'fulfilled') {
        const existing = platformMap.get(platform) || { orders: 0, messages: 0 }
        existing.orders += 1
        platformMap.set(platform, existing)
        if (data.buyerUid) buyerIds.add(data.buyerUid)
        const ts = data.createdAt?.toDate ? data.createdAt.toDate() : data.createdAt instanceof Date ? data.createdAt : null
        allOrders.push({ buyerName: data.buyerName || 'Buyer', productName: data.productName || '', createdAt: ts })
      }
      if (!['fulfilled', 'out_of_stock', 'needs_details'].includes(data.status)) pendingCount++
      const ts2 = data.createdAt?.toDate ? data.createdAt.toDate() : data.createdAt instanceof Date ? data.createdAt : null
      allActivityOrders.push({ buyerName: data.buyerName || 'Buyer', productName: data.productName || '', createdAt: ts2 })
    }
    for (const data of messagesData) {
      const platform = (data.sourcePlatform || 'Web').toLowerCase()
      const existing = platformMap.get(platform) || { orders: 0, messages: 0 }
      existing.messages += 1
      platformMap.set(platform, existing)
      if (data.read === false) unreadCount++
      const ts = data.createdAt?.toDate ? data.createdAt.toDate() : data.createdAt instanceof Date ? data.createdAt : null
      allMessages.push({ senderName: data.senderName || 'Buyer', text: data.text || '', createdAt: ts })
    }
    for (const data of visitsData) {
      const platform = (data.sourcePlatform || 'Web').toLowerCase()
      visitCounts.set(platform, (visitCounts.get(platform) || 0) + 1)
      totalV++
      const ts = data.createdAt?.toDate ? data.createdAt.toDate() : data.createdAt instanceof Date ? data.createdAt : null
      allVisits.push({ createdAt: ts, sourcePlatform: platform })
    }
    const stats: PlatformStat[] = []
    let totalO = 0
    platformMap.forEach((counts, platform) => {
      const meta = platformMeta(platform)
      const visits = visitCounts.get(platform) || 0
      stats.push({ platform: meta.label, icon: meta.icon, orders: counts.orders, messages: counts.messages, visits, total: counts.orders + counts.messages })
      totalO += counts.orders
    })
    visitCounts.forEach((visits, platform) => {
      if (!platformMap.has(platform)) {
        const meta = platformMeta(platform)
        stats.push({ platform: meta.label, icon: meta.icon, orders: 0, messages: 0, visits, total: 0 })
      }
    })
    stats.sort((a, b) => b.visits - a.visits || b.total - a.total)

    const recentRaw: { type: 'order' | 'message'; from: string; detail: string; ts: number }[] = []
    for (const o of allActivityOrders) {
      if (o.createdAt) recentRaw.push({ type: 'order', from: o.buyerName, detail: `Ordered ${o.productName}`, ts: o.createdAt.getTime() })
    }
    for (const m of allMessages) {
      if (m.createdAt) recentRaw.push({ type: 'message', from: m.senderName, detail: m.text.slice(0, 80) + (m.text.length > 80 ? '...' : ''), ts: m.createdAt.getTime() })
    }
    recentRaw.sort((a, b) => b.ts - a.ts)
    const recent = recentRaw.slice(0, 5).map(r => ({ type: r.type, from: r.from, detail: r.detail, time: timeAgo(new Date(r.ts)) }))

    setPlatformStats(stats)
    setTotalOrders(totalO)
    setTotalVisits(totalV)
    setUnreadMessages(unreadCount)
    setPendingOrders(pendingCount)
    setRepeatBuyers(totalO - buyerIds.size)
    setRecentActivity(recent)
    setWeeklyReport(computeWeeklyReport(allVisits, allOrders.map(o => ({ createdAt: o.createdAt }))))
    setLoading(false)
  }, [ordersData, messagesData, visitsData])



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
            <div style={{ fontWeight: 800, color: '#fff', fontSize: 16 }}>rachett</div>
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

        {/* Weekly Report Hero */}
        {weeklyReport && (
          <div style={{ marginBottom: '28px' }}>
            <div style={{ background: 'linear-gradient(135deg, #111 0%, #0a1a0a 100%)', borderRadius: '16px', padding: '24px 28px', border: '1px solid #1a2a1a' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '20px' }}>
                {/* Left: Stats */}
                <div style={{ flex: 1, minWidth: '200px' }}>
                  <p style={{ margin: '0 0 4px', fontSize: '12px', color: '#666', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: '600' }}>📊 Weekly Report</p>
                  <p style={{ margin: '0 0 2px', fontSize: '36px', fontWeight: '900', color: green, letterSpacing: '-1px', lineHeight: '1.1' }}>
                    {weeklyReport.thisWeek.conversion.toFixed(1)}%
                  </p>
                  <p style={{ margin: '0 0 6px', fontSize: '13px', color: '#888' }}>
                    {weeklyReport.thisWeek.visits} visits · {weeklyReport.thisWeek.orders} orders this week
                  </p>
                  {weeklyReport.lastWeek && (
                    <p style={{ margin: 0, fontSize: '13px', color: '#fff' }}>
                      vs {weeklyReport.lastWeek.conversion.toFixed(1)}% last week{' '}
                      <span style={{ color: weeklyReport.trend >= 0 ? green : amber, fontWeight: '700' }}>
                        {weeklyReport.trend >= 0 ? '↑' : '↓'} {Math.abs(weeklyReport.trendPct).toFixed(0)}%
                      </span>
                    </p>
                  )}
                </div>

                {/* Right: Sparkline */}
                <div style={{ flex: 1, minWidth: '200px', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
                  <svg width="100%" height="56" viewBox="0 0 200 56" style={{ maxWidth: '280px' }}>
                    {/* Grid lines */}
                    <line x1="0" y1="0" x2="200" y2="0" stroke="#1a1a1a" strokeWidth="0.5" />
                    <line x1="0" y1="28" x2="200" y2="28" stroke="#1a1a1a" strokeWidth="0.5" />
                    <line x1="0" y1="55" x2="200" y2="55" stroke="#1a1a1a" strokeWidth="0.5" />
                    {/* Day labels */}
                    {DAYS.map((d, i) => (
                      <text key={d} x={i * (200 / 6)} y="52" textAnchor="middle" fill="#444" fontSize="6" fontFamily="sans-serif">{d}</text>
                    ))}
                    {/* Line helpers */}
                    {(() => {
                      const maxVal = Math.max(
                        ...weeklyReport.dailyThis,
                        ...weeklyReport.dailyLast,
                        1
                      )
                      const toY = (v: number) => 55 - (v / maxVal) * 45
                      const toX = (i: number) => (i / 6) * 200

                      const thisPath = weeklyReport.dailyThis.map((v, i) =>
                        `${i === 0 ? 'M' : 'L'}${toX(i)} ${toY(v)}`
                      ).join(' ')
                      const lastPath = weeklyReport.dailyLast.map((v, i) =>
                        `${i === 0 ? 'M' : 'L'}${toX(i)} ${toY(v)}`
                      ).join(' ')

                      return (
                        <>
                          {weeklyReport.lastWeek && (
                            <path d={lastPath} fill="none" stroke="#444" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.7" />
                          )}
                          <path d={thisPath} fill="none" stroke={green} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          {/* Dots on this week's line */}
                          {weeklyReport.dailyThis.map((v, i) => (
                            <circle key={i} cx={toX(i)} cy={toY(v)} r="2.5" fill={green} />
                          ))}
                        </>
                      )
                    })()}
                  </svg>
                </div>
              </div>

              {/* Insight */}
              <div style={{ marginTop: '16px', padding: '10px 14px', background: 'rgba(173,255,47,0.06)', borderRadius: '10px', borderLeft: `3px solid ${green}` }}>
                <p style={{ margin: 0, fontSize: '13px', color: '#ccc', lineHeight: '1.5' }}>{weeklyReport.insight}</p>
              </div>
            </div>
          </div>
        )}

        {/* Needs Attention Row */}
        {(unreadMessages > 0 || pendingOrders > 0) && (
          <div className="rt-attention" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '24px' }}>
            {unreadMessages > 0 && (
              <div style={{ background: '#1a0a0a', borderRadius: '12px', padding: '16px 20px', border: `1px solid ${red}`, display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: `${red}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', flexShrink: 0 }}>💬</div>
                <div>
                  <p style={{ margin: 0, fontSize: '13px', color: '#aaa' }}>Unread messages</p>
                  <p style={{ margin: 0, fontWeight: '800', fontSize: '22px', color: red }}>{unreadMessages}</p>
                </div>
              </div>
            )}
            {pendingOrders > 0 && (
              <div style={{ background: '#1a1005', borderRadius: '12px', padding: '16px 20px', border: `1px solid ${amber}`, display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: `${amber}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', flexShrink: 0 }}>📦</div>
                <div>
                  <p style={{ margin: 0, fontSize: '13px', color: '#aaa' }}>Pending orders</p>
                  <p style={{ margin: 0, fontWeight: '800', fontSize: '22px', color: amber }}>{pendingOrders}</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Insight Cards */}
        <div className="rt-insights" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '24px' }}>
          <div style={{ background: '#1a1a1a', borderRadius: '12px', padding: '16px', border: '1px solid #222', textAlign: 'center' }}>
            <p style={{ fontSize: '28px', fontWeight: '800', margin: '0 0 2px', color: green }}>{totalVisits}</p>
            <p style={{ fontSize: '11px', color: '#888', margin: 0, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Visits</p>
          </div>
          <div style={{ background: '#1a1a1a', borderRadius: '12px', padding: '16px', border: '1px solid #222', textAlign: 'center' }}>
            <p style={{ fontSize: '28px', fontWeight: '800', margin: '0 0 2px', color: green }}>{totalOrders}</p>
            <p style={{ fontSize: '11px', color: '#888', margin: 0, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Orders</p>
          </div>
          <div style={{ background: '#1a1a1a', borderRadius: '12px', padding: '16px', border: '1px solid #222', textAlign: 'center' }}>
            <p style={{ fontSize: '28px', fontWeight: '800', margin: '0 0 2px', color: totalVisits > 0 ? (totalOrders / totalVisits >= 0.03 ? green : amber) : '#555' }}>
              {totalVisits > 0 ? `${((totalOrders / totalVisits) * 100).toFixed(1)}%` : '—'}
            </p>
            <p style={{ fontSize: '11px', color: '#888', margin: 0, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Conversion</p>
          </div>
          <div style={{ background: '#1a1a1a', borderRadius: '12px', padding: '16px', border: '1px solid #222', textAlign: 'center' }}>
            <p style={{ fontSize: '28px', fontWeight: '800', margin: '0 0 2px', color: repeatBuyers > 0 ? green : '#555' }}>{repeatBuyers}</p>
            <p style={{ fontSize: '11px', color: '#888', margin: 0, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Repeat Buys</p>
          </div>
        </div>

        {/* Platform Breakdown */}
        <h2 style={{ fontSize: '18px', fontWeight: '700', marginBottom: '16px' }}>📊 Where customers come from</h2>
        {platformStats.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', background: '#1a1a1a', borderRadius: '12px', border: '1px dashed #333', marginBottom: '32px' }}>
            <p style={{ color: '#444', margin: 0 }}>No data yet. Share your store link to start tracking.</p>
          </div>
        ) : (
          <div style={{ marginBottom: '32px', background: '#1a1a1a', borderRadius: '12px', border: '1px solid #222', overflow: 'hidden' }}>
            {/* Table Header */}
            <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr 1fr', gap: '8px', padding: '12px 16px', background: '#111', borderBottom: '1px solid #222', fontSize: '12px', color: '#666', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: '600' }}>
              <span>Source</span>
              <span style={{ textAlign: 'center' }}>Visitors</span>
              <span style={{ textAlign: 'center' }}>Orders</span>
              <span style={{ textAlign: 'center' }}>Conversion</span>
            </div>
            {/* Table Rows */}
            {platformStats.map((stat, i) => {
              const convRate = stat.visits > 0 ? ((stat.orders / stat.visits) * 100).toFixed(1) : '—'
              const convColor = stat.visits > 0 && stat.orders > 0
                ? (stat.orders / stat.visits >= 0.05 ? green : stat.orders / stat.visits >= 0.02 ? amber : '#888')
                : '#555'
              return (
                <div key={stat.platform}
                  style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr 1fr', gap: '8px', padding: '14px 16px', alignItems: 'center', borderBottom: i < platformStats.length - 1 ? '1px solid #1a1a1a' : 'none', fontSize: '14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '18px' }}>{stat.icon}</span>
                    <span style={{ fontWeight: '600', color: '#fff' }}>{stat.platform}</span>
                  </div>
                  <span style={{ textAlign: 'center', color: stat.visits > 0 ? '#fff' : '#555', fontWeight: '600' }}>{stat.visits}</span>
                  <span style={{ textAlign: 'center', color: stat.orders > 0 ? '#fff' : '#555', fontWeight: '600' }}>{stat.orders}</span>
                  <span style={{ textAlign: 'center', color: convColor, fontWeight: '700' }}>{convRate}{stat.visits > 0 ? '%' : ''}</span>
                </div>
              )
            })}
          </div>
        )}

        {/* Recent Activity */}
        {recentActivity.length > 0 && (
          <>
            <h2 style={{ fontSize: '18px', fontWeight: '700', marginBottom: '16px' }}>🕐 Recent Activity</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '32px' }}>
              {recentActivity.map((item, i) => (
                <div key={i} style={{ background: '#1a1a1a', borderRadius: '10px', padding: '12px 16px', border: '1px solid #222', display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '16px', flexShrink: 0 }}>{item.type === 'order' ? '📦' : '💬'}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: '13px', fontWeight: '600', color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {item.from}
                    </p>
                    <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#777', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {item.detail}
                    </p>
                  </div>
                  <span style={{ fontSize: '11px', color: '#555', flexShrink: 0 }}>{item.time}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {/* One link — auto-detects platform */}
        <h2 style={{ fontSize: '18px', fontWeight: '700', marginBottom: '16px' }}>🔗 Share Your brand</h2>
        <p style={{ color: '#888', fontSize: '13px', margin: '0 0 16px' }}>
          Paste this link anywhere — Instagram, TikTok, WhatsApp, everywhere. rachett detects where traffic comes from automatically.
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