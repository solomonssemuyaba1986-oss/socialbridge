import { useState } from 'react'
import { collection, addDoc, serverTimestamp } from 'firebase/firestore'
import { db, auth } from './firebase'
import { useNavigate } from 'react-router-dom'

const green = '#adff2f'

const FORMSPREE_ID = (import.meta.env.VITE_FORMSPREE_ID || '').trim()

const FEEDBACK_TYPES = ['Feature Request', 'Bug Report', 'Change Request', 'Other']

function FeedbackPage() {
  const navigate = useNavigate()
  const [role, setRole] = useState<'seller' | 'buyer'>('buyer')
  const [category, setCategory] = useState(FEEDBACK_TYPES[0])
  const [message, setMessage] = useState('')
  const [name, setName] = useState('')
  const [contact, setContact] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    const text = message.trim()
    if (!text) {
      setError('Please write your feedback before sending.')
      return
    }
    setSending(true)
    setError('')

    const payload = {
      role,
      category,
      message: text,
      name: name.trim(),
      contact: contact.trim(),
      page: window.location.href,
      submittedAt: new Date().toISOString(),
      userEmail: auth.currentUser?.email || '',
    }

    let emailed = false
    if (FORMSPREE_ID) {
      try {
        const res = await fetch(`https://formspree.io/f/${FORMSPREE_ID}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(payload),
        })
        emailed = res.ok
      } catch (err) {
        console.error('Formspree error:', err)
      }
    }

    let saved = false
    if (auth.currentUser) {
      try {
        await addDoc(collection(db, 'feedback'), {
          ...payload,
          uid: auth.currentUser.uid,
          createdAt: serverTimestamp(),
        })
        saved = true
      } catch (err) {
        console.error('Feedback save error:', err)
      }
    }

    setSending(false)
    if (emailed || saved) {
      setSent(true)
    } else {
      setError('Sorry, we could not send your feedback right now. Please try again later.')
    }
  }

  if (sent) {
    return (
      <div style={{ minHeight: '100vh', background: '#0f0f0f', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '20px', fontFamily: 'sans-serif', color: '#fff', textAlign: 'center' }}>
        <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: green, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', fontSize: '28px', color: '#000', fontWeight: '800' }}>
          ✓
        </div>
        <h2 style={{ fontWeight: '800', margin: '0 0 8px', fontSize: '22px' }}>Thanks for your feedback!</h2>
        <p style={{ color: '#888', fontSize: '14px', margin: '0 0 24px', maxWidth: '340px' }}>
          The Rachett team has been notified. Every idea helps make Rachett better.
        </p>
        <button onClick={() => navigate('/browse')}
          style={{ padding: '14px 32px', background: green, color: '#000', border: 'none', borderRadius: '12px', fontWeight: '800', cursor: 'pointer', fontSize: '15px' }}>
          Back to Browsing
        </button>
      </div>
    )
  }


  return (
    <div style={{ minHeight: '100vh', background: '#0f0f0f', fontFamily: 'sans-serif', color: '#fff', padding: '20px' }}>
      <div style={{ maxWidth: '480px', margin: '0 auto' }}>
        <h1 style={{ margin: '0 0 4px', fontSize: '24px', fontWeight: '800' }}>💡 Send Feedback</h1>
        <p style={{ color: '#888', fontSize: '14px', margin: '0 0 24px' }}>
          A feature you want, a change you need, or a bug you found — tell us anything.
        </p>

        <label style={{ display: 'block', color: '#aaa', fontSize: '13px', fontWeight: '600', marginBottom: '8px' }}>
          You are a
        </label>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
          {(['seller', 'buyer'] as const).map(r => (
            <button key={r} onClick={() => setRole(r)}
              style={{ flex: 1, padding: '12px', background: role === r ? '#1a2a1a' : '#1a1a1a', color: role === r ? green : '#ddd', border: role === r ? `1px solid ${green}` : '1px solid #333', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '14px' }}>
              {r === 'seller' ? '🛍️ Seller' : '🛒 Buyer'}
            </button>
          ))}
        </div>

        <label style={{ display: 'block', color: '#aaa', fontSize: '13px', fontWeight: '600', marginBottom: '8px' }}>
          What is this about?
        </label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '20px' }}>
          {FEEDBACK_TYPES.map(t => (
            <button key={t} onClick={() => setCategory(t)}
              style={{ padding: '8px 14px', background: category === t ? '#1a2a1a' : '#1a1a1a', color: category === t ? green : '#aaa', border: category === t ? `1px solid ${green}` : '1px solid #333', borderRadius: '20px', cursor: 'pointer', fontWeight: '600', fontSize: '12px' }}>
              {t}
            </button>
          ))}
        </div>

        <label style={{ display: 'block', color: '#aaa', fontSize: '13px', fontWeight: '600', marginBottom: '8px' }}>
          Your feedback
        </label>
        <textarea placeholder="Write anything — a sentence, a feature you'd love, something that's not working..." value={message} onChange={e => setMessage(e.target.value)}
          style={{ width: '100%', minHeight: '140px', padding: '12px', borderRadius: '10px', border: '1px solid #333', boxSizing: 'border-box', fontSize: '14px', background: '#111', color: '#fff', resize: 'vertical', marginBottom: '16px' }} />

        <input placeholder="Your name (optional)" value={name} onChange={e => setName(e.target.value)}
          style={{ width: '100%', padding: '12px', borderRadius: '10px', border: '1px solid #333', boxSizing: 'border-box', fontSize: '14px', background: '#111', color: '#fff', marginBottom: '12px' }} />
        <input placeholder="Email or WhatsApp (optional, so we can reply)" value={contact} onChange={e => setContact(e.target.value)}
          style={{ width: '100%', padding: '12px', borderRadius: '10px', border: '1px solid #333', boxSizing: 'border-box', fontSize: '14px', background: '#111', color: '#fff', marginBottom: '20px' }} />

        {error && <p style={{ color: '#ff4444', fontSize: '13px', margin: '0 0 12px' }}>{error}</p>}

        <button onClick={submit} disabled={sending}
          style={{ width: '100%', padding: '14px', background: sending ? '#333' : green, color: '#000', border: 'none', borderRadius: '10px', fontWeight: '800', cursor: sending ? 'not-allowed' : 'pointer', fontSize: '15px' }}>
          {sending ? 'Sending...' : 'Send Feedback'}
        </button>
      </div>
    </div>
  )
}

export default FeedbackPage

