import { useEffect, useRef } from 'react'
import { playNewMessageAlert } from './orderAlerts'

/** Play message chime only when unread count increases after initial baseline (avoids spurious sounds on load/navigation). */
export function useInboxMessageAlert(totalMessageUnread: number, enabled = true) {
  const prevTotal = useRef<number | null>(null)

  useEffect(() => {
    if (!enabled) return
    if (prevTotal.current === null) {
      prevTotal.current = totalMessageUnread
      return
    }
    if (totalMessageUnread > prevTotal.current) {
      playNewMessageAlert()
    }
    prevTotal.current = totalMessageUnread
  }, [totalMessageUnread, enabled])
}
