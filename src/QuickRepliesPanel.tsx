import { useState } from 'react'
import { QUICK_REPLIES, SELLER_QUICK_REPLIES } from './quickReplies'
import { useQuickReplies } from './useQuickReplies'

const green = '#adff2f'

type Props = {
  /** Sellers get the seller defaults; buyers get the buyer defaults. */
  isSeller?: boolean
  onPick: (text: string) => void
}

/** Quick replies: the user's own saved ones first, then the defaults, plus a green "add yours" button. */
function QuickRepliesPanel({ isSeller, onPick }: Props) {
  const { replies, addReply, removeReply } = useQuickReplies()
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')

  const defaults = isSeller ? SELLER_QUICK_REPLIES : QUICK_REPLIES

  const handleSave = () => {
    const clean = draft.trim()
    if (!clean) return
    addReply(clean)
    setDraft('')
    setAdding(false)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, background: '#111', border: '1px solid #222', borderRadius: 16, padding: 12 }}>
      {/* Your custom replies (delete only your own) */}
      {replies.map(r => (
        <div key={r} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button onClick={() => onPick(r)}
            style={{ flex: 1, textAlign: 'left', padding: '9px 12px', background: '#0f210f', color: '#fff', border: `1px solid ${green}`, borderRadius: 8, cursor: 'pointer', fontSize: 13, lineHeight: 1.4 }}>
            {r}
          </button>
          <button onClick={() => removeReply(r)} title="Delete"
            style={{ width: 28, height: 30, flexShrink: 0, background: 'transparent', color: '#ff6666', border: '1px solid #553333', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>✕</button>
        </div>
      ))}

      {/* Defaults (untouched) */}
      {defaults.map(q => (
        <button key={q} onClick={() => onPick(q)}
          style={{ textAlign: 'left', padding: '9px 12px', background: '#1a1a1a', color: '#ddd', border: '1px solid #2a2a2a', borderRadius: 8, cursor: 'pointer', fontSize: 13, lineHeight: 1.4 }}>
          {q}
        </button>
      ))}

      {/* Add your own — green Rachel button */}
      {adding ? (
        <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
          <input value={draft} onChange={e => setDraft(e.target.value)} autoFocus
            placeholder="Type your quick reply…"
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleSave() } }}
            style={{ flex: 1, minWidth: 0, padding: '9px 12px', background: '#0f0f0f', color: '#fff', border: `1px solid ${green}`, borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }} />
          <button onClick={handleSave} disabled={!draft.trim()}
            style={{ padding: '9px 14px', background: draft.trim() ? green : '#333', color: draft.trim() ? '#000' : '#888', border: 'none', borderRadius: 8, fontWeight: 700, cursor: draft.trim() ? 'pointer' : 'not-allowed', fontSize: 13 }}>Save</button>
          <button onClick={() => { setAdding(false); setDraft('') }}
            style={{ padding: '9px 10px', background: 'transparent', color: '#888', border: '1px solid #333', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>✕</button>
        </div>
      ) : (
        <button onClick={() => setAdding(true)}
          style={{ marginTop: 2, padding: '11px 14px', background: green, color: '#000', border: 'none', borderRadius: 8, fontWeight: 800, cursor: 'pointer', fontSize: 13, textAlign: 'center' }}>
          ＋ Add your quick reply
        </button>
      )}
    </div>
  )
}

export default QuickRepliesPanel
