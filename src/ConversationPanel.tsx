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
  const listRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const handleSend = async () => {
    if (!text.trim()) return
    try {
      await sendMessage(sellerId, text.trim(), sellerName || 'Seller', buyerName || 'Buyer')
      setText('')
    } catch (err) {
      console.error('Failed to send conversation message:', err)
      alert('Failed to send message')
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontWeight: 800 }}>{buyerName || 'Buyer'}</div>
          <div style={{ fontSize: 12, color: '#888' }}>{buyerId}</div>
        </div>
        <div style={{ fontSize: 12, color: '#888' }}>Conversation</div>
      </div>

      <div ref={listRef} style={{ maxHeight: 320, overflow: 'auto', padding: 12, background: '#0a0a0a', borderRadius: 8, border: '1px solid #222' }}>
        {loading ? (
          <div style={{ color: '#666' }}>Loading conversation…</div>
        ) : messages.length === 0 ? (
          <div style={{ color: '#666' }}>No messages yet</div>
        ) : (
          messages.map((m: any) => (
            <div key={m.id} style={{ marginBottom: 10, display: 'flex', flexDirection: 'column', alignItems: m.senderId === sellerId ? 'flex-end' : 'flex-start' }}>
              <div style={{ maxWidth: '78%', background: m.senderId === sellerId ? '#133113' : '#111', color: '#ccc', padding: '8px 12px', borderRadius: 8, fontSize: 14 }}>
                {m.text}
              </div>
              <div style={{ fontSize: 11, color: '#555', marginTop: 4 }}>{m.senderId === sellerId ? (sellerName || 'You') : (buyerName || 'Buyer')} · {m.createdAt?.toDate ? m.createdAt.toDate().toLocaleString() : 'just now'}</div>
            </div>
          ))
        )}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <input value={text} onChange={e => setText(e.target.value)} placeholder="Write a reply..." style={{ flex: 1, padding: '10px', borderRadius: 8, border: '1px solid #333', background: '#0b0b0b', color: '#fff' }} />
        <button onClick={handleSend} style={{ background: '#adff2f', color: '#000', padding: '10px 14px', borderRadius: 8, border: 'none', fontWeight: 700 }}>Send</button>
      </div>
    </div>
  )
}
