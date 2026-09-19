import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { auth } from './firebase'
import { normalizeRoute, trackEvent } from './analytics'
import { getRole } from './role'
import {
  FEEDBACK_CATEGORIES,
  countVisitedPage,
  feedbackMemoryStore,
  feedbackVisitStore,
  markAsked,
  markDone,
  pushFeedbackMemoryToAccount,
  readFeedbackMemory,
  readFeedbackMemoryFromAccount,
  readFeedbackVisit,
  shouldAskFeedback,
  submitFeedback,
  writeFeedbackMemory,
  type FeedbackCategory,
} from './feedback'

/** Nothing appears until somebody has actually been using the app for a bit. */
const WAIT_MS = 45_000
/** Where it may appear — browsing surfaces only, never mid-checkout or on a sign-in screen. */
const ALLOWED_ROUTES = ['/browse', '/nearby', '/home', '/bag', '/my-orders']

/**
 * "What didn't you like about rachett?" — the after-use ask.
 *
 * A small card, not a popup: it never blocks what someone is doing, it waits until they have
 * looked around, and it goes quiet for a week the moment they tap Later. Answer it and it
 * leaves them alone for three months — remembered on this device **and** on their account, so
 * a second phone doesn't ask the same person twice.
 */
export default function FeedbackNudge() {
  const location = useLocation()
  const navigate = useNavigate()
  const [visible, setVisible] = useState(false)
  const [actions, setActions] = useState(0)
  const [message, setMessage] = useState('')
  const [category, setCategory] = useState<FeedbackCategory>('Change Request')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  const route = useMemo(() => normalizeRoute(location.pathname), [location.pathname])
  const routeRef = useRef(route)

  // The account copy, once: a phone we have never seen must not re-ask the same question.
  useEffect(() => {
    if (!auth.currentUser?.uid) return
    let cancelled = false
    readFeedbackMemoryFromAccount()
      .then(account => {
        if (cancelled || (!account.askedAt && !account.doneAt)) return
        const local = readFeedbackMemory(feedbackMemoryStore())
        writeFeedbackMemory(feedbackMemoryStore(), {
          askedAt: Math.max(local.askedAt, account.askedAt),
          doneAt: Math.max(local.doneAt, account.doneAt),
        })
      })
      .catch(() => { /* offline — the device copy still works */ })
    return () => { cancelled = true }
  }, [])

  // Note the page they are on — the count is what "they've used it" means.
  useEffect(() => {
    routeRef.current = route
    countVisitedPage(feedbackVisitStore(), route)
  }, [route])

  // One timer for the visit, so a fidgety navigator doesn't keep resetting it.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!ALLOWED_ROUTES.includes(routeRef.current)) return
      const pages = readFeedbackVisit(feedbackVisitStore()).pages.length
      const memory = readFeedbackMemory(feedbackMemoryStore())
      if (!shouldAskFeedback({ actions: pages, askedAt: memory.askedAt, doneAt: memory.doneAt })) return
      setActions(pages)
      setVisible(true)
      markAsked(feedbackMemoryStore())
      void pushFeedbackMemoryToAccount({ feedbackAskedAt: Date.now() })
      trackEvent('feedback_prompt_shown', { actions: pages })
    }, WAIT_MS)
    return () => window.clearTimeout(timer)
  }, [])

  const dismiss = () => {
    setVisible(false)
    trackEvent('feedback_prompt_dismissed', { actions })
  }

  const send = async () => {
    if (!message.trim()) {
      setError('A sentence is enough — what got in your way?')
      return
    }
    setSending(true)
    setError('')
    const ok = await submitFeedback({
      role: getRole() === 'seller' ? 'seller' : 'buyer',
      category,
      message,
      source: 'prompt',
    })
    setSending(false)
    if (!ok) {
      setError("Couldn't send that. Try again, or use the full form.")
      return
    }
    setSent(true)
    markDone(feedbackMemoryStore())
    void pushFeedbackMemoryToAccount({ feedbackDoneAt: Date.now() })
    window.setTimeout(() => setVisible(false), 4500)
  }

  if (!visible) return null

  return (
    <div style={{ position: 'fixed', left: 12, right: 12, bottom: 88, zIndex: 90, maxWidth: 460, margin: '0 auto', fontFamily: 'sans-serif' }}>
      <div style={{ background: '#161616', border: '1px solid #2a2a2a', borderRadius: 16, padding: 16, boxShadow: '0 12px 40px rgba(0,0,0,0.55)', color: '#fff' }}>
        {sent ? (
          <p style={{ margin: 0, fontSize: 14, color: '#adff2f', fontWeight: 700 }}>
            ✓ Thank you — a person reads every single one.
          </p>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
              <p style={{ margin: 0, flex: 1, fontSize: 15, fontWeight: 800, lineHeight: 1.35 }}>
                What didn't you like about rachett?
              </p>
              <button onClick={dismiss} aria-label="Not now" title="Not now"
                style={{ background: 'transparent', border: 'none', color: '#666', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 0 }}>
                ✕
              </button>
            </div>

            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
              {FEEDBACK_CATEGORIES.map(c => (
                <button key={c.value} onClick={() => setCategory(c.value)}
                  style={{ padding: '6px 12px', borderRadius: 999, border: `1px solid ${category === c.value ? '#adff2f' : '#333'}`, background: category === c.value ? '#1a2a1a' : '#1a1a1a', color: category === c.value ? '#adff2f' : '#bbb', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                  {c.label}
                </button>
              ))}
            </div>

            <textarea value={message} onChange={e => setMessage(e.target.value)}
              placeholder="One sentence is enough — what got in your way?"
              style={{ width: '100%', minHeight: 72, padding: 12, borderRadius: 10, border: '1px solid #333', boxSizing: 'border-box', fontSize: 14, background: '#111', color: '#fff', resize: 'vertical', marginBottom: 10 }} />

            {error && <p style={{ color: '#ff6b6b', fontSize: 12, margin: '0 0 8px' }}>{error}</p>}

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <button onClick={send} disabled={sending}
                style={{ padding: '10px 18px', background: sending ? '#333' : '#adff2f', color: sending ? '#888' : '#000', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 14, cursor: sending ? 'not-allowed' : 'pointer' }}>
                {sending ? 'Sending…' : 'Send'}
              </button>
              <button onClick={dismiss}
                style={{ padding: '10px 14px', background: 'transparent', color: '#888', border: '1px solid #333', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                Later
              </button>
              <button onClick={() => { dismiss(); navigate('/feedback') }}
                style={{ background: 'transparent', border: 'none', color: '#666', fontSize: 12, cursor: 'pointer', textDecoration: 'underline', padding: 0 }}>
                tell us more →
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
