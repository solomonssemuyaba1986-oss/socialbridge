/**
 * Listening for the SMS code, so a person does not have to leave the app to read it.
 *
 * The WebOTP API (Chrome on Android, and some Chromium builds) can hand a page the code from an
 * origin-bound text message. The message must end with a line such as `@rachett.com #123456`;
 * `api/_lib/sms.js` writes that line, and this file is the browser half.
 *
 * Everything here is optional by design. iOS Safari, Firefox, an insecure page, a denied
 * permission, a closed prompt, and a text that never arrives all fall back to the input the
 * screen already has. No exception reaches a screen, and no code is logged or stored anywhere
 * except the field that asked for it.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

/** The server issues six digits (`api/_lib/otp.js`), so anything else is not our code. */
export const SMS_OTP_LENGTH = 6

/** Stop waiting when the code itself has expired on the server. */
const WAIT_MS = 5 * 60 * 1000

type OtpCredential = { code?: unknown }

type OtpCredentialRequest = CredentialRequestOptions & {
  otp: { transport: string[] }
}

type CredentialGetter = {
  get(options: OtpCredentialRequest): Promise<Credential | null>
}

/** Pure: the six digits in a credential, or '' for anything else. */
export function readSmsOtpCode(value: unknown): string {
  if (!value || typeof value !== 'object') return ''
  const code = (value as OtpCredential).code
  if (typeof code !== 'string') return ''
  const digits = code.replace(/\D/g, '')
  return digits.length === SMS_OTP_LENGTH ? digits : ''
}

/** Chrome Android is the only common browser with this; a secure page is required. */
export function smsOtpSupported(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false
  if (!window.isSecureContext) return false
  return 'OTPCredential' in window && typeof navigator.credentials?.get === 'function'
}

/**
 * Wait for the next text message bound to this site. Resolves to '' for every ordinary fallback:
 * unsupported, permission denied, the prompt closed, an abort, or no message in time.
 */
export async function listenForSmsOtp(signal?: AbortSignal): Promise<string> {
  if (!smsOtpSupported() || signal?.aborted) return ''
  const credentials = navigator.credentials as unknown as CredentialGetter
  try {
    const credential = await credentials.get({
      otp: { transport: ['sms'] },
      ...(signal ? { signal } : {}),
    })
    return readSmsOtpCode(credential)
  } catch {
    // A denial is a normal answer. The input below is still ready for the code.
    return ''
  }
}

export type SmsOtpStatus = 'idle' | 'listening' | 'filled' | 'fallback'

/** One sentence under the input. It never contains a code. */
export function smsOtpHint(supported: boolean, status: SmsOtpStatus): string {
  if (!supported) return 'Type the code from your messages; some keyboards offer it above the keys.'
  if (status === 'filled') return 'Code filled from your text message.'
  if (status === 'fallback') return 'Type the code from your messages. We will keep the screen ready.'
  if (status === 'listening') return 'Keep this screen open; we will fill in the code when your text arrives.'
  return 'Type the code from your messages.'
}

export type SmsOtpListener = {
  supported: boolean
  status: SmsOtpStatus
  hint: string
  /** Call from the tap that asks the server for a code, before awaiting the send. */
  listen: () => void
  /** Stop waiting: the send failed, or the person changed their mind. */
  stop: () => void
}

export function useSmsOtpListener(onCode: (code: string) => void): SmsOtpListener {
  const [supported] = useState(smsOtpSupported)
  const [status, setStatus] = useState<SmsOtpStatus>('idle')
  const callback = useRef(onCode)
  const control = useRef<AbortController | null>(null)
  const timer = useRef<number | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    callback.current = onCode
  }, [onCode])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (timer.current !== null) window.clearTimeout(timer.current)
      timer.current = null
      control.current?.abort()
      control.current = null
    }
  }, [])

  const stop = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
    control.current?.abort()
    control.current = null
    if (mounted.current) setStatus('idle')
  }, [])

  const listen = useCallback(() => {
    if (!supported || !mounted.current) return
    // A resend replaces the previous wait: one pending credential request at a time.
    if (timer.current !== null) window.clearTimeout(timer.current)
    control.current?.abort()
    const next = new AbortController()
    control.current = next
    setStatus('listening')
    timer.current = window.setTimeout(() => {
      if (!mounted.current || control.current !== next) return
      control.current = null
      timer.current = null
      next.abort()
      setStatus('fallback')
    }, WAIT_MS)
    void listenForSmsOtp(next.signal).then(code => {
      if (!mounted.current || control.current !== next) return
      if (timer.current !== null) window.clearTimeout(timer.current)
      timer.current = null
      control.current = null
      if (code) {
        callback.current(code)
        setStatus('filled')
      } else {
        setStatus('fallback')
      }
    })
  }, [supported])

  return { supported, status, hint: smsOtpHint(supported, status), listen, stop }
}
