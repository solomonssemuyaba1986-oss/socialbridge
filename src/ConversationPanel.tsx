import { useEffect, useRef, useState } from 'react'
import { useConversation } from './useConversation'

type Props = {
  sellerId: string
  buyerId: string
  sellerName?: string
  buyerName?: string
}

export default function ConversationPanel({ sellerId, buyerId, sellerName, buyerName }: Props) {
  const { messages, loading, sendMessage } = useConversation(sellerId, buyerId)
  const [text, setText] = useState('')
  const [showQuickReplies, setShowQuickReplies] = useState(false)
  const listRef = useRef<HTMLDivElement | null>(null)

  const quickReplies = [
    'Yes, I can reserve it for you now.',
    'I have one ready to ship today.',
    'Would you like delivery or pickup?',
    'Can I get your exact address for delivery?',
    'I can bundle it with another item if you want.',
    'This is the last piece available, grab it now.',
    'waiting for your order, its your move.',
    'Thanks! I will confirm your order in a minute.',
    'I can hold it for you until this evening.',
    'Do you want the same color or a different one?',
    'I can offer free delivery for this order.',
    'yes, thanks for reaching on to me, what would you want to purchase?'
  ]

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const handleSend = async (newText?: string) => {
    const messageText = (newText !== undefined ? newText : text).trim()
    if (!messageText) return
    try {
      await sendMessage(sellerId, messageText, sellerName || 'Seller', buyerName || 'Buyer')
      setText('')
      setShowQuickReplies(false)
    } catch (err) {
      console.error('Failed to send conversation message:', err)
      alert('Failed to send message')
    }
  }

  const handleQuickReply = async (reply: string) => {
    setText(reply)
    await handleSend(reply)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ borderBottom: '1px solid #222', paddingBottom: 12 }}>
        <div style={{ fontWeight: 800, fontSize: 18, color: '#fff' }}>{buyerName || 'Buyer'}</div>
        <div style={{ fontSize: 13, color: '#888', marginTop: 4 }}>Chat with {buyerName || 'the buyer'}</div>
      </div>

      <div ref={listRef} style={{ maxHeight: 420, overflowY: 'auto', padding: 12, background: '#0a0a0a', borderRadius: 14, border: '1px solid #222', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {loading ? (
          <div style={{ color: '#666' }}>Loading conversation…</div>
        ) : messages.length === 0 ? (
          <div style={{ color: '#666' }}>No messages yet</div>
        ) : (
          messages.map((m: any) => {
            const status = m.status || 'sent'
            const statusStyles: Record<string, { color: string; label: string }> = {
              sent: { color: '#adff2f', label: 'Sent' },
              delivered: { color: '#3399ff', label: 'Delivered' },
              seen: { color: '#a457ff', label: 'Seen' },
            }
            const statusInfo = statusStyles[status] || statusStyles.sent
            return (
              <div key={m.id} style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
                <div style={{ fontSize: 12, color: '#888' }}>{m.senderId === sellerId ? sellerName || 'Seller' : buyerName || 'Buyer'}</div>
                <div style={{ width: '100%', background: '#111', color: '#eee', padding: '14px', borderRadius: 16, border: '1px solid #222', fontSize: 14, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {m.text}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 11, color: '#666' }}>
                  <span>{m.createdAt?.toDate ? m.createdAt.toDate().toLocaleString() : 'Now'}</span>
                  <span style={{ color: statusInfo.color, fontWeight: 700 }}>{statusInfo.label}</span>
                </div>
              </div>
            )
          })
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input value={text} onChange={e => setText(e.target.value)} placeholder="Write a reply..." style={{ flex: 1, padding: '14px 16px', borderRadius: 16, border: '1px solid #333', background: '#101010', color: '#fff', minHeight: 46 }} />
          <button onClick={() => setShowQuickReplies(prev => !prev)} style={{ width: 46, height: 46, borderRadius: 16, background: '#222', border: '1px solid #333', color: '#fff', cursor: 'pointer', fontSize: 24, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
          <button onClick={() => handleSend()} style={{ background: '#adff2f', color: '#000', padding: '13px 22px', borderRadius: 16, border: 'none', fontWeight: 700, cursor: 'pointer' }}>Send</button>
        </div>

        {showQuickReplies && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8, background: '#111', border: '1px solid #222', borderRadius: 16, padding: 12 }}>
            {quickReplies.map(reply => (
              <button key={reply} onClick={() => handleQuickReply(reply)} style={{ padding: '12px 14px', borderRadius: 14, border: '1px solid #333', background: '#161616', color: '#fff', cursor: 'pointer', textAlign: 'left', fontSize: 13, lineHeight: 1.4 }}>
                {reply}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
