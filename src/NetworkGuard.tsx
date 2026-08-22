import { useEffect, useRef, useState } from 'react'
import { useOnlineStatus } from './useOnlineStatus'
import OfflineScreen from './OfflineScreen'

const blue = '#3b82f6'

/**
 * Global connectivity gate:
 *  - offline  → full-screen "You're offline" troubleshooting screen (blocks the app)
 *  - reconnected → slim blue strip at the top: "You're back online" (auto-hides after 2s)
 */
function NetworkGuard() {
  const { online, refresh } = useOnlineStatus()
  const wasOfflineRef = useRef(false)
  const [showBackOnline, setShowBackOnline] = useState(false)

  // Detect the offline → online transition (ref-based so no re-render loop kills the timer)
  useEffect(() => {
    if (online) {
      if (wasOfflineRef.current) {
        wasOfflineRef.current = false
        setShowBackOnline(true)
      }
    } else {
      wasOfflineRef.current = true
      setShowBackOnline(false)
    }
  }, [online])

  // Auto-hide the strip after exactly 2 seconds
  useEffect(() => {
    if (!showBackOnline) return
    const t = window.setTimeout(() => setShowBackOnline(false), 2000)
    return () => window.clearTimeout(t)
  }, [showBackOnline])

  return (
    <>
      {!online && <OfflineScreen onRetry={refresh} />}
      {showBackOnline && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 3000,
          background: blue, color: '#fff', padding: '10px 16px',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          fontWeight: 700, fontSize: 14, textAlign: 'center',
          animation: 'rt-slideDown 0.3s ease',
        }}>
          ✅ You're back online — orders & messages are syncing
        </div>
      )}
      <style>{`
        @keyframes rt-slideDown {
          from { transform: translateY(-100%); }
          to { transform: translateY(0); }
        }
      `}</style>
    </>
  )
}

export default NetworkGuard
