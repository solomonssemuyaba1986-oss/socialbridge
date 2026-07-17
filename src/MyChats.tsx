import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useBuyerConversations } from './useBuyerConversations'
import ConversationPanel from './ConversationPanel'

const green = '#adff2f'

function formatDate(createdAt: any): string {
  if (createdAt?.toDate) return createdAt.toDate().toLocaleString()
  return 'Just now'
}

function MyChats() {
  const navigate = useNavigate()
  const { conversations, unreadCount, loading, userId } = useBuyerConversations()
  const [selectedConvo, setSelectedConvo] = useState<string | null>(null)

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#0f0f0f', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: '#555', fontFamily: 'sans-serif' }}>Loading chats...</p>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f0f', fontFamily: 'sans-serif', color: '#fff' }}>
      {/* Top Nav */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px', borderBottom: '1px solid #1a1a1a' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button onClick={() => navigate('/browse')}
            style={{ background: 'transparent', border: 'none', color: '#888', cursor: 'pointer', fontSize: '14px', padding: 0 }}>
            ← Back
          </button>
          <h1 style={{ margin: 0, fontSize: '18px', fontWeight: '800' }}>My Chats</h1>
          {unreadCount > 0 && (
            <div style={{ background: green, color: '#000', borderRadius: '20px', padding: '2px 10px', fontSize: '12px', fontWeight: '800' }}>
              {unreadCount} new
            </div>
          )}
        </div>
      </div>

      <div style={{ maxWidth: '640px', margin: '0 auto', padding: '16px' }}>
        {conversations.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '80px 20px' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>💬</div>
            <p style={{ color: '#555', fontSize: '15px' }}>No conversations yet</p>
            <p style={{ color: '#444', fontSize: '13px' }}>Browse products and message a seller to get started</p>
            <button onClick={() => navigate('/browse')}
              style={{ marginTop: '16px', padding: '12px 24px', background: green, color: '#000', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '14px' }}>
              Browse Products
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {conversations.map(convo => {
              const unread = convo.unreadByBuyer
              const selected = selectedConvo === convo.id
              return (
                <div key={convo.id}>
                  <div
                    onClick={() => setSelectedConvo(selected ? null : convo.id)}
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
                          <p style={{ margin: '0 0 2px', fontWeight: '700', fontSize: '15px', color: '#fff' }}>{convo.sellerName}</p>
                          <p style={{ margin: 0, color: '#888', fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {convo.lastMessage}
                          </p>
                        </div>
                      </div>
                      <p style={{ margin: 0, color: '#444', fontSize: '11px', flexShrink: 0, marginLeft: '8px' }}>{formatDate(convo.lastMessageAt)}</p>
                    </div>
                  </div>

                  {selected && (
                    <div style={{
                      background: '#111', border: `1px solid ${green}`, borderTop: 'none',
                      borderRadius: '0 0 12px 12px', padding: '20px', marginBottom: '8px',
                    }}>
                      <ConversationPanel
                        sellerId={convo.sellerId}
                        buyerId={userId || ''}
                        sellerName={convo.sellerName}
                        buyerName={convo.buyerName}
                        productName={convo.productName}
                        productPrice={convo.productPrice}
                        productImage={convo.productImage}
                      />
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

export default MyChats
