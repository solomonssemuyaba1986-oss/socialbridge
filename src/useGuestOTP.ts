import { useState, useCallback, useRef } from 'react'

const OTP_SERVER_URL = import.meta.env.VITE_OTP_SERVER_URL || 'http://localhost:3001'

interface OTPState {
  step: 'idle' | 'phone' | 'otp' | 'verified' | 'error'
  phone: string
  error: string
  loading: boolean
}

interface VerifiedGuest {
  phone: string
  name: string
  verifiedAt: number
}

/**
 * Hook for guest OTP verification flow.
 * 
 * Usage:
 *   const { state, requestOTP, verifyOTP, reset, verifiedGuest } = useGuestOTP()
 */
export function useGuestOTP() {
  const [state, setState] = useState<OTPState>({
    step: 'idle',
    phone: '',
    error: '',
    loading: false,
  })

  const verifiedGuestRef = useRef<VerifiedGuest | null>(null)

  /**
   * Step 1: Send OTP to the given phone number
   */
  const requestOTP = useCallback(async (phone: string) => {
    // Validate Uganda phone number
    const cleaned = phone.replace(/\s+/g, '')
    if (!/^\+256\d{9}$/.test(cleaned) && !/^0\d{9}$/.test(cleaned)) {
      setState(prev => ({ ...prev, step: 'error', error: 'Enter a valid Uganda number (e.g. +256771234567 or 0771234567)' }))
      return false
    }

    // Normalize to +256 format
    const normalized = cleaned.startsWith('0') ? `+256${cleaned.slice(1)}` : cleaned

    setState({ step: 'phone', phone: normalized, error: '', loading: true })

    try {
      const res = await fetch(`${OTP_SERVER_URL}/api/otp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: normalized }),
      })

      const data = await res.json()

      if (!res.ok) {
        setState(prev => ({ ...prev, loading: false, step: 'error', error: data.error || 'Failed to send OTP' }))
        return false
      }

      // In sandbox mode, log the debug OTP
      if (data.debugOtp) {
        console.log(`[OTP Debug] Code for ${normalized}: ${data.debugOtp}`)
      }

      setState({ step: 'otp', phone: normalized, error: '', loading: false })
      return true
    } catch (err) {
      console.error('[OTP] Request error:', err)
      setState(prev => ({ ...prev, loading: false, step: 'error', error: 'Network error. Check your connection.' }))
      return false
    }
  }, [])

  /**
   * Step 2: Verify the OTP code
   */
  const verifyOTP = useCallback(async (otp: string, guestName: string) => {
    if (!state.phone) {
      setState(prev => ({ ...prev, error: 'No phone number. Start again.' }))
      return false
    }

    setState(prev => ({ ...prev, loading: true, error: '' }))

    try {
      const res = await fetch(`${OTP_SERVER_URL}/api/otp/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: state.phone, otp }),
      })

      const data = await res.json()

      if (!res.ok) {
        setState(prev => ({ ...prev, loading: false, step: 'error', error: data.error || 'Invalid code' }))
        return false
      }

      // Save verified guest info
      verifiedGuestRef.current = {
        phone: state.phone,
        name: guestName,
        verifiedAt: Date.now(),
      }

      // Save to localStorage so returning guests don't re-verify
      try {
        localStorage.setItem('rachett_verified_guest', JSON.stringify(verifiedGuestRef.current))
      } catch { /* ignore */ }

      setState({ step: 'verified', phone: state.phone, error: '', loading: false })
      return true
    } catch (err) {
      console.error('[OTP] Verify error:', err)
      setState(prev => ({ ...prev, loading: false, step: 'error', error: 'Network error. Try again.' }))
      return false
    }
  }, [state.phone])

  /**
   * Check if there's a previously verified guest in localStorage
   */
  const getSavedGuest = useCallback((): VerifiedGuest | null => {
    try {
      const raw = localStorage.getItem('rachett_verified_guest')
      if (raw) {
        const guest = JSON.parse(raw) as VerifiedGuest
        verifiedGuestRef.current = guest
        return guest
      }
    } catch { /* ignore */ }
    return null
  }, [])

  /**
   * Reset the OTP flow
   */
  const reset = useCallback(() => {
    setState({ step: 'idle', phone: '', error: '', loading: false })
  }, [])

  /**
   * Clear saved guest data
   */
  const clearGuest = useCallback(() => {
    localStorage.removeItem('rachett_verified_guest')
    verifiedGuestRef.current = null
    reset()
  }, [reset])

  return {
    state,
    requestOTP,
    verifyOTP,
    getSavedGuest,
    reset,
    clearGuest,
    verifiedGuest: verifiedGuestRef.current,
  }
}

export type { VerifiedGuest, OTPState }
