import { useCallback, useEffect, useRef, useState } from 'react'

const PROBE_URL = 'https://www.gstatic.com/generate_204'
const PROBE_INTERVAL = 8000

async function probeReachable(): Promise<boolean> {
  try {
    // no-cors: we only need to know the request succeeded (i.e. internet exists)
    await fetch(PROBE_URL, { mode: 'no-cors', cache: 'no-store' })
    return true
  } catch {
    return false
  }
}

/**
 * Tracks real internet connectivity — not just navigator.onLine.
 * Catches both cases:
 *  1. Instant: browser 'online'/'offline' events (data cut, airplane mode, Wi-Fi off).
 *  2. Hidden: "connected to Wi-Fi but no internet" (router down, data balance out) via a
 *     periodic reachability probe. Two consecutive probe failures = genuinely offline
 *     (avoids flicker on a flaky connection).
 */
export function useOnlineStatus() {
  const [online, setOnline] = useState(() => navigator.onLine)
  const failedRef = useRef(0)
  const runProbeRef = useRef<() => void>(() => {})

  useEffect(() => {
    let cancelled = false

    const runProbe = async () => {
      const reachable = await probeReachable()
      if (cancelled) return
      if (reachable) {
        failedRef.current = 0
        setOnline(true)
      } else {
        failedRef.current += 1
        if (failedRef.current >= 2) setOnline(false)
      }
    }
    runProbeRef.current = runProbe

    const handleOnline = () => { failedRef.current = 0; setOnline(true) }
    const handleOffline = () => { failedRef.current = 0; setOnline(false) }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    const timer = window.setInterval(runProbe, PROBE_INTERVAL)

    return () => {
      cancelled = true
      window.clearInterval(timer)
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  // Forces an immediate re-check (used by the "Try again" button on the offline screen)
  const refresh = useCallback(() => { runProbeRef.current() }, [])

  return { online, refresh }
}
