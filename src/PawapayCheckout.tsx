/**
 * The buyer's payment step — what happens after they tap Buy on Browse, once the order exists.
 *
 * It is a separate component on purpose: `BrowsePage` is enormous, and this is the one part of that
 * flow with its own state machine (choosing, waiting on a prompt, done, failed). Keeping it here
 * means the order form stays untouched and this can be read on its own.
 *
 * Three things it refuses to do, by design:
 *   - **never decides** whether a payment succeeded. It asks `pawapayPaymentStatus`, and the server
 *     asks pawaPay. A screen that believes itself is how money goes missing.
 *   - **never invents a price.** The amount charged is computed by the server from the order
 *     document; the number shown here is the same arithmetic — for the buyer's sake, not as a
 *     second opinion.
 *   - **never offers a rail the seller has not enabled** (read live from their own document).
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { auth, db } from './firebase'
import { doc, onSnapshot } from 'firebase/firestore'
import { COUNTRY_CODES } from './countryCodes'
import { startPawapayDeposit, checkPawapayPayment, paymentErrorMessage } from './pawapayService'
import { methodWords } from './orderPayment'

const green = '#adff2f'
const POLL_MS = 3000
const POLL_MAX_TRIES = 60 // ~3 minutes, then we stop asking — and say so rather than spin

type Rail = 'mtn' | 'airtel'
/** The stages of paying, exported because the sheet that hosts this needs to know which one we are in. */
export type Stage = 'choice' | 'waiting' | 'done' | 'failed'

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
  productName: string
  /** As it comes off the product document — a string like "40,000". */
  productPrice: string
  quantity: string
  /** The Firestore id of the order just created — the server reads the amount from it. */
  orderDocId: string
  /**
   * Which stage the payment has reached, told to whoever is showing this sheet.
   *
   * It exists because unmounting this component stops the only thing watching the buyer's deposit:
   * the sheet uses this to hold itself open while a prompt is on a phone, and to close once pawaPay
   * has settled it. Optional — a host that ignores it still gets a working payment step.
   */
  onStageChange?: (stage: Stage) => void
}

/** The seller's country gives the buyer's number its country code. Uganda, unless we know better. */
function dialFor(countryName: string): string {
  const hit = COUNTRY_CODES.find(c => c.name === countryName)
  return (hit ? hit.dialCode : '+256').replace(/\D/g, '')
}

/**
 * pawaPay wants digits, a country code and no trunk zero. Buyers type "0771…" (that is how everyone
 * here types it) and a signed-in buyer's account number arrives as "+256771…", so both must end up
 * as "256771…" — neither may be sent half-formed.
 */
function fullNumber(input: string, dial: string): string {
  const digits = String(input || '').replace(/\D/g, '')
  if (!digits) return ''
  if (digits.startsWith(dial)) return digits
  if (digits.startsWith('0')) return `${dial}${digits.replace(/^0+/, '')}`
  if (digits.length <= 10) return `${dial}${digits}`
  return digits
}

/** "40,000" → 40000. The same reading the server does, so what is shown is what is charged. */
function priceNumber(raw: unknown): number {
  const cleaned = String(raw === null || raw === undefined ? '' : raw).replace(/[^\d.]/g, '')
  const value = Number(cleaned)
  return Number.isFinite(value) ? value : 0
}

function quantityNumber(raw: unknown): number {
  const digits = String(raw === null || raw === undefined ? '' : raw).replace(/\D/g, '')
  const value = Math.floor(Number(digits) || 1)
  return Math.min(Math.max(1, value), 99)
}

export default function PawapayCheckout({
  sellerId, sellerName, productName, productPrice, quantity, orderDocId, onStageChange,
}: Props) {
  const [methods, setMethods] = useState<Methods | null>(null)
  const [country, setCountry] = useState('Uganda')
  // A buyer who signed in with a phone already gave us their number — that was the point of doing it
  // that way. Anybody else types it.
  const [phone, setPhone] = useState(() => auth.currentUser?.phoneNumber || '')
  const [rail, setRail] = useState<Rail | ''>('')
  const [stage, setStage] = useState<Stage>('choice')
  const [error, setError] = useState('')
  const [paidWith, setPaidWith] = useState('')
  const [note, setNote] = useState('')
  const pollRef = useRef<number | null>(null)
  // How many times in a row the status question has failed. A dropped question and a server that
  // cannot be asked look identical from here — three in a row means the second.
  const failedChecksRef = useRef(0)

  const qty = quantityNumber(quantity)
  const unit = priceNumber(productPrice)
  const total = unit * qty

  // What does *this* seller accept? Read live from their own document, so a rail they switch on
  // appears here at once.
  useEffect(() => {
    if (!sellerId) return
    const unsub = onSnapshot(doc(db, 'sellers', sellerId), (snap) => {
      if (!snap.exists()) { setMethods({}); return }
      const data = snap.data()
      setMethods((data.paymentMethods || {}) as Methods)
      if (typeof data.nationality === 'string' && data.nationality) setCountry(data.nationality)
    }, (err) => {
      console.warn('Could not read the payment methods:', err)
      setMethods({})
    })
    return unsub
  }, [sellerId])

  // Never leave an interval running behind a closed modal.
  useEffect(() => () => {
    if (pollRef.current !== null) window.clearInterval(pollRef.current)
  }, [])

  /**
   * Report each stage, once per change — never once per render, so a host can hold the sheet open
   * without the callback firing in a loop. The host is expected to pass a stable function.
   */
  useEffect(() => {
    if (onStageChange) onStageChange(stage)
  }, [stage, onStageChange])

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
        const check = await checkPawapayPayment({ depositId })
        failedChecksRef.current = 0
        if (check.note) setNote(check.note)
        if (check.paid) {
          stopPolling()
          setPaidWith(check.method)
          setStage('done')
          return
        }
        if (check.status === 'failed') {
          stopPolling()
          setError(check.note || 'That payment did not go through. Try again, or the seller will contact you.')
          setStage('failed')
          return
        }
      } catch (err) {
        console.warn('Payment check failed:', err)
        failedChecksRef.current += 1
        // "Waiting for your network…" is a lie when we are the ones who cannot be reached: we would
        // keep saying it for three minutes while the buyer stares at a phone that never rang.
        if (failedChecksRef.current >= 3) {
          stopPolling()
          setNote('We cannot check this payment right now. If your phone showed a charge, nothing is lost — this order updates on its own as soon as the network confirms.')
          return
        }
      }
      if (tries >= POLL_MAX_TRIES) {
        stopPolling()
        setNote('Still waiting on your network. We will update this order as soon as it lands.')
      }
    }, POLL_MS)
  }

  const handlePay = async () => {
    setError('')
    if (!rail) {
      setError('Choose MTN MoMo or Airtel Money first.')
      return
    }
    const number = fullNumber(phone, dialFor(country))
    if (number.length < 11) {
      setError('That number looks short. Type it with a leading 0, or with the country code.')
      return
    }
    if (!orderDocId) {
      setError('We could not match this to your order. Close this and open it again.')
      return
    }

    setStage('waiting')
    try {
      const started = await startPawapayDeposit(sellerId, orderDocId, number)
      if (!started.depositId) {
        setStage('failed')
        setError('That payment could not be started. Try again.')
        return
      }
      startWatching(started.depositId)
    } catch (err) {
      setStage('failed')
      setError(paymentErrorMessage(err))
    }
  }

  const railsReady = methods !== null && Boolean(methods.mtn?.enabled || methods.airtel?.enabled)

  return (
    <div style={{ textAlign: 'left' }}>
      {/* Order summary — what is being paid for, and what it adds up to. */}
      <div style={{ background: '#111', border: '1px solid #333', borderRadius: 12, padding: 12, marginBottom: 14 }}>
        <p style={{ margin: 0, color: '#888', fontSize: 11, fontWeight: 700, letterSpacing: '0.4px' }}>ORDER SUMMARY</p>
        <p style={{ margin: '6px 0 2px', color: '#fff', fontWeight: 700, fontSize: 15 }}>{productName}</p>
        <p style={{ margin: 0, color: '#888', fontSize: 13 }}>from {sellerName || 'this seller'}</p>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 10, paddingTop: 10, borderTop: '1px solid #222' }}>
          <span style={{ color: '#888', fontSize: 13 }}>{qty} × UGX {unit.toLocaleString('en-US')}</span>
          <span style={{ color: green, fontWeight: 800, fontSize: 15 }}>UGX {total.toLocaleString('en-US')}</span>
        </div>
      </div>

      {stage === 'done' ? (
        <div style={{ textAlign: 'center', padding: '6px 0' }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: green, color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px', fontSize: 26, fontWeight: 800 }}>✓</div>
          <p style={{ margin: '0 0 4px', color: '#fff', fontWeight: 800, fontSize: 17 }}>Payment confirmed ✓</p>
          <p style={{ margin: 0, color: '#888', fontSize: 13, lineHeight: 1.5 }}>
            {paidWith ? `Paid with ${methodWords(paidWith) || 'mobile money'}. ` : ''}The seller will contact you to confirm delivery.
          </p>
          {note && <p style={{ margin: '10px 0 0', color: '#ffb020', fontSize: 12, lineHeight: 1.5 }}>{note}</p>}
        </div>
      ) : stage === 'waiting' ? (
        <div style={{ textAlign: 'center', padding: '6px 0' }}>
          <div style={{ fontSize: 34, marginBottom: 8 }}>📲</div>
          <p style={{ margin: '0 0 4px', color: '#fff', fontWeight: 800, fontSize: 16 }}>Check your phone for a prompt</p>
          <p style={{ margin: 0, color: '#888', fontSize: 13, lineHeight: 1.5 }}>
            Approve UGX {total.toLocaleString('en-US')} and this updates on its own.
          </p>
          <p style={{ margin: '12px 0 0', color: '#666', fontSize: 12 }}>Waiting for your network…</p>
          {note && <p style={{ margin: '8px 0 0', color: '#666', fontSize: 12, lineHeight: 1.5 }}>{note}</p>}
        </div>
      ) : methods === null ? (
        <p style={{ color: '#666', fontSize: 13 }}>Checking how this seller gets paid…</p>
      ) : railsReady ? (
        <>
          <p style={{ margin: '0 0 8px', color: '#aaa', fontSize: 12, fontWeight: 700 }}>PAY WITH</p>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            {methods.mtn?.enabled && (
              <button type="button" onClick={() => setRail('mtn')} style={rail === 'mtn' ? railOnStyle : railOffStyle}>
                📱 MTN MoMo
              </button>
            )}
            {methods.airtel?.enabled && (
              <button type="button" onClick={() => setRail('airtel')} style={rail === 'airtel' ? railOnStyle : railOffStyle}>
                📶 Airtel Money
              </button>
            )}
          </div>

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
          <p style={{ margin: '6px 0 14px', color: '#666', fontSize: 12, lineHeight: 1.5 }}>
            {auth.currentUser?.phoneNumber
              ? 'Filled in from your account — change it if you are paying from another number.'
              : `Type it however you like — we add ${dialFor(country)} for you.`}
          </p>

          <button type="button" onClick={handlePay} style={payStyle}>
            Pay UGX {total.toLocaleString('en-US')}
          </button>

          {error && <p role="alert" style={alertStyle}>{error}</p>}
        </>
      ) : (
        <div style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 12, padding: 14 }}>
          <p style={{ margin: '0 0 4px', color: '#fff', fontWeight: 700, fontSize: 14 }}>No online payment set up yet</p>
          <p style={{ margin: 0, color: '#888', fontSize: 13, lineHeight: 1.5 }}>
            {sellerName || 'This seller'} has not turned on mobile money, so the seller will contact you
            to arrange payment and delivery.
          </p>
        </div>
      )}
    </div>
  )
}

const railBase: CSSProperties = {
  flex: 1,
  padding: '12px 10px',
  borderRadius: 10,
  fontSize: 13,
  fontWeight: 700,
  cursor: 'pointer',
  background: '#111',
  color: '#ccc',
  border: '1px solid #333',
}

const railOffStyle: CSSProperties = railBase
const railOnStyle: CSSProperties = { ...railBase, border: `1px solid ${green}`, color: green, background: '#1a2a1a' }

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
