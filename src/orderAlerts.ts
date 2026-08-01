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

/** Distinct short chime for new inbox messages (not orders). */
export function playNewMessageAlert() {
  if (document.visibilityState !== 'visible') return
  try {
    const ctx = new AudioContext()
    const playTone = (freq: number, start: number, duration: number) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(0.12, start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(start)
      osc.stop(start + duration)
    }
    const t = ctx.currentTime
    playTone(880, t, 0.12)
    playTone(1175, t + 0.14, 0.14)
    void ctx.close()
  } catch {
    // Web Audio unavailable
  }
}
