import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { auth } from './firebase'
import {
  CARE_ISSUES,
  CARE_PROMISE,
  MAX_CARE_NOTE,
  MAX_CARE_PHOTOS,
  careChecklist,
  careDraft,
  type CareContext,
} from './care'
import { RETURN_PAGE } from './returnPolicy'
import { submitCareTicket } from './careTickets'
import { uploadImageToCloudinary } from './uploadImage'
import { notify } from './notifications'
import { trackEvent } from './analytics'
import SignInPrompt from './SignInPrompt'

const green = '#adff2f'

interface CareSheetProps {
  /** The order this is about, when it is about one — every field is filled from it. */
  context?: CareContext
  /** Where to come back to after signing in. */
  returnTo: string
  /** The issue to open on, when the screen already knows (a refused return, a late seller). */
  initialIssue?: string
  /** The sentence that goes with `initialIssue`, in the buyer's own words. */
  initialNote?: string
  onClose: () => void
}

/**
 * 🛡️ A complaint, in one tap.
 *
 * The sheet is deliberately four things and no more: the promise (read before the problem is
 * typed), the issue (the buyer's own sentence), the message **already written** from the real
 * order, and the photos. Nothing here is posted into the buyer↔seller chat, and the ticket belongs
 * to its author alone — that is what lets somebody say the truth without picking a fight.
 *
 * All the words come from `care.ts` (`CARE_ISSUES`, `careDraft`, `careChecklist`) and the write from
 * `careTickets.ts`, so what the buyer reads here is exactly what lands in `careTickets/`.
 */
function CareSheet({ context, returnTo, initialIssue, initialNote, onClose }: CareSheetProps) {
  const navigate = useNavigate()
  const [issue, setIssue] = useState(initialIssue || '')
  const [note, setNote] = useState(initialNote || '')
  const [photos, setPhotos] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [needSignIn, setNeedSignIn] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const hasOrder = Boolean(context?.orderId)
  const chosen = useMemo(() => CARE_ISSUES.find(item => item.value === issue) || null, [issue])
  /** Without an order, the issues that only make sense about one are not offered at all. */
  const choices = useMemo(() => CARE_ISSUES.filter(item => !item.needsOrder || hasOrder), [hasOrder])
  const draft = chosen ? careDraft(chosen.value, context, note) : ''
  const checklist = careChecklist(issue)

  // Opening the sheet is the top of the care funnel: how many got here, and whether they had an
  // order to hang it on. (What actually landed is `care_ticket_sent`, in `careTickets`.)
  useEffect(() => {
    trackEvent('care_sheet_viewed', { hasOrder, issue: initialIssue || '' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const addPhoto = async (file: File | undefined) => {
    if (!file || uploading || photos.length >= MAX_CARE_PHOTOS) return
    setUploading(true)
    setError('')
    try {
      const url = await uploadImageToCloudinary(file)
      setPhotos(prev => [...prev, url].slice(0, MAX_CARE_PHOTOS))
      trackEvent('image_uploaded', { kind: 'care', surface: returnTo, failed: false })
    } catch (err) {
      console.error('Care photo upload failed:', err)
      trackEvent('image_uploaded', { kind: 'care', surface: returnTo, failed: true })
      setError('That photo did not upload. Try again, or send the ticket without it.')
    } finally {
      setUploading(false)
    }
  }

  const send = async () => {
    if (!chosen) {
      setError('Pick the one that sounds like what happened — the message is then written for you.')
      return
    }
    // A ticket is a record, so it needs a real account behind it (the rules read the author off
    // the document). Send them to sign in and straight back here rather than failing.
    if (!auth.currentUser) {
      setNeedSignIn(true)
      return
    }
    setSending(true)
    setError('')
    const res = await submitCareTicket({ issue: chosen.value, context, note, photoUrls: photos })
    setSending(false)
    if (res.ok) {
      setSent(true)
      return
    }
    if (res.reason === 'signin') {
      setNeedSignIn(true)
      return
    }
    setError(`${notify.somethingWentWrong} Nothing is lost — tap Send again.`)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)', zIndex: 60, overflowY: 'auto', padding: '20px 14px 40px', fontFamily: 'sans-serif' }}>
      <div style={{ maxWidth: 520, margin: '0 auto', background: '#141414', border: '1px solid #2a2a2a', borderRadius: 16, padding: 18, color: '#fff' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 800 }}>🛡️ Get help from rachett</h2>
            <p style={{ margin: '4px 0 0', color: '#888', fontSize: 12 }}>
              {hasOrder ? `About ${context?.itemName || 'your order'}${context?.orderId ? ` · ${context.orderId}` : ''}` : 'Tell us what happened.'}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close"
            style={{ background: 'transparent', border: 'none', color: '#777', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>


        {/* The promise, read *before* the problem is typed — the whole point of showing it here. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, margin: '14px 0' }}>
          {CARE_PROMISE.map(item => (
            <div key={item.title} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <span style={{ fontSize: 14 }}>{item.icon}</span>
              <p style={{ margin: 0, color: '#aaa', fontSize: 12, lineHeight: 1.5 }}>
                <strong style={{ color: '#fff' }}>{item.title}.</strong> {item.body}
              </p>
            </div>
          ))}
        </div>

        {needSignIn ? (
          <SignInPrompt
            action="care"
            returnTo={returnTo}
            onLeave={onClose}
            note="A complaint is kept in your account and read by a person — that is why it needs one."
          />
        ) : sent ? (
          <div style={{ textAlign: 'center', padding: '6px 0 2px' }}>
            <div style={{ width: 42, height: 42, borderRadius: '50%', background: green, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 10px', fontSize: 20, color: '#000', fontWeight: 800 }}>✓</div>
            <p style={{ margin: '0 0 6px', fontWeight: 800, fontSize: 15 }}>Sent — a person answers within 24 hours.</p>
            <p style={{ margin: '0 0 16px', color: '#888', fontSize: 13, lineHeight: 1.6 }}>
              Your copy is under “Your tickets”, and the seller never sees any of this. You do not need to send it again.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button onClick={() => { onClose(); navigate(RETURN_PAGE) }}
                style={{ padding: '11px 18px', background: green, color: '#000', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>
                See my tickets
              </button>
              <button onClick={onClose}
                style={{ padding: '11px 18px', background: 'transparent', color: '#ccc', border: '1px solid #333', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                Close
              </button>
            </div>
          </div>
        ) : (
          <>
            <p style={{ margin: 0, color: '#fff', fontSize: 13, fontWeight: 800 }}>What happened?</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
              {choices.map(item => {
                const active = item.value === issue
                return (
                  <button key={item.value} onClick={() => { setIssue(item.value); setError('') }}
                    style={{ textAlign: 'left', padding: '11px 12px', background: active ? '#1a2a1a' : '#1b1b1b', border: `1px solid ${active ? green : '#2a2a2a'}`, borderRadius: 10, cursor: 'pointer', color: '#fff' }}>
                    <span style={{ fontSize: 13, fontWeight: 700 }}>{item.icon} {item.label}</span>
                    <span style={{ display: 'block', color: active ? '#cfe9b0' : '#7a7a7a', fontSize: 12, marginTop: 3 }}>{item.hint}</span>
                  </button>
                )
              })}
            </div>
            {chosen && (
              <div style={{ marginTop: 16 }}>
                {checklist.length > 0 && (
                  <div style={{ background: '#101010', border: '1px solid #262626', borderRadius: 10, padding: '10px 12px', marginBottom: 12 }}>
                    <p style={{ margin: '0 0 4px', color: '#888', fontSize: 11, fontWeight: 800, letterSpacing: '0.4px' }}>WHAT HELPS</p>
                    {checklist.map(line => (
                      <p key={line} style={{ margin: '2px 0 0', color: '#bbb', fontSize: 12, lineHeight: 1.5 }}>• {line}</p>
                    ))}
                  </div>
                )}

                <p style={{ margin: '0 0 6px', color: '#888', fontSize: 11, fontWeight: 800, letterSpacing: '0.4px' }}>THIS IS WHAT WE SEND</p>
                <div style={{ background: '#0a0a0a', border: '1px solid #262626', borderRadius: 10, padding: 12, color: '#dfe6d8', fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{draft}</div>

                <p style={{ margin: '14px 0 6px', color: '#888', fontSize: 11, fontWeight: 800, letterSpacing: '0.4px' }}>
                  ANYTHING OF YOUR OWN TO ADD? ({note.length}/{MAX_CARE_NOTE})
                </p>
                <textarea value={note} maxLength={MAX_CARE_NOTE} onChange={e => setNote(e.target.value)}
                  placeholder="Optional — your own words are added to the message above, never instead of it."
                  style={{ width: '100%', minHeight: 80, padding: 12, borderRadius: 10, border: '1px solid #333', background: '#111', color: '#fff', fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }} />

                {/* Enough photos to show the problem, few enough to send from a phone. */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
                  <input ref={fileRef} type="file" accept="image/*"
                    onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; void addPhoto(file) }}
                    style={{ display: 'none' }} />
                  <button onClick={() => fileRef.current?.click()} disabled={uploading || photos.length >= MAX_CARE_PHOTOS}
                    style={{ padding: '9px 14px', background: '#222', color: '#fff', border: '1px solid #333', borderRadius: 9, fontWeight: 700, fontSize: 12, cursor: uploading ? 'wait' : 'pointer' }}>
                    {uploading ? 'Uploading…' : `📷 Add a photo (${photos.length}/${MAX_CARE_PHOTOS})`}
                  </button>
                  {photos.map(url => (
                    <img key={url} src={url} alt="" style={{ width: 44, height: 44, borderRadius: 8, objectFit: 'cover', border: '1px solid #333' }} />
                  ))}
                </div>

                {error && <p style={{ margin: '12px 0 0', color: '#ff6b6b', fontSize: 13 }}>{error}</p>}

                <button onClick={() => void send()} disabled={sending}
                  style={{ width: '100%', marginTop: 14, padding: 14, background: sending ? '#333' : green, color: sending ? '#888' : '#000', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 14, cursor: sending ? 'wait' : 'pointer' }}>
                  {sending ? 'Sending…' : 'Send to rachett care'}
                </button>
                <p style={{ margin: '8px 0 0', color: '#666', fontSize: 11, lineHeight: 1.5 }}>
                  Sent privately. The seller is never shown this, and your copy stays under “Your tickets”.
                </p>
              </div>
            )}

            {!chosen && error && <p style={{ margin: '12px 0 0', color: '#ff6b6b', fontSize: 13 }}>{error}</p>}
          </>
        )}
      </div>
    </div>
  )
}

export default CareSheet
