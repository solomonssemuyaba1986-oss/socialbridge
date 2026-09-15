import { useState, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'

const green = '#adff2f'

type Props = {
  /** The slug from the URL, when there was one. */
  slug?: string
  /** 'missing' = the link had no store name in it; 'not-found' = we looked and found nothing. */
  reason?: 'missing' | 'not-found'
}

/**
 * Troubleshooting screen for a store link that wouldn't open.
 * A buyer should never hit a grey dead end — every path out is one tap away.
 */
function StoreProblem({ slug = '', reason = 'not-found' }: Props) {
  const navigate = useNavigate()
  const [term, setTerm] = useState('')
  const typedSlug = slug.trim()

  const runSearch = () => {
    const query = term.trim()
    if (!query) return
    navigate(`/browse?q=${encodeURIComponent(query)}`)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') runSearch()
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f0f', fontFamily: 'sans-serif', color: '#fff', display: 'flex', justifyContent: 'center', padding: '24px 16px' }}>
      <div style={{ width: '100%', maxWidth: '560px' }}>
        <div style={{ background: '#1a1a1a', border: '1px solid #262626', borderRadius: '16px', padding: '22px' }}>

          <div style={{ fontSize: '34px', marginBottom: '8px' }}>🧭</div>
          <h1 style={{ margin: '0 0 6px', fontSize: '20px', fontWeight: '800' }}>This store didn't open</h1>
          <p style={{ margin: '0 0 14px', color: '#888', fontSize: '13px', lineHeight: 1.6 }}>
            {reason === 'missing'
              ? 'The link looks incomplete — there is no shop name in it.'
              : "We looked, but there's no store on that link."}
          </p>

          {typedSlug && (
            <p style={{ margin: '0 0 18px', padding: '10px 12px', background: '#111', border: '1px solid #2a2a2a', borderRadius: '10px', color: '#888', fontSize: '12px', wordBreak: 'break-all' }}>
              You tried: <span style={{ color: '#ddd', fontWeight: 700 }}>/store/{typedSlug}</span>
            </p>
          )}

          <p style={{ margin: '0 0 8px', color: green, fontSize: '12px', fontWeight: 800, letterSpacing: '0.4px' }}>WHAT USUALLY CAUSES THIS</p>
          <ul style={{ margin: '0 0 18px', paddingLeft: '18px', color: '#aaa', fontSize: '13px', lineHeight: 1.7 }}>
            <li>The link was typed by hand or cut short when it was copied.</li>
            <li>The seller changed their shop link, or closed the store.</li>
            <li>The page opened before the connection was ready — a retry often fixes it.</li>
          </ul>

          <p style={{ margin: '0 0 10px', color: green, fontSize: '12px', fontWeight: 800, letterSpacing: '0.4px' }}>SEARCH FOR THE SHOP</p>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '18px' }}>
            <input value={term} onChange={e => setTerm(e.target.value)} onKeyDown={onKeyDown}
              placeholder="Shop name or a product, e.g. sneakers"
              style={{ flex: 1, padding: '12px', borderRadius: '10px', border: '1px solid #333', background: '#111', color: '#fff', fontSize: '14px', boxSizing: 'border-box' }} />
            <button onClick={runSearch} disabled={!term.trim()}
              style={{ padding: '12px 18px', background: term.trim() ? green : '#2a2a2a', color: term.trim() ? '#000' : '#777', border: 'none', borderRadius: '10px', fontWeight: '800', cursor: term.trim() ? 'pointer' : 'not-allowed', fontSize: '14px' }}>
              Search
            </button>
          </div>

          <p style={{ margin: '0 0 10px', color: green, fontSize: '12px', fontWeight: 800, letterSpacing: '0.4px' }}>OR GO STRAIGHT TO</p>
          <div style={{ display: 'grid', gap: '8px' }}>
            <button onClick={() => navigate('/browse')}
              style={{ width: '100%', padding: '13px', background: green, color: '#000', border: 'none', borderRadius: '10px', fontWeight: '800', cursor: 'pointer', fontSize: '14px' }}>
              🔍 Browse all stores
            </button>
            <button onClick={() => navigate('/nearby')}
              style={{ width: '100%', padding: '12px', background: '#111', color: '#ddd', border: '1px solid #333', borderRadius: '10px', fontWeight: '700', cursor: 'pointer', fontSize: '14px' }}>
              📍 Sellers near me
            </button>
            <button onClick={() => window.location.reload()}
              style={{ width: '100%', padding: '12px', background: '#111', color: '#ddd', border: '1px solid #333', borderRadius: '10px', fontWeight: '700', cursor: 'pointer', fontSize: '14px' }}>
              🔄 Try the link again
            </button>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={() => navigate('/home')}
                style={{ flex: 1, padding: '12px', background: 'transparent', color: '#888', border: '1px solid #2a2a2a', borderRadius: '10px', fontWeight: '700', cursor: 'pointer', fontSize: '13px' }}>
                🏠 Home
              </button>
              <button onClick={() => navigate('/help?topic=store')}
                style={{ flex: 1, padding: '12px', background: 'transparent', color: '#888', border: '1px solid #2a2a2a', borderRadius: '10px', fontWeight: '700', cursor: 'pointer', fontSize: '13px' }}>
                ❓ Help with this
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default StoreProblem
