/**
 * The one-time "find your friends" ask, after a phone has been proved.
 *
 * The person asked for this to feel like the moment after a phone sign-up: you are in, and the
 * next useful thing is the people you already know. It is still an ask, not a condition:
 *  - it only appears on a settled screen, and only after the required age/gender card is answered;
 *  - it waits until the phone's contact picker is actually available;
 *  - it appears once per account (`users/{uid}.contactsAskedAt`, set by "Not now" or by the
 *    server when contacts are shared), and never again on another device.
 *
 * Nothing is read until the person taps **Find friends** inside the card.
 */
import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { normalizeRoute, trackEvent } from './analytics'
import { useAccountStrength } from './useAccountStrength'
import { useDemographics } from './useDemographics'
import { contactPickerAvailable } from './contactsClient'
import ContactFinder from './ContactFinder'

const green = '#adff2f'
const ALLOWED_ROUTES = ['/home', '/browse', '/profile']

export default function ContactPrompt() {
  const location = useLocation()
  const route = normalizeRoute(location.pathname)
  const account = useAccountStrength()
  const demographics = useDemographics()
  const [readyFor, setReadyFor] = useState('')
  const [open, setOpen] = useState(false)
  const [closed, setClosed] = useState(false)
  const shown = useRef(false)

  const allowed = ALLOWED_ROUTES.includes(route)
  const eligible = allowed
    && !closed
    && !account.loading
    && !demographics.loading
    && demographics.answered
    && account.strength.hasPhone
    && account.contactsDue
    && contactPickerAvailable()

  // Let the page paint first. A dialog that appears in the same frame as a sign-in is startling;
  // a second later it reads as the next step. `readyFor` is the route the timer was for, so a
  // navigation cannot inherit an old screen's readiness.
  useEffect(() => {
    if (!allowed || closed || shown.current) return
    const timer = window.setTimeout(() => setReadyFor(route), 1200)
    return () => window.clearTimeout(timer)
  }, [allowed, closed, route])

  const ready = readyFor === route

  useEffect(() => {
    if (allowed) return
    // Leave the dialog only on a settled route. The timeout keeps this out of the render pass;
    // `allowed` is also checked below, so the sheet disappears immediately on navigation.
    const timer = window.setTimeout(() => setOpen(false), 0)
    return () => window.clearTimeout(timer)
  }, [allowed])

  useEffect(() => {
    if (!ready || !eligible || shown.current) return
    shown.current = true
    setOpen(true)
    trackEvent('contacts_prompt_shown', { surface: 'prompt' })
  }, [ready, eligible])

  if (!open || !allowed) return null

  const dismiss = () => {
    setOpen(false)
    setClosed(true)
    void account.markContactsAsked()
  }

  return (
    <div
      className="rt-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="contact-prompt-title"
      onClick={dismiss}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.86)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: 12,
      }}
    >
      <div onClick={event => event.stopPropagation()} style={{
        width: '100%', maxWidth: 440, background: '#161616', border: '1px solid #2a2a2a',
        borderRadius: 18, padding: 18, color: '#fff', boxShadow: '0 18px 60px rgba(0,0,0,0.65)',
        maxHeight: '88vh', overflowY: 'auto',
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
          <div style={{ flex: 1 }}>
            <p style={{ margin: '0 0 4px', color: green, fontSize: 11, fontWeight: 900, letterSpacing: '0.5px' }}>
              YOUR PHONE IS VERIFIED
            </p>
            <h2 id="contact-prompt-title" style={{ margin: 0, fontSize: 20, fontWeight: 900 }}>
              Find your friends on rachett
            </h2>
          </div>
          <button type="button" onClick={dismiss} aria-label="Not now"
            style={{ background: 'transparent', border: 'none', color: '#777', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>
            ✕
          </button>
        </div>
        <ContactFinder surface="prompt" compact />
        <button type="button" onClick={dismiss}
          style={{
            width: '100%', marginTop: 12, padding: '11px 14px', borderRadius: 10,
            border: '1px solid #333', background: 'transparent', color: '#999',
            fontSize: 13, fontWeight: 700, cursor: 'pointer',
          }}>
          Not now
        </button>
        <p style={{ margin: '10px 0 0', color: '#555', fontSize: 11, lineHeight: 1.5, textAlign: 'center' }}>
          You can find friends any time in Rachett News &amp; Updates.
        </p>
      </div>
    </div>
  )
}
