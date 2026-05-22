const SKIP_KEY = 'rachett_skip_next_order_alert'

/** Call when the seller places an order on their own store (testing) — avoids alert on their device. */
export function suppressNextSellerOrderAlert() {
  sessionStorage.setItem(SKIP_KEY, '1')
}

function shouldSkipAlert(): boolean {
  if (sessionStorage.getItem(SKIP_KEY)) {
    sessionStorage.removeItem(SKIP_KEY)
    return true
  }
  return false
}

/** Play only when this browser tab is open and visible (seller dashboard/inbox). */
export function playNewOrderAlert() {
  if (shouldSkipAlert()) return
  if (document.visibilityState !== 'visible') return
  try {
    const audio = new Audio('/notification.mp3')
    audio.volume = 0.7
    void audio.play().catch(() => {})
  } catch {
    // missing file or autoplay blocked
  }
}
