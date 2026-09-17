import { useCallback, useEffect, useRef, useState } from 'react'

const PROBE_URL = 'https://www.gstatic.com/generate_204'
const PROBE_INTERVAL = 8000
/**
 * A flaky probe must never take the app down. Two failures used to be enough —
 * and because timers/fetches are throttled while a tab is in the background, the
 * *return* to a page was the moment the app decided you were offline.
 */
const FAILS_BEFORE_OFFLINE = 3
const PROBE_TIMEOUT_MS = 6000

async function probeReachable(): Promise<boolean> {
  try {
    // no-cors: we only need to know the request succeeded (i.e. internet exists)
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
    try {
      await fetch(PROBE_URL, { mode: 'no-cors', cache: 'no-store', signal: controller.signal })
      return true
    } finally {
      window.clearTimeout(timer)
    }
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
  const runProbeRef = useRef<() => Promise<boolean>>(async () => false)

  useEffect(() => {
    let cancelled = false

    const runProbe = async (): Promise<boolean> => {
      // Never let a background tab's throttled probe count as a failure.
      if (typeof document !== 'undefined' && document.hidden) return true
      const reachable = await probeReachable()
      if (cancelled) return reachable
      if (reachable) {
        failedRef.current = 0
        setOnline(true)
      } else {
        failedRef.current += 1
        if (failedRef.current >= FAILS_BEFORE_OFFLINE) setOnline(false)
      }
      return reachable
    }
    runProbeRef.current = runProbe

    const handleOnline = () => { failedRef.current = 0; setOnline(true) }
    const handleOffline = () => { failedRef.current = 0; setOnline(false) }
    /**
     * Coming back to a page (tab switch, phone unlock, bfcache restore) is exactly
     * when a stale "offline" flag used to greet people. Wipe the slate and verify
     * right away instead of telling them they are offline.
     */
    const handleVisible = () => {
      if (typeof document !== 'undefined' && document.hidden) return
      failedRef.current = 0
      if (navigator.onLine) setOnline(true)
      void runProbeRef.current()
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    document.addEventListener('visibilitychange', handleVisible)
    window.addEventListener('pageshow', handleVisible)
    window.addEventListener('focus', handleVisible)
    const timer = window.setInterval(runProbe, PROBE_INTERVAL)

    return () => {
      cancelled = true
      window.clearInterval(timer)
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      document.removeEventListener('visibilitychange', handleVisible)
      window.removeEventListener('pageshow', handleVisible)
      window.removeEventListener('focus', handleVisible)
    }
  }, [])

  // Forces an immediate re-check and reports whether we're reachable
  // (used by the "Try again" button on the offline screen).
  const refresh = useCallback((): Promise<boolean> => runProbeRef.current(), [])

  return { online, refresh }
}
