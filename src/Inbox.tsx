import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSellerMessages, isUnreadMessage } from './useSellerMessages'
import { useSellerConversations } from './useSellerConversations'
import { useBuyerConversations } from './useBuyerConversations'
import ConversationPanel from './ConversationPanel'

const green = '#adff2f'

function maskPhone(phone?: string): string {
  if (!phone) return 'N/A'
  const digits = phone.replace(/\D/g, '')
  if (digits.length < 7) return '****'
  return digits.substring(0, 4) + '****' + digits.slice(-2)
}

function formatDate(createdAt: { toDate?: () => Date } | null | undefined): string {
  if (createdAt?.toDate) return createdAt.toDate().toLocaleString()
  return 'Just now'
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
  if (key.includes('web')) return { icon: '🌐', label: 'Web' }
  return { icon: '🌐', label: platform || 'Web' }
}

function Inbox() {
  const navigate = useNavigate()
  const { messages, unreadCount: unreadMessages, loading: messagesLoading } = useSellerMessages()
  const { conversations: sellerConversations, unreadCount: unreadSellerConversations, loading: conversationsLoading } = useSellerConversations()
  const { conversations: buyerConversations, unreadCount: unreadBuyerConversations, loading: buyerConversationsLoading } = useBuyerConversations()
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null)
  const [selectedConvoId, setSelectedConvoId] = useState<string | null>(null)

  const loading = messagesLoading || conversationsLoading || buyerConversationsLoading
  const totalUnread = unreadMessages + unreadSellerConversations + unreadBuyerConversations

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#0f0f0f', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: '#555', fontFamily: 'sans-serif' }}>Loading inbox...</p>
      </div>
    )
  }

  const listEmpty = messages.length === 0 && sellerConversations.length === 0 && buyerConversations.length === 0

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

      <div className="rt-container" style={{ maxWidth: '640px', margin: '0 auto', padding: '16px' }}>
        {listEmpty ? (
          <div style={{ textAlign: 'center', padding: '80px 20px' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>📭</div>
            <p style={{ color: '#555', fontSize: '15px' }}>No messages yet</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>

            {/* Buyer conversations — YOU messaged someone */}
            {buyerConversations.map(convo => {
              const unread = convo.unreadByBuyer
              const selected = selectedConvoId === `buyer-${convo.id}`
              return (
                <div key={`buyer-convo-${convo.id}`}>
                  <div
                    onClick={() => {
                      const id = `buyer-${convo.id}`
                      setSelectedConvoId(selected ? null : id)
                      setSelectedMessageId(null)
                    }}
                    style={{
                      background: selected ? '#1a2a1a' : unread ? '#152015' : '#1a1a1a',
                      borderRadius: selected ? '12px 12px 0 0' : '12px',
                      padding: '16px',
                      border: `1px solid ${selected ? green : unread ? green : '#222'}`,
                      cursor: 'pointer',
                    }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                        {unread && <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: green, flexShrink: 0 }} />}
                        <div style={{ minWidth: 0 }}>
                          <p style={{ margin: '0 0 2px', fontWeight: '700', fontSize: '15px', color: '#fff' }}>
                            <span style={{ color: green }}>You →</span> {convo.sellerName}
                          </p>
                          <p style={{ margin: 0, color: '#888', fontSize: '13px' }}>
                            {convo.productName ? ` Inquiry · ${convo.productName}` : ' Message'}
                          </p>
                        </div>
                      </div>
                      <p style={{ margin: 0, color: '#444', fontSize: '11px', flexShrink: 0, marginLeft: '8px' }}>{formatDate(convo.lastMessageAt)}</p>
                    </div>
                    <p style={{ margin: '0 0 8px', color: '#aaa', fontSize: '13px', lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {convo.lastMessage}
                    </p>
                    <span style={{ color: '#555', fontSize: '12px' }}>{unread ? 'Tap to read message' : 'Tap to view again'}</span>
                  </div>
                  {selected && (
                    <DetailPanel title="Conversation">
                      <ConversationPanel sellerId={convo.sellerId} buyerId={convo.buyerId} sellerName={convo.sellerName} buyerName={convo.buyerName} productName={convo.productName} productPrice={convo.productPrice} productImage={convo.productImage} />
                    </DetailPanel>
                  )}
                </div>
              )
            })}

            {/* Seller conversations — someone messaged YOU */}
            {sellerConversations.map(convo => {
              const unread = convo.unreadBySeller
              const selected = selectedConvoId === convo.id
              return (
                <div key={`convo-${convo.id}`}>
                  <div
                    onClick={() => {
                      setSelectedConvoId(selected ? null : convo.id)
                      setSelectedMessageId(null)
                    }}
                    style={{
                      background: selected ? '#1a2a1a' : unread ? '#152015' : '#1a1a1a',
                      borderRadius: selected ? '12px 12px 0 0' : '12px',
                      padding: '16px',
                      border: `1px solid ${selected ? green : unread ? green : '#222'}`,
                      cursor: 'pointer',
                    }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                        {unread && <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: green, flexShrink: 0 }} />}
                        <div style={{ minWidth: 0 }}>
                          <p style={{ margin: '0 0 2px', fontWeight: '700', fontSize: '15px', color: '#fff' }}>{convo.buyerName}</p>
                          <p style={{ margin: 0, color: '#888', fontSize: '13px' }}>
                            {convo.productName ? `Inquiry · ${convo.productName}` : 'Message'}
                          </p>
                        </div>
                      </div>
                      <p style={{ margin: 0, color: '#444', fontSize: '11px', flexShrink: 0, marginLeft: '8px' }}>{formatDate(convo.lastMessageAt)}</p>
                    </div>
                    <p style={{ margin: '0 0 8px', color: '#aaa', fontSize: '13px', lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {convo.lastMessage}
                    </p>
                    <span style={{ color: '#555', fontSize: '12px' }}>{unread ? 'Tap to read message' : 'Tap to view again'}</span>
                  </div>
                  {selected && (
                    <DetailPanel title="Conversation">
                      <ConversationPanel sellerId={convo.sellerId} buyerId={convo.buyerId} sellerName={convo.sellerName} buyerName={convo.buyerName} productName={convo.productName} productPrice={convo.productPrice} productImage={convo.productImage} />
                    </DetailPanel>
                  )}
                </div>
              )
            })}

            {/* Guest messages (verified OTP) */}
            {messages.map(m => {
              const unread = isUnreadMessage(m)
              const selected = selectedMessageId === m.id
              const isVerifiedGuest = m.verified && m.senderPhone
              return (
                <div key={`msg-${m.id}`}>
                  <div
                    onClick={() => {
                      setSelectedMessageId(selected ? null : m.id)
                      setSelectedConvoId(null)
                    }}
                    style={{
                      background: selected ? '#1a2a1a' : unread ? '#152015' : '#1a1a1a',
                      borderRadius: selected && selectedMessageId ? '12px 12px 0 0' : '12px',
                      padding: '16px',
                      border: `1px solid ${selected ? green : unread ? green : '#222'}`,
                      cursor: 'pointer',
                    }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                        {unread && <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: green, flexShrink: 0 }} />}
                        <div style={{ minWidth: 0 }}>
                          <p style={{ margin: '0 0 2px', fontWeight: '700', fontSize: '15px', color: '#fff' }}>
                            {m.senderName}
                            {isVerifiedGuest && (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', marginLeft: '8px', background: '#0d2a0d', color: green, fontSize: '10px', fontWeight: '700', padding: '2px 8px', borderRadius: '999px', border: `1px solid ${green}` }}>
                                ✓ Verified
                              </span>
                            )}
                          </p>
                          <p style={{ margin: 0, color: '#888', fontSize: '13px' }}>Message · {m.productName}</p>
                          {isVerifiedGuest && (
                            <p style={{ margin: '4px 0 0', color: '#555', fontSize: '11px' }}>📱 {maskPhone(m.senderPhone)}</p>
                          )}
                        </div>
                      </div>
                      <p style={{ margin: 0, color: '#444', fontSize: '11px', flexShrink: 0, marginLeft: '8px' }}>{formatDate(m.createdAt)}</p>
                    </div>
                    <p style={{ margin: '0 0 8px', color: '#aaa', fontSize: '13px', lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {m.text}
                    </p>
                    <span style={{ color: '#555', fontSize: '12px' }}>{unread ? 'Tap to read message' : 'Tap to view again'}</span>
                  </div>
                  {selected && (
                    <DetailPanel title="Conversation">
                      {m.senderUid?.startsWith('guest_') ? (
                        <div>
                          <DetailRow label="Name" value={m.senderName} />
                          <DetailRow label="Phone" value={maskPhone(m.senderPhone)} />
                          <DetailRow label="Verified" value="✓ Yes" />
                          <DetailRow label="Product" value={m.productName} />
                          <DetailRow label="Message" value={m.text} />
                          <DetailRow label="Channel" value={`${platformMeta(m.sourcePlatform).icon} ${platformMeta(m.sourcePlatform).label}`} />
                          <DetailRow label="Sent" value={formatDate(m.createdAt)} />
                          <div style={{ marginTop: '16px' }}>
                            <a href={`https://wa.me/${m.senderPhone?.replace(/\D/g, '')}?text=Hi ${m.senderName}! Thanks for your message about ${m.productName}.`}
                              target="_blank"
                              style={{ display: 'block', width: '100%', padding: '12px', background: 'transparent', color: green, border: `1px solid ${green}`, borderRadius: '8px', cursor: 'pointer', fontSize: '14px', fontWeight: '600', textAlign: 'center', textDecoration: 'none', boxSizing: 'border-box' }}>
                              💬 Reply on WhatsApp
                            </a>
                          </div>
                        </div>
                      ) : (
                        <ConversationPanel sellerId={m.receiverUid || ''} buyerId={m.senderUid} buyerName={m.senderName} productName={m.productName} productPrice={m.productPrice} />
                      )}
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
    <div style={{ background: '#111', border: `1px solid ${green}`, borderTop: 'none', borderRadius: '0 0 12px 12px', padding: '20px', marginBottom: '8px' }}>
      <p style={{ margin: '0 0 16px', color: green, fontSize: '12px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{title}</p>
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

export default Inbox