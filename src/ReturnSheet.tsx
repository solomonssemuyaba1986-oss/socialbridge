import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { doc, getDoc, updateDoc } from 'firebase/firestore'
import { db, auth } from './firebase'
import {
  BUYER_RETURN_STATES,
  MAX_RETURN_NOTE,
  RETURN_PAGE,
  RETURN_REASONS,
  buyerReturnPatch,
  canOpenReturn,
  isReturnable,
  returnIsOpen,
  returnOpeningLine,
  returnPatch,
  returnStateWords,
  returnReason as reasonWords,
  sellerAnswerWords,
  whoPaysReturn,
  type BuyerReturnState,
} from './returnPolicy'
import {
  orderMs,
  returnContextFromOrder,
  returnSos,
  returnableFromOrder,
  type ReturnOrderLike,
  type ReturnSos,
} from './returnView'
import { sendConversationMessage } from './useConversation'
import { uploadImageToCloudinary } from './uploadImage'
import { trackEvent } from './analytics'
import { useNow } from './useNow'
import CareSheet from './CareSheet'
import ConfirmDialog from './ConfirmDialog'
import SignInPrompt from './SignInPrompt'

const green = '#adff2f'

/** The colours a return state is drawn in — the same tones `returnStateWords` speaks in. */
const TONES: Record<'waiting' | 'good' | 'bad' | 'done', { bg: string; fg: string; border: string }> = {
  waiting: { bg: '#241f0c', fg: '#ffcc33', border: '#4a3d12' },
  good: { bg: '#12210d', fg: green, border: '#2f4a1a' },
  bad: { bg: '#241010', fg: '#ff6b6b', border: '#4a1d1d' },
  done: { bg: '#1a1a1a', fg: '#888', border: '#333' },
}

interface ReturnSheetProps {
  /** The order, as the buyer sees it — the document id is what a return is written to. */
  order: ReturnOrderLike
  /** The shop's name, so a photo sent to the chat arrives with the story on it. */
  shopName?: string
  /** Where to come back to after signing in. */
  returnTo: string
  onClose: () => void
}

/**
 * ↩️ One order's return, from "where does it stand" to "it is on its way to rachett care".
 *
 * Every rule is `returnPolicy.ts`': the seven days counted from the day the seller marked it
 * delivered, who pays for the trip back, what can go back at all, and the seller's 48 hours to
 * answer. This file writes none of that — it asks, and it sends what the policy says may be sent.
 *
 * Two things are worth knowing about the write:
 *  - the rules accept **only** the buyer's six return fields, and only while no seller decision is
 *    standing (`returnState` still one of `''`, `requested`, `photos_sent`, `canceled`). So once the
 *    seller has asked for a photo or approved it, a photo goes into the chat and no field moves;
 *  - the patch is built by `returnPatch`/`buyerReturnPatch` from `returnPolicy`, and no timestamp of
 *    ours is written with it — the client's clock is not evidence.
 */
function ReturnSheet({ order, shopName = '', returnTo, onClose }: ReturnSheetProps) {
  const navigate = useNavigate()
  const now = useNow()
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState('')
  const [asCare, setAsCare] = useState<ReturnSos | null>(null)
  const [confirmWithdraw, setConfirmWithdraw] = useState(false)
  const [needSignIn, setNeedSignIn] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const state = order.returnState || ''
  const words = returnStateWords(state, 'buyer')
  const tone = TONES[words?.tone || 'waiting']
  const returnable = returnableFromOrder(order)
  const gate = canOpenReturn(returnable, now)
  const opening = returnOpeningLine(returnable, now)
  const context = returnContextFromOrder(order, shopName)
  const sos = returnSos(order, now)
  const chosen = reason ? reasonWords(reason) : null
  const pay = reason ? whoPaysReturn(reason) : null
  const allowed = chosen ? isReturnable({ category: order.category, subCategory: order.subCategory, reason: chosen.value }) : null
  /**
   * The rules hand the buyer's six fields back to the *seller* the moment a decision exists, so the
   * buyer may only write while nothing has been decided (or the last word was their own).
   */
  const buyerMayWrite = state === '' || BUYER_RETURN_STATES.includes(state as BuyerReturnState)
  /** A live return of the buyer's own to take back — `canceled` is already taken back. */
  const canWithdraw = state === 'requested' || state === 'photos_sent'
  /** A request already went out once: the rules write that moment once, so the clock cannot restart. */
  const storedRequest = orderMs(order.returnRequestedAt) > 0
  const clock = returnIsOpen(state) ? sellerAnswerWords(orderMs(order.returnRequestedAt), now) : null
  const canSendPhoto = Boolean(auth.currentUser && order.sellerId)

  /**
   * A photo sent from here goes into the buyer↔seller chat, so the chat has to arrive with the
   * shop's real name on it. The orders list already knows it and passes it in; `/returns` does not
   * load shops, so the sheet fetches the one it needs rather than writing a nameless thread.
   */
  const [shop, setShop] = useState(shopName)
  useEffect(() => {
    if (shopName || !order.sellerId) return
    let cancelled = false
    getDoc(doc(db, 'sellers', order.sellerId))
      .then(snap => {
        if (!cancelled) setShop((snap.data()?.businessName as string) || '')
      })
      .catch(() => { /* a name is nice to have, never worth an error */ })
    return () => { cancelled = true }
  }, [shopName, order.sellerId])

  // The top of the return funnel: how many reach the sheet, and how many are told no by the policy
  // (the window, a missing delivery date, or a decision the seller already made).
  useEffect(() => {
    trackEvent('return_sheet_viewed', { orderId: context.orderId, canOpen: gate.ok })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])


  /** The order document a return is written to — the path the rules look the buyer up on. */
  const orderPath = { sellerId: order.sellerId || '', id: order.id || '' }
  const addressable = Boolean(orderPath.sellerId && orderPath.id)

  const startReturn = async () => {
    if (!auth.currentUser) {
      setNeedSignIn(true)
      return
    }
    if (!chosen || !allowed?.ok) return
    if (!addressable) {
      setError('We could not tell which order this is. Open it from My Orders and try again.')
      return
    }
    setBusy('start')
    setError('')
    try {
      // Re-opening a return that was withdrawn: the rules take the request time **once** — the
      // 48-hour clock cannot be restarted — so the same moment goes back and the seller's clock
      // picks up where it left off. That is what "start it again while the 7 days last" means.
      const storedAt = orderMs(order.returnRequestedAt)
      const patch: Record<string, unknown> = {
        ...returnPatch({ reason: chosen.value, note, nowMs: storedAt || Date.now() }),
      }
      await updateDoc(doc(db, 'sellers', orderPath.sellerId, 'orders', orderPath.id), patch)
      trackEvent('return_requested', { orderId: context.orderId, reason: chosen.value, fault: pay?.value || 'seller' })
      setDone('Sent. The seller has 48 hours to answer — their answer lands on this order, and you will see it here.')
    } catch (err) {
      console.error('Return request failed:', err)
      setError('Your return did not go through. Check your connection and tap again — nothing was sent.')
    } finally {
      setBusy('')
    }
  }

  /** The two states that are the buyer's to set: the photo is with the seller, or it is withdrawn. */
  const markMine = async (next: BuyerReturnState, message: string) => {
    if (!addressable) return
    setBusy(next)
    setError('')
    try {
      const patch: Record<string, unknown> = { ...buyerReturnPatch(next, Date.now(), note) }
      await updateDoc(doc(db, 'sellers', orderPath.sellerId, 'orders', orderPath.id), patch)
      trackEvent('return_updated', { orderId: context.orderId, state: next })
      setDone(message)
    } catch (err) {
      console.error('Return update failed:', err)
      setError('That did not go through — try again in a moment.')
    } finally {
      setBusy('')
    }
  }

  /**
   * A photo goes into the chat — the one place the seller is already looking — and only then does
   * the state follow it. Once the seller has answered (`photos_needed`, `approved`) the rules stop
   * the buyer's fields from moving at all, so the photo travels alone and nothing is claimed.
   */
  const sendPhoto = async (file: File | undefined) => {
    const user = auth.currentUser
    if (!file || !user || !order.sellerId) return
    setBusy('photo')
    setError('')
    try {
      const url = await uploadImageToCloudinary(file)
      trackEvent('image_uploaded', { kind: 'return', surface: returnTo, failed: false })
      await sendConversationMessage(
        order.sellerId,
        user.uid,
        user.uid,
        `Return photo — ${order.productName || 'my order'}${order.orderId ? ` (${order.orderId})` : ''}`,
        shop || 'the seller',
        order.buyerName || 'Buyer',
        { imageUrl: url },
      )
      if (state === 'requested') {
        await markMine('photos_sent', 'Photo sent to the seller. The clock is still running — their answer lands on this order.')
        return
      }
      setDone('Photo sent to the seller in your chat. Nothing else to do — their answer lands on this order.')
    } catch (err) {
      console.error('Return photo failed:', err)
      trackEvent('image_uploaded', { kind: 'return', surface: returnTo, failed: true })
      setError('That photo did not send. Try again — or send it in the chat with the seller.')
    } finally {
      setBusy('')
    }
  }

  /** Said before the form, not after a refusal: the seller's clock is not ours to reset. */
  const clockCannotRestart = 'You sent this return once already — sending it again does not restart the seller’s 48 hours.'
  const dim = !chosen || !allowed?.ok

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)', zIndex: 55, overflowY: 'auto', padding: '20px 14px 40px', fontFamily: 'sans-serif' }}>
        <div style={{ maxWidth: 520, margin: '0 auto', background: '#141414', border: '1px solid #2a2a2a', borderRadius: 16, padding: 18, color: '#fff' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 800 }}>↩️ Return or get help</h2>
              <p style={{ margin: '4px 0 0', color: '#888', fontSize: 12 }}>
                {order.productName || 'This order'}
                {order.orderId ? ` · ${order.orderId}` : ''}
                {shop ? ` · ${shop}` : ''}
              </p>
            </div>
            <button onClick={onClose} aria-label="Close"
              style={{ background: 'transparent', border: 'none', color: '#777', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>×</button>
          </div>

          {needSignIn ? (
            <div style={{ marginTop: 14 }}>
              <SignInPrompt
                action="care"
                returnTo={returnTo}
                onLeave={onClose}
                note="A return is written onto your own order, so it needs an account — we bring you straight back here."
              />
            </div>
          ) : done ? (
            <div style={{ textAlign: 'center', padding: '16px 0 2px' }}>
              <div style={{ width: 42, height: 42, borderRadius: '50%', background: green, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 10px', fontSize: 20, color: '#000', fontWeight: 800 }}>✓</div>
              <p style={{ margin: '0 0 14px', color: '#ccc', fontSize: 13, lineHeight: 1.6 }}>{done}</p>
              <button onClick={onClose}
                style={{ padding: '12px 20px', background: green, color: '#000', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 14, cursor: 'pointer' }}>
                Close
              </button>
            </div>
          ) : (
            <>
              {/* Where it stands — running or decided, in the buyer's words, never "in progress". */}
              {words && (
                <div style={{ marginTop: 14, background: tone.bg, border: `1px solid ${tone.border}`, borderRadius: 12, padding: 12 }}>
                  <p style={{ margin: 0, color: tone.fg, fontWeight: 800, fontSize: 13 }}>{words.icon} {words.text}</p>
                  <p style={{ margin: '4px 0 0', color: '#ccc', fontSize: 12, lineHeight: 1.5 }}>{words.note}</p>
                  {order.returnNote && (
                    <p style={{ margin: '6px 0 0', color: '#fff', fontSize: 12, lineHeight: 1.5 }}>“{order.returnNote}”</p>
                  )}
                  {clock?.text && (
                    <p style={{ margin: '6px 0 0', color: clock.late ? '#ff6b6b' : '#888', fontSize: 12, lineHeight: 1.5 }}>{clock.text}</p>
                  )}
                </div>
              )}

              <p style={{ margin: '14px 0 0', color: gate.ok ? green : '#ffcc33', fontSize: 13, lineHeight: 1.6 }}>{opening}</p>

              {gate.ok && (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
                    {RETURN_REASONS.map(item => {
                      const active = item.value === reason
                      return (
                        <button key={item.value} onClick={() => { setReason(item.value); setError('') }}
                          style={{ textAlign: 'left', padding: '11px 12px', background: active ? '#1a2a1a' : '#1b1b1b', border: `1px solid ${active ? green : '#2a2a2a'}`, borderRadius: 10, cursor: 'pointer', color: '#fff' }}>
                          <span style={{ fontSize: 13, fontWeight: 700 }}>{item.label}</span>
                          <span style={{ display: 'block', color: active ? '#cfe9b0' : '#7a7a7a', fontSize: 12, marginTop: 3 }}>{item.hint}</span>
                        </button>
                      )
                    })}
                  </div>

                  {pay && (
                    <div style={{ marginTop: 12, background: '#101010', border: '1px solid #262626', borderRadius: 10, padding: 12 }}>
                      <p style={{ margin: 0, color: pay.value === 'buyer' ? '#ffcc33' : green, fontSize: 11, fontWeight: 800, letterSpacing: '0.4px' }}>WHO PAYS FOR THE TRIP BACK</p>
                      <p style={{ margin: '4px 0 0', color: '#bbb', fontSize: 12, lineHeight: 1.5 }}>{pay.text}</p>
                    </div>
                  )}

                  {allowed && !allowed.ok && (
                    <p style={{ margin: '12px 0 0', color: '#ffcc33', fontSize: 12, lineHeight: 1.6 }}>{allowed.text}</p>
                  )}

                  <p style={{ margin: '14px 0 6px', color: '#888', fontSize: 11, fontWeight: 800, letterSpacing: '0.4px' }}>
                    ANYTHING ELSE THE SELLER SHOULD KNOW? ({note.length}/{MAX_RETURN_NOTE})
                  </p>
                  <textarea value={note} maxLength={MAX_RETURN_NOTE} onChange={e => setNote(e.target.value)}
                    placeholder="The seller reads this first — one line is enough."
                    style={{ width: '100%', minHeight: 76, padding: 12, borderRadius: 10, border: '1px solid #333', background: '#111', color: '#fff', fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }} />

                  {storedRequest && (
                    <p style={{ margin: '8px 0 0', color: '#888', fontSize: 12, lineHeight: 1.5 }}>{clockCannotRestart}</p>
                  )}

                  <button onClick={() => void startReturn()} disabled={dim || busy !== ''}
                    style={{ width: '100%', marginTop: 14, padding: 14, background: dim ? '#333' : green, color: dim ? '#888' : '#000', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 14, cursor: busy ? 'wait' : 'pointer' }}>
                    {busy === 'start' ? 'Sending…' : 'Send the return to the seller'}
                  </button>
                </>
              )}

              {/* While a return is live, the two things left are evidence and giving up on it. */}
              {(returnIsOpen(state) || canWithdraw) && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
                  <input ref={fileRef} type="file" accept="image/*"
                    onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; void sendPhoto(file) }}
                    style={{ display: 'none' }} />
                  {canSendPhoto && (
                    <>
                      <button onClick={() => fileRef.current?.click()} disabled={busy !== ''}
                        style={{ padding: '11px 14px', background: '#222', color: '#fff', border: '1px solid #333', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: busy ? 'wait' : 'pointer' }}>
                        {busy === 'photo' ? 'Sending the photo…' : '📷 Send a photo to the seller'}
                      </button>
                      {returnIsOpen(state) && (
                        <p style={{ margin: 0, color: '#666', fontSize: 11, lineHeight: 1.6 }}>
                          {buyerMayWrite
                            ? 'The photo lands in your chat with the seller, and this order shows that you sent one.'
                            : 'The seller has already answered, so the photo simply goes into your chat — there is nothing left for you to change here.'}
                        </p>
                      )}
                    </>
                  )}
                  {canWithdraw && (
                    <button onClick={() => setConfirmWithdraw(true)} disabled={busy !== ''}
                      style={{ padding: '11px 14px', background: 'transparent', color: '#ccc', border: '1px solid #333', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: busy ? 'wait' : 'pointer' }}>
                      ↩️ Withdraw this return
                    </button>
                  )}
                </div>
              )}

              {error && <p style={{ margin: '12px 0 0', color: '#ff6b6b', fontSize: 13, lineHeight: 1.5 }}>{error}</p>}

              {sos && (
                <button onClick={() => setAsCare(sos)}
                  style={{ width: '100%', marginTop: 12, padding: 13, background: '#241010', color: '#ff8f8f', border: '1px solid #4a1d1d', borderRadius: 10, fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>
                  {sos.label} →
                </button>
              )}

              <button onClick={() => { onClose(); navigate(RETURN_PAGE) }}
                style={{ width: '100%', marginTop: 8, padding: 11, background: 'transparent', color: '#888', border: '1px solid #262626', borderRadius: 10, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                📄 Read the whole policy, in plain words
              </button>
            </>
          )}
        </div>
      </div>

      {/* The ticket opens *over* the return, so closing it lands the buyer exactly where they were. */}
      {asCare && (
        <CareSheet
          context={context}
          returnTo={returnTo}
          initialIssue={asCare.issue}
          initialNote={asCare.note}
          onClose={() => setAsCare(null)}
        />
      )}

      <ConfirmDialog
        open={confirmWithdraw}
        title="Withdraw this return?"
        message="The order stands as it is, and the seller stops holding it. You can start it again while the 7 days last."
        confirmLabel="Withdraw it"
        cancelLabel="Keep it running"
        onConfirm={() => {
          setConfirmWithdraw(false)
          void markMine('canceled', 'Return withdrawn. The order stands — you can start it again while the 7 days last.')
        }}
        onClose={() => setConfirmWithdraw(false)}
      />
    </>
  )
}

export default ReturnSheet

