import { useEffect, useState } from 'react'
import { useOnlineStatus } from './useOnlineStatus'
import OfflineScreen from './OfflineScreen'

const green = '#adff2f'

/**
 * Global connectivity gate:
 *  - offline  → full-screen "You're offline" troubleshooting screen (blocks the app)
 *  - reconnected → slim green strip at the top: "You're back online" (auto-hides)
 */
function NetworkGuard() {
  const { online, refresh } = useOnlineStatus()
  const [wasOffline, setWasOffline] = useState(false)
  const [showBackOnline, setShowBackOnline] = useState(false)

  useEffect(() => {
    if (online) {
      if (wasOffline) {
        // Just reconnected: notify once with the strip, then auto-hide
        setWasOffline(false)
        setShowBackOnline(true)
        const t = window.setTimeout(() => setShowBackOnline(false), 3500)
        return () => window.clearTimeout(t)
      }
    } else {
      setWasOffline(true)
      setShowBackOnline(false)
    }
  }, [online, wasOffline])

  return (
    <>
      {!online && <OfflineScreen onRetry={refresh} />}
      {showBackOnline && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 3000,
          background: green, color: '#000', padding: '10px 16px',
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
