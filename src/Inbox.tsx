import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSellerMessages, isUnreadMessage, type SellerMessage } from './useSellerMessages'
import { useSellerConversations, type SellerConversation } from './useSellerConversations'
import { useBuyerConversations, type BuyerConversation } from './useBuyerConversations'
import ConversationPanel from './ConversationPanel'
import { auth } from './firebase'

const green = '#adff2f'

function maskPhone(phone?: string): string {
  if (!phone) return 'N/A'
  const digits = phone.replace(/\D/g, '')
  if (digits.length < 7) return '****'
  return digits.substring(0, 4) + '****' + digits.slice(-2)
}

function formatTime(createdAt: { toDate?: () => Date } | null | undefined): string {
  if (!createdAt?.toDate) return ''
  const d = createdAt.toDate()
  const now = new Date()
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function platformMeta(platform?: string) {
  const key = (platform || 'web').toLowerCase()
  if (key.includes('whatsapp')) return { icon: '💬', label: 'WhatsApp' }
  if (key.includes('instagram')) return { icon: '📸', label: 'Instagram' }
  if (key.includes('tiktok')) return { icon: '🎵', label: 'TikTok' }
  if (key.includes('telegram')) return { icon: '✈️', label: 'Telegram' }
  if (key.includes('twitter')) return { icon: '🐦', label: 'Twitter' }
  if (key.includes('facebook')) return { icon: '📘', label: 'Facebook' }
  if (key.includes('email')) return { icon: '✉️', label: 'Email' }
  return { icon: '🌐', label: 'Web' }
}

const AVATAR_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4']
function avatarColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

type Thread = {
  key: string
  name: string
  avatarText: string
  preview: string
  timeValue: number
  timeLabel: string
  unread: boolean
  verified?: boolean
  platformIcon?: string
  guestPhone?: string
  kind: 'buyer' | 'seller' | 'guest'
  buyerConvo?: BuyerConversation
  sellerConvo?: SellerConversation
  guest?: SellerMessage
}
function Inbox() {
  const navigate = useNavigate()
  const { messages, unreadCount: unreadMessages, loading: messagesLoading } = useSellerMessages()
  const { conversations: sellerConversations, unreadCount: unreadSellerConversations, loading: conversationsLoading } = useSellerConversations()
  const { conversations: buyerConversations, unreadCount: unreadBuyerConversations, loading: buyerConversationsLoading } = useBuyerConversations()
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'unread'>('all')

  const threads: Thread[] = useMemo(() => {
    const list: Thread[] = []
    buyerConversations.forEach(c => {
      list.push({
        key: `buyer-${c.id}`,
        name: c.sellerName || 'Seller',
        avatarText: (c.sellerName || 'S').charAt(0).toUpperCase(),
        preview: `You: ${c.lastMessage || ''}`,
        timeValue: c.lastMessageAt?.toDate?.()?.getTime() || 0,
        timeLabel: formatTime(c.lastMessageAt),
        unread: !!c.unreadByBuyer,
        kind: 'buyer',
        buyerConvo: c,
      })
    })
    sellerConversations.forEach(c => {
      list.push({
        key: `seller-${c.id}`,
        name: c.buyerName || 'Buyer',
        avatarText: (c.buyerName || 'B').charAt(0).toUpperCase(),
        preview: c.lastMessage || '',
        timeValue: c.lastMessageAt?.toDate?.()?.getTime() || 0,
        timeLabel: formatTime(c.lastMessageAt),
        unread: !!c.unreadBySeller,
        kind: 'seller',
        sellerConvo: c,
      })
    })
    messages.forEach(m => {
      list.push({
        key: `msg-${m.id}`,
        name: m.senderName || 'Guest',
        avatarText: (m.senderName || 'G').charAt(0).toUpperCase(),
        preview: m.text,
        timeValue: m.createdAt?.toDate?.()?.getTime() || 0,
        timeLabel: formatTime(m.createdAt),
        unread: isUnreadMessage(m),
        verified: !!(m.verified && m.senderPhone),
        platformIcon: platformMeta(m.sourcePlatform).icon,
        guestPhone: m.senderPhone ? maskPhone(m.senderPhone) : undefined,
        kind: 'guest',
        guest: m,
      })
    })
    list.sort((a, b) => b.timeValue - a.timeValue)
    return list
  }, [buyerConversations, sellerConversations, messages])

  const totalUnread = unreadMessages + unreadSellerConversations + unreadBuyerConversations
  const loading = messagesLoading || conversationsLoading || buyerConversationsLoading
  const visible = filter === 'unread' ? threads.filter(t => t.unread) : threads
  const selected = threads.find(t => t.key === selectedKey) || null

  const openChat = (key: string) => {
    setSelectedKey(prev => (prev === key ? null : key))
  }

  const chatProps = selected ? (() => {
    if (selected.kind === 'buyer' && selected.buyerConvo) {
      const c = selected.buyerConvo
      return { sellerId: c.sellerId, buyerId: c.buyerId, sellerName: c.sellerName, buyerName: c.buyerName, productName: c.productName, productPrice: c.productPrice, productImage: c.productImage }
    }
    if (selected.kind === 'seller' && selected.sellerConvo) {
      const c = selected.sellerConvo
      return { sellerId: c.sellerId, buyerId: c.buyerId, sellerName: c.sellerName, buyerName: c.buyerName, productName: c.productName, productPrice: c.productPrice, productImage: c.productImage }
    }
    if (selected.guest) {
      const g = selected.guest
      return { sellerId: auth.currentUser?.uid || '', buyerId: g.senderUid, sellerName: 'You', buyerName: g.senderName, productName: g.productName, productPrice: g.productPrice }
    }
    return null
  })() : null

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#0f0f0f', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: '#555', fontFamily: 'sans-serif' }}>Loading inbox...</p>
      </div>
    )
  }

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

      <div style={{ maxWidth: '640px', margin: '0 auto', padding: '16px' }}>
        {/* Tabs */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
          {(['all', 'unread'] as const).map(t => (
            <button key={t} onClick={() => { setFilter(t); setSelectedKey(null) }}
              style={{ padding: '8px 18px', borderRadius: '999px', border: `1px solid ${filter === t ? green : '#333'}`, background: filter === t ? '#1a2a1a' : '#1a1a1a', color: filter === t ? green : '#aaa', fontWeight: '700', fontSize: '13px', cursor: 'pointer' }}>
              {t === 'all' ? 'All' : `Unread (${totalUnread})`}
            </button>
          ))}
        </div>

        {visible.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '80px 20px' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>{filter === 'unread' ? '🎉' : '📭'}</div>
            <p style={{ color: '#555', fontSize: '15px' }}>{filter === 'unread' ? 'No unread messages' : 'No messages yet'}</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {visible.map(t => {
              const isSelected = selectedKey === t.key
              return (
                <div key={t.key}>
                  <div onClick={() => openChat(t.key)}
                    style={{ display: 'flex', alignItems: 'center', gap: '12px', background: isSelected ? '#1a2a1a' : t.unread ? '#152015' : '#1a1a1a', borderRadius: isSelected ? '12px 12px 0 0' : '12px', padding: '14px 16px', border: `1px solid ${isSelected ? green : t.unread ? green : '#222'}`, cursor: 'pointer' }}>
                    <div style={{ position: 'relative', flexShrink: 0 }}>
                      <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: avatarColor(t.name), display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: '800', fontSize: '18px' }}>
                        {t.avatarText}
                      </div>
                      {t.platformIcon && (
                        <div style={{ position: 'absolute', bottom: '-2px', right: '-2px', background: '#0f0f0f', borderRadius: '50%', width: '20px', height: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', border: '1px solid #333' }}>
                          {t.platformIcon}
                        </div>
                      )}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                        <p style={{ margin: 0, fontWeight: '700', fontSize: '15px', color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {t.name}
                          {t.verified && (
                            <span style={{ display: 'inline-flex', alignItems: 'center', marginLeft: '8px', background: '#0d2a0d', color: green, fontSize: '10px', fontWeight: '700', padding: '2px 8px', borderRadius: '999px', border: `1px solid ${green}` }}>✓</span>
                          )}
                        </p>
                        <span style={{ color: '#555', fontSize: '11px', flexShrink: 0 }}>{t.timeLabel}</span>
                      </div>
                      <p style={{ margin: '2px 0 0', color: t.unread ? '#ddd' : '#888', fontSize: '13px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {t.preview}
                      </p>
                      {t.guestPhone && (
                        <p style={{ margin: '2px 0 0', color: '#555', fontSize: '11px' }}>📱 {t.guestPhone}</p>
                      )}
                    </div>
                  </div>

                  {isSelected && chatProps && (
                    <div style={{ background: '#111', border: `1px solid ${green}`, borderTop: 'none', borderRadius: '0 0 12px 12px', padding: '16px', marginBottom: '8px' }}>
                      {selected?.kind === 'guest' && selected.guest && (
                        <div style={{ marginBottom: '12px', padding: '12px', background: '#1a1a1a', borderRadius: '10px', border: '1px solid #2a2a2a' }}>
                          <p style={{ margin: '0 0 6px', color: '#aaa', fontSize: '13px', lineHeight: 1.5 }}>"{selected.guest.text}"</p>
                          <p style={{ margin: 0, color: '#555', fontSize: '12px' }}>
                            Guest buyer{selected.guestPhone ? ` · 📱 ${selected.guestPhone}` : ''}{selected.guest.productName ? ` · Asks about ${selected.guest.productName}` : ''} · Replies stay in Rachett
                          </p>
                        </div>
                      )}
                      <ConversationPanel {...chatProps} />
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

export default Inbox

