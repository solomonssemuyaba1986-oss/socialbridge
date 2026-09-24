import { useNavigate } from 'react-router-dom'

const green = '#adff2f'

/**
 * Any URL we don't have a route for used to render nothing at all — just the
 * top nav floating over an empty page, which reads as "the app is broken".
 * Now it says so, and offers the one thing people want next: the market.
 */
function NotFound() {
  const navigate = useNavigate()

  return (
    <div className="rt-page" style={{ minHeight: '100vh', background: '#0f0f0f', fontFamily: 'sans-serif', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <div style={{ background: '#1a1a1a', border: '1px solid #222', borderRadius: '16px', padding: '32px 24px', maxWidth: '420px', width: '100%', textAlign: 'center' }}>
        <div style={{ fontSize: '40px', marginBottom: '10px' }}>🧭</div>
        <h1 style={{ margin: '0 0 8px', fontSize: '20px', fontWeight: '800' }}>This page doesn't exist</h1>
        <p style={{ margin: '0 0 24px', color: '#888', fontSize: '14px', lineHeight: 1.55 }}>
          The link may be old or mistyped. The market is right here though.
        </p>

        <button onClick={() => navigate('/browse')}
          style={{ width: '100%', padding: '14px', background: green, color: '#000', border: 'none', borderRadius: '10px', fontWeight: '800', cursor: 'pointer', fontSize: '15px', marginBottom: '10px' }}>
          🔍 Browse the market
        </button>
        <button onClick={() => navigate('/home')}
          style={{ width: '100%', padding: '12px', background: 'transparent', color: '#aaa', border: '1px solid #333', borderRadius: '10px', fontWeight: '700', cursor: 'pointer', fontSize: '14px' }}>
          Take me home
        </button>
      </div>
    </div>
  )
}

export default NotFound
