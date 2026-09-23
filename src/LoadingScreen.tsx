import { useEffect, useState } from 'react'
import { hasShownFullLoader, markFullLoaderShown } from './loadingGate'

const green = '#adff2f'

const LOADING_MESSAGES = [
  'Getting everything ready for you...',
  'Fetching the latest...',
  'Just a moment...',
  'Loading your content...',
  'Almost there...',
]

type Props = {
  message?: string
  variant?: 'grid' | 'rows'
  logo?: string
  /**
   * Sit inside the page (below its header) instead of taking over the whole
   * viewport — so a cold load reads as *one* page loading, not two.
   */
  inline?: boolean
}

export default function LoadingScreen({ message, variant = 'grid', logo, inline = false }: Props) {
  const [msgIndex, setMsgIndex] = useState(0)
  /**
   * Has this tab already seen the big banner? If so, a full-screen loader becomes a quiet line
   * instead — "loading once, once", rather than the whole screen flashing on every page.
   */
  const [quiet] = useState(() => !inline && hasShownFullLoader())

  useEffect(() => {
    if (!inline) markFullLoaderShown()
  }, [inline])

  useEffect(() => {
    const t = window.setInterval(() => setMsgIndex(i => (i + 1) % LOADING_MESSAGES.length), 2600)
    return () => window.clearInterval(t)
  }, [])

  if (quiet) {
    return (
      <div style={{ minHeight: '100vh', background: '#0f0f0f', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'sans-serif', color: '#999', gap: 10, padding: '20px' }}>
        <img src={logo || '/logo.jpg'} alt="" style={{ width: 28, height: 28, borderRadius: 8, objectFit: 'cover', opacity: 0.8 }} />
        <p style={{ margin: 0, fontSize: 13 }}>{message || 'Loading…'}</p>
      </div>
    )
  }

  const blockBase: React.CSSProperties = {
    borderRadius: 10,
    background: 'rgba(173,255,47,0.07)',
    animation: 'rt-shimmer 1.6s linear infinite',
  }

  return (
    <>
      <style>{`
        @keyframes rt-shimmer {
          0% { opacity: 0.45 }
          50% { opacity: 1 }
          100% { opacity: 0.45 }
        }
        @keyframes rt-progress {
          0% { width: 8% }
          55% { width: 78% }
          100% { width: 100% }
        }
      `}</style>
      <div style={{ minHeight: inline ? 0 : '100vh', background: '#0f0f0f', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily: 'sans-serif', color: '#fff', padding: inline ? '48px 20px' : '20px' }}>
        <img src={logo || '/logo.jpg'} alt="rachett" style={{ width: 64, height: 64, borderRadius: 16, objectFit: 'cover', marginBottom: 20 }} />
        <p style={{ color: '#999', fontSize: 14, margin: '0 0 16px', textAlign: 'center', minHeight: 20 }}>{message || LOADING_MESSAGES[msgIndex]}</p>

        {/* Progress bar */}
        <div style={{ width: '60%', maxWidth: 260, height: 6, borderRadius: 3, background: '#222', overflow: 'hidden' }}>
          <div style={{ height: '100%', borderRadius: 3, background: green, animation: 'rt-progress 2.4s ease-in-out infinite' }} />
        </div>

        {/* Skeleton blocks */}
        {variant === 'grid' ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 14, marginTop: 36, width: '100%', maxWidth: 460 }}>
            {[0, 1, 2, 3].map(i => (
              <div key={i} style={{ background: '#1a1a1a', border: '1px solid #222', borderRadius: 12, padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ ...blockBase, height: 96 }} />
                <div style={{ ...blockBase, height: 10, width: '75%' }} />
                <div style={{ ...blockBase, height: 10, width: '45%' }} />
              </div>
            ))}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 36, width: '100%', maxWidth: 460 }}>
            {[0, 1, 2].map(i => (
              <div key={i} style={{ background: '#1a1a1a', border: '1px solid #222', borderRadius: 12, padding: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ ...blockBase, width: 44, height: 44, borderRadius: '50%' }} />
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ ...blockBase, height: 10, width: '40%' }} />
                  <div style={{ ...blockBase, height: 10, width: '70%' }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
