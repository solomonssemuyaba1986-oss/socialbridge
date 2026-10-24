import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

const STORAGE_KEY = 'rachett_cookies_accepted'
const green = '#adff2f'

function readAccepted(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    // Storage blocked: we cannot remember the answer, so we must not keep asking either. Treat it
    // as accepted for this session and let the app carry on.
    return true
  }
}

/**
 * The first-visit cookie notice.
 *
 * Rachett uses cookies and on-device storage for staying signed in, remembering a bag, keeping a
 * search history on the phone, and measuring what is working. This is the one plain sentence that
 * says so, shown once, with the choice stored on this device. It never blocks the market: someone
 * can dismiss it by accepting, and nothing is hidden behind it.
 */
export default function CookieConsent() {
  const [answered, setAnswered] = useState(readAccepted)
  const navigate = useNavigate()
  const location = useLocation()

  if (answered) return null

  const accept = () => {
    try {
      localStorage.setItem(STORAGE_KEY, '1')
    } catch {
      // The notice still goes away for this visit; a blocked store simply cannot remember it.
    }
    setAnswered(true)
  }

  if (location.pathname === '/terms') return null

  return (
    <div
      role="dialog"
      aria-label="Cookies and on-device storage"
      className="rt-cookie-banner"
      style={{
        position: 'fixed',
        left: 12,
        right: 12,
        bottom: 12,
        zIndex: 2600,
        maxWidth: 560,
        margin: '0 auto',
        background: '#141414',
        border: `1px solid ${green}`,
        borderRadius: 14,
        padding: '14px 16px',
        boxShadow: '0 18px 50px rgba(0,0,0,0.65)',
        fontFamily: 'sans-serif',
        color: '#fff',
      }}
    >
      <p style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 800 }}>🍪 Cookies, but the useful kind</p>
      <p style={{ margin: '0 0 12px', fontSize: 12.5, lineHeight: 1.55, color: '#aaa' }}>
        Rachett keeps you signed in, remembers your bag and recent searches on this phone, and measures
        what is working. We do not sell your data. Tap accept to carry on.
      </p>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          onClick={accept}
          style={{ padding: '10px 18px', background: green, color: '#000', border: 'none', borderRadius: 10, fontWeight: 800, cursor: 'pointer', fontSize: 13 }}
        >
          Accept cookies
        </button>
        <button
          onClick={() => navigate('/terms')}
          style={{ padding: '10px 14px', background: 'transparent', color: '#aaa', border: '1px solid #333', borderRadius: 10, fontWeight: 700, cursor: 'pointer', fontSize: 12 }}
        >
          Read the terms
        </button>
      </div>
    </div>
  )
}
