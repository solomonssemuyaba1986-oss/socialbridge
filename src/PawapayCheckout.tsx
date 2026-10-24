/**
 * The buyer's payment step. It sits inside an order sheet, after the order has been written as a
 * **hidden draft** and before the seller has been told anything.
 *
 * Three promises it keeps, by design:
 *   - **never decides** whether a payment succeeded. It asks `pawapayPaymentStatus`, and the server
 *     asks pawaPay. A screen that believes itself is how money goes missing.
 *   - **never invents a price.** The server computes the charge from the order document; the lines
 *     shown here are the same arithmetic, for the buyer's sake.
 *   - **never offers a rail the seller has not enabled.** The number determines the network;
 *     `pawapayStartDeposit` predicts it and the server checks the seller's real `paymentMethods`.
 *
 * Saving the phone number is deliberately late: only after pawaPay accepts the prompt. Typing a
 * number into a box is not proof that it belongs to the buyer — a successful prompt is.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from './firebase'
import { COUNTRY_CODES } from './countryCodes'
import { checkPawapayPayment, paymentErrorMessage, startPawapayDeposit } from './pawapayService'
import { methodWords } from './orderPayment'
import { comparePaymentPhone, displayPhone, paymentPhoneHint } from './paymentPhone'
import { usePaymentPhone } from './usePaymentPhone'
import { publishCashOrder } from './orderCheckout'
import {
  orderLineTotal,
  orderLinesOf,
  orderLinesTotal,
  type OrderLine,
} from './orderLines'

const green = '#adff2f'
const POLL_MS = 3000
const POLL_MAX_TRIES = 60 // ~3 minutes, then we stop asking — and say so rather than spin

/** The stages of paying, exported because the sheet that hosts this needs to know which one we are in. */
export type Stage = 'choice' | 'waiting' | 'unknown' | 'done' | 'failed'
export type PaymentOutcome = 'paid' | 'cash'

interface MethodShape {
  enabled?: boolean
  number?: string
}

interface Methods {
  mtn?: MethodShape
  airtel?: MethodShape
}

type Props = {
  sellerId: string
  sellerName: string
  /** The order's lines. `productName` / `productPrice` / `quantity` remain as a one-line fallback. */
  items?: OrderLine[]
  productName?: string
  productPrice?: string
  quantity?: string
  /** The Firestore id of the draft order — the server reads the amount from it. */
  orderDocId: string
  /** The human reference ("RT-AB12CD"), shown for recognition only. */
  orderRef?: string
  /** Which stage the payment has reached, told to whoever is showing this sheet. */
  onStageChange?: (stage: Stage) => void
  /** Fired once when the order is actually sent — paid, or pay-on-delivery. */
  onComplete?: (outcome: PaymentOutcome) => void
}

/** The seller's country gives the buyer's number its country code. Uganda, unless we know better. */
function dialFor(countryName: string): string {
  const hit = COUNTRY_CODES.find(c => c.name === countryName)
  return (hit ? hit.dialCode : '+256').replace(/\D/g, '')
}

export default function PawapayCheckout({
  sellerId,
  sellerName,
  items,
  productName,
  productPrice,
  quantity,
  orderDocId,
  orderRef,
  onStageChange,
  onComplete,
}: Props) {
  const [methods, setMethods] = useState<Methods | null>(null)
  const [country, setCountry] = useState('Uganda')
  const [stage, setStage] = useState<Stage>('choice')
  const [outcome, setOutcome] = useState<PaymentOutcome>('paid')
  const [error, setError] = useState('')
  const [paidWith, setPaidWith] = useState('')
  const [note, setNote] = useState('')
  const [editingPhone, setEditingPhone] = useState(true)
  const [savedNotice, setSavedNotice] = useState(false)
  const [cashBusy, setCashBusy] = useState(false)
  const pollRef = useRef<number | null>(null)
  const failedChecksRef = useRef(0)
  const editTouchedRef = useRef(false)
  const completedRef = useRef(false)
  const onCompleteRef = useRef(onComplete)
  useEffect(() => {
    onCompleteRef.current = onComplete
  }, [onComplete])

  const { phone, setPhone, verifiedPhone, savedPhone, remember, forget } = usePaymentPhone()

  const lines = useMemo(() => orderLinesOf({ items, productName, productPrice, quantity }), [
    items, productName, productPrice, quantity,
  ])
  const total = orderLinesTotal(lines)
  const dial = dialFor(country)
  const check = comparePaymentPhone(phone, verifiedPhone, savedPhone, dial)
  const hasSavedCard = Boolean(savedPhone || verifiedPhone)

  // A saved or verified number is the default; the buyer can always choose Change.
  useEffect(() => {
    if (!editTouchedRef.current && hasSavedCard) setEditingPhone(false)
  }, [hasSavedCard])

  // What does *this* seller accept? Read live from their own document, so switching a rail on
  // appears here at once.
  useEffect(() => {
    if (!sellerId) return
    const unsub = onSnapshot(doc(db, 'sellers', sellerId), snap => {
      if (!snap.exists()) { setMethods({}); return }
      const data = snap.data()
      setMethods((data.paymentMethods || {}) as Methods)
      if (typeof data.nationality === 'string' && data.nationality) setCountry(data.nationality)
    }, err => {
      console.warn('Could not read the payment methods:', err)
      setMethods({})
    })
    return unsub
  }, [sellerId])

  // Never leave an interval running behind a closed modal.
  useEffect(() => () => {
    if (pollRef.current !== null) window.clearInterval(pollRef.current)
  }, [])

  /** Report each stage, once per change — never once per render. */
  useEffect(() => {
    if (onStageChange) onStageChange(stage)
  }, [stage, onStageChange])

  /** One completion per sheet: the host may clear lines or close the sheet exactly once. */
  useEffect(() => {
    if (stage !== 'done' || completedRef.current) return
    completedRef.current = true
    onCompleteRef.current?.(outcome)
  }, [stage, outcome])

  const stopPolling = () => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current)
      pollRef.current = null
    }
  }

  /**
   * Watch the deposit until pawaPay has decided. The server does the asking; this repeats the
   * question and believes the answer.
   */
  const startWatching = (depositId: string) => {
    stopPolling()
    let tries = 0
    failedChecksRef.current = 0
    pollRef.current = window.setInterval(async () => {
      tries += 1
      try {
        const checkResult = await checkPawapayPayment({ depositId })
        failedChecksRef.current = 0
        if (checkResult.note) setNote(checkResult.note)
        if (checkResult.paid) {
          stopPolling()
          setPaidWith(checkResult.method)
          setOutcome('paid')
          setStage('done')
          return
        }
        if (checkResult.status === 'failed') {
          stopPolling()
          setError(checkResult.note || 'That payment did not go through. Try again, or the seller will contact you.')
          setStage('failed')
          return
        }
      } catch (err) {
        console.warn('Payment check failed:', err)
        failedChecksRef.current += 1
        if (failedChecksRef.current >= 3) {
          stopPolling()
          setNote('We cannot check this payment right now. If your phone showed a charge, nothing is lost — this order updates on its own as soon as the network confirms.')
          // `unknown` lets the buyer close the sheet; the server still settles and publishes it.
          setStage('unknown')
          return
        }
      }
      if (tries >= POLL_MAX_TRIES) {
        stopPolling()
        setNote('Still waiting on your network. We will update this order as soon as it lands.')
        setStage('unknown')
      }
    }, POLL_MS)
  }


  const handlePay = async () => {
    setError('')
    if (!check.valid) {
      setError('That number looks short. Type it with a leading 0, or with the country code.')
      return
    }
    if (!orderDocId) {
      setError('We could not match this to your order. Close this and open it again.')
      return
    }

    setStage('waiting')
    try {
      const started = await startPawapayDeposit(sellerId, orderDocId, check.number)
      if (!started.depositId) {
        setStage('failed')
        setError('That payment could not be started. Try again.')
        return
      }
      // pawaPay has accepted the prompt: only now is this number worth keeping.
      void remember(check.number).then(() => setSavedNotice(true))
      startWatching(started.depositId)
    } catch (err) {
      setStage('failed')
      setError(paymentErrorMessage(err))
    }
  }

  /** No online rail: the order is real, and the seller knows to collect on delivery. */
  const handleCash = async () => {
    setError('')
    if (!orderDocId) {
      setError('We could not match this to your order. Close this and open it again.')
      return
    }
    setCashBusy(true)
    try {
      const result = await publishCashOrder(sellerId, orderDocId)
      setNote(result.published ? 'The seller has been notified.' : 'This order was already sent.')
      setOutcome('cash')
      setStage('done')
    } catch (err) {
      setError(paymentErrorMessage(err))
    } finally {
      setCashBusy(false)
    }
  }

  const handleChangePhone = () => {
    editTouchedRef.current = true
    setEditingPhone(true)
    setPhone('')
    setSavedNotice(false)
  }

  const handleForgetPhone = async () => {
    editTouchedRef.current = true
    await forget()
    setEditingPhone(true)
    setPhone('')
    setSavedNotice(false)
  }

  const railsReady = methods !== null && Boolean(methods.mtn?.enabled || methods.airtel?.enabled)
  const acceptedRails = methods
    ? [methods.mtn?.enabled ? 'MTN MoMo' : '', methods.airtel?.enabled ? 'Airtel Money' : ''].filter(Boolean).join(' · ')
    : ''

  return (
    <div style={{ textAlign: 'left' }}>
      {/* Order summary — every line, and what it adds up to. */}
      <div style={{ background: '#111', border: '1px solid #333', borderRadius: 12, padding: 12, marginBottom: 14 }}>
        <p style={{ margin: 0, color: '#888', fontSize: 11, fontWeight: 700, letterSpacing: '0.4px' }}>ORDER SUMMARY</p>
        <p style={{ margin: '6px 0 2px', color: '#fff', fontWeight: 700, fontSize: 15 }}>
          {sellerName || 'This seller'}
          {orderRef ? <span style={{ color: '#666', fontWeight: 600, fontSize: 12 }}> · {orderRef}</span> : null}
        </p>
        <div style={{ marginTop: 8, borderTop: '1px solid #222', paddingTop: 8 }}>
          {lines.map((line, index) => (
            <div key={`${line.productId || line.productName}-${index}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 5 }}>
              <span style={{ color: '#ddd', fontSize: 13, lineHeight: 1.4 }}>
                {line.quantity} × {line.productName}
                {(line.color || line.size) && (
                  <span style={{ color: '#777' }}> · {[line.color, line.size].filter(Boolean).join(' / ')}</span>
                )}
              </span>
              <span style={{ color: '#aaa', fontSize: 12, whiteSpace: 'nowrap' }}>UGX {orderLineTotal(line).toLocaleString('en-US')}</span>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 8, paddingTop: 8, borderTop: '1px solid #222' }}>
            <span style={{ color: '#888', fontSize: 13 }}>Total</span>
            <span style={{ color: green, fontWeight: 800, fontSize: 16 }}>UGX {total.toLocaleString('en-US')}</span>
          </div>
        </div>
      </div>


      {stage === 'done' ? (
        <div style={{ textAlign: 'center', padding: '6px 0' }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: green, color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px', fontSize: 26, fontWeight: 800 }}>✓</div>
          <p style={{ margin: '0 0 4px', color: '#fff', fontWeight: 800, fontSize: 17 }}>
            {outcome === 'paid' ? 'Paid ✓ Order sent' : 'Order sent ✓'}
          </p>
          <p style={{ margin: 0, color: '#888', fontSize: 13, lineHeight: 1.5 }}>
            {outcome === 'paid'
              ? `${paidWith ? `Paid with ${methodWords(paidWith) || 'mobile money'}. ` : ''}${sellerName || 'The seller'} has been notified and will confirm delivery.`
              : `Pay ${sellerName || 'the seller'} on delivery. They have been notified and can see your order.`}
          </p>
          {note && <p style={{ margin: '10px 0 0', color: '#ffb020', fontSize: 12, lineHeight: 1.5 }}>{note}</p>}
        </div>
      ) : stage === 'waiting' || stage === 'unknown' ? (
        <div style={{ textAlign: 'center', padding: '6px 0' }}>
          <div style={{ fontSize: 34, marginBottom: 8 }}>{stage === 'unknown' ? '⏳' : '📲'}</div>
          <p style={{ margin: '0 0 4px', color: '#fff', fontWeight: 800, fontSize: 16 }}>
            {stage === 'unknown' ? 'Still checking this payment' : 'Check your phone for a prompt'}
          </p>
          <p style={{ margin: 0, color: '#888', fontSize: 13, lineHeight: 1.5 }}>
            {stage === 'unknown'
              ? `If you approved UGX ${total.toLocaleString('en-US')}, this order will appear in your Inbox as soon as the network confirms. You can close this safely.`
              : `Approve UGX ${total.toLocaleString('en-US')} on ${displayPhone(check.number, dial) || 'your phone'} and this updates on its own.`}
          </p>
          <p style={{ margin: '12px 0 0', color: '#666', fontSize: 12 }}>{stage === 'unknown' ? 'Waiting for the network' : 'Waiting for your network…'}</p>
          {savedNotice && <p style={{ margin: '8px 0 0', color: green, fontSize: 12, fontWeight: 700 }}>Saved for next time</p>}
          {note && <p style={{ margin: '8px 0 0', color: '#666', fontSize: 12, lineHeight: 1.5 }}>{note}</p>}
        </div>
      ) : methods === null ? (
        <p style={{ color: '#666', fontSize: 13 }}>Checking how this seller gets paid…</p>
      ) : railsReady ? (
        <>
          <p style={{ margin: '0 0 6px', color: '#aaa', fontSize: 12, fontWeight: 700 }}>PAY WITH MOBILE MONEY</p>
          {acceptedRails && (
            <p style={{ margin: '0 0 10px', color: '#666', fontSize: 12 }}>
              {sellerName || 'This seller'} accepts {acceptedRails}. Your number decides which one it is.
            </p>
          )}


          {editingPhone || !hasSavedCard ? (
            <>
              <label htmlFor="buyer-momo" style={{ display: 'block', fontSize: 12, color: '#aaa', fontWeight: 700, marginBottom: 6 }}>
                Your mobile money number
              </label>
              <input
                id="buyer-momo"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="07XX XXX XXX"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                style={buyerInputStyle}
              />
              <p style={{ margin: '6px 0 4px', color: check.valid ? '#888' : '#ffb020', fontSize: 12, lineHeight: 1.5 }}>
                {paymentPhoneHint(check, dial)}
              </p>
              {hasSavedCard && (
                <button type="button" onClick={() => { editTouchedRef.current = false; setEditingPhone(false); setPhone(savedPhone || verifiedPhone) }} style={linkButtonStyle}>
                  Use the saved number instead
                </button>
              )}
            </>
          ) : (
            <div style={{ background: '#151515', border: '1px solid #333', borderRadius: 12, padding: 12, marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                <div>
                  <p style={{ margin: 0, color: '#fff', fontWeight: 800, fontSize: 15 }}>{displayPhone(phone, dial)}</p>
                  <p style={{ margin: '3px 0 0', color: check.matchesVerified ? green : '#888', fontSize: 12, fontWeight: 700 }}>
                    {check.matchesVerified ? '✓ Verified with your account' : 'Saved for next time'}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button type="button" onClick={handleChangePhone} style={smallButtonStyle}>Change</button>
                  {savedPhone && (
                    <button type="button" onClick={handleForgetPhone} style={smallButtonStyle}>Forget</button>
                  )}
                </div>
              </div>
              {check.changedFromVerified && (
                <p style={{ margin: '8px 0 0', color: '#ffb020', fontSize: 12, lineHeight: 1.5 }}>
                  This is different from your verified account number. It was saved after your network accepted it — make sure it is still yours.
                </p>
              )}
            </div>
          )}

          <button type="button" onClick={handlePay} style={payStyle}>
            {check.matchesVerified || (savedPhone && check.matchesSaved) ? 'Confirm & pay' : 'Save & pay'} · UGX {total.toLocaleString('en-US')}
          </button>
          <p style={{ margin: '8px 0 0', color: '#555', fontSize: 11, lineHeight: 1.5, textAlign: 'center' }}>
            We save your number only after your network accepts the prompt.
          </p>

          {error && <p role="alert" style={alertStyle}>{error}</p>}
        </>
      ) : (
        <div style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 12, padding: 14 }}>
          <p style={{ margin: '0 0 4px', color: '#fff', fontWeight: 700, fontSize: 14 }}>No online payment set up yet</p>
          <p style={{ margin: '0 0 12px', color: '#888', fontSize: 13, lineHeight: 1.5 }}>
            {sellerName || 'This seller'} has not turned on mobile money. Send the order and pay them on delivery.
          </p>
          <button type="button" onClick={handleCash} disabled={cashBusy} style={{ ...payStyle, opacity: cashBusy ? 0.7 : 1, cursor: cashBusy ? 'wait' : 'pointer' }}>
            {cashBusy ? 'Sending…' : 'Send order — pay on delivery'}
          </button>
          {error && <p role="alert" style={alertStyle}>{error}</p>}
        </div>
      )}
    </div>
  )
}


const buyerInputStyle: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '14px',
  borderRadius: 12,
  border: '1px solid #333',
  background: '#111',
  color: '#fff',
  fontSize: 16,
  outline: 'none',
}

const payStyle: CSSProperties = {
  width: '100%',
  padding: '15px',
  borderRadius: 12,
  border: 'none',
  background: green,
  color: '#000',
  fontWeight: 800,
  fontSize: 16,
  cursor: 'pointer',
  marginTop: 4,
}

const linkButtonStyle: CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: green,
  padding: 0,
  margin: '0 0 12px',
  fontSize: 12,
  fontWeight: 700,
  cursor: 'pointer',
}

const smallButtonStyle: CSSProperties = {
  padding: '6px 9px',
  borderRadius: 8,
  border: '1px solid #444',
  background: '#1e1e1e',
  color: '#ddd',
  fontSize: 11,
  fontWeight: 700,
  cursor: 'pointer',
}

const alertStyle: CSSProperties = {
  margin: '12px 0 0',
  padding: '10px 12px',
  borderRadius: 10,
  background: '#2a0d0d',
  border: '1px solid #f55',
  color: '#ffb3b3',
  fontSize: 13,
  lineHeight: 1.5,
}

