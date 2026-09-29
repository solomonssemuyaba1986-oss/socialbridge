import { useEffect, useState } from 'react'

/**
 * A clock for the screens that show a promise running out — the seller's 48 hours to answer a
 * return, the buyer's seven days to send one back, rachett care's 24.
 *
 * The screens are already on screen for minutes at a time, and a countdown that never moves is the
 * fastest way to make a promise look decorative. Once a minute is enough for a clock measured in
 * hours, and it is cheap enough to leave running.
 */
export function useNow(intervalMs = 60000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(timer)
  }, [intervalMs])
  return now
}
