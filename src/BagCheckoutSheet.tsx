import { useMemo, useRef, useState } from 'react'
import { auth } from './firebase'
import { useBuyerName } from './useBuyerName'
import { nameLabel } from './buyerName'
import { createCheckoutOrder } from './createBuyerOrder'
import PawapayCheckout, { type PaymentOutcome, type Stage } from './PawapayCheckout'
import { groupBagForCheckout, shopCheckoutWords, type BagCheckoutItem, type ShopCheckout } from './bagCheckout'
import { combineOrderLines, type OrderLine } from './orderLines'
import { detectSource } from './tracking'
import { trackEvent } from './analytics'
import { green } from './productCardUtils'

type Props = {
  /** The lines this checkout was opened for. Held lines are excluded unless `includeHeld`. */
  items: BagCheckoutItem[]
  /** Products that no longer exist or cannot be bought. */
  missingProducts?: Record<string, boolean>
  /** "Buy Now" on one held row is explicit, so that one line may be included. */
  includeHeld?: boolean
  title?: string
  onClose: () => void
  /** Remove the lines that were just paid for or sent on delivery. */
  onPaidLines: (productIds: string[]) => void
}

interface ShopPaid {
  sellerId: string
  name: string
  total: number
  outcome: PaymentOutcome
}

interface Draft {
  sellerId: string
  shopName: string
  orderDocId: string
  orderRef: string
  lines: OrderLine[]
  total: number
  itemCount: number
}

function linesForCheckout(group: ShopCheckout): OrderLine[] {
  return group.lines.map(line => ({
    ...(line.productId ? { productId: line.productId } : {}),
    productName: line.productName,
    productPrice: line.productPrice,
    quantity: line.quantity,
    ...(line.imageUrl ? { productImage: line.imageUrl } : {}),
    ...(line.color ? { color: line.color } : {}),
    ...(line.size ? { size: line.size } : {}),
  }))
}

/**
 * The bag's checkout — one payment per shop, because one pawaPay deposit belongs to one seller.
 *
 * A draft order is written for the current shop only when the buyer actually starts paying. The
 * seller hears nothing until the money lands (or the buyer chooses pay-on-delivery), and the lines
 * that were paid leave the bag only after the server has published that order. Held lines stay.
 */
export default function BagCheckoutSheet({
  items,
  missingProducts,
  includeHeld,
  title = 'Pay & send order',
  onClose,
  onPaidLines,
}: Props) {
  const myName = useBuyerName()
  const [buyerName, setBuyerName] = useState('')
  const [deliveryArea, setDeliveryArea] = useState('')
  const [buyerNote, setBuyerNote] = useState('')
  const [step, setStep] = useState<'details' | 'pay' | 'between' | 'done'>('details')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [payStage, setPayStage] = useState<Stage | null>(null)
  const [paid, setPaid] = useState<ShopPaid[]>([])
  const [lastPaid, setLastPaid] = useState<ShopPaid | null>(null)
  const [error, setError] = useState('')
  const [starting, setStarting] = useState(false)
  const completedRef = useRef('')

  const summary = useMemo(
    () => groupBagForCheckout(items, { unavailable: missingProducts, includeHeld }),
    [items, missingProducts, includeHeld],
  )
  // The number of shops this checkout opened with, not the number left after paid lines leave.
  const [shopTotal] = useState(summary.shopCount)
  const remaining = summary.groups.filter(group => !paid.some(entry => entry.sellerId === group.sellerId))
  const current = remaining[0] || null
  const shopNumber = Math.min(shopTotal, paid.length + 1)
  const shownName = buyerName.trim() || myName.name

  const requestClose = () => {
    if (payStage === 'waiting') return
    onClose()
  }

  const startPayment = async () => {
    setError('')
    if (!auth.currentUser) {
      setError('Sign in to pay for your bag.')
      return
    }
    if (!shownName.trim()) {
      setError('Add your name so the seller knows who is buying.')
      return
    }
    if (!deliveryArea.trim()) {
      setError('Add a delivery area so the seller knows where to send it.')
      return
    }
    if (!current) {
      setError('There is nothing ready to pay in this bag.')
      return
    }

    void myName.rememberIfNew(shownName, 'checkout')
    setStarting(true)
    try {
      const lines = linesForCheckout(current)
      if (lines.length === 0) {
        setError('There is nothing ready to pay in this bag.')
        return
      }
      const combined = combineOrderLines(lines)
      const { orderRef, orderId } = await createCheckoutOrder(current.sellerId, {
        buyerName: shownName.trim(),
        buyerUid: auth.currentUser.uid,
        productName: combined.productName,
        productPrice: combined.productPrice,
        quantity: combined.quantity,
        ...(combined.productId ? { productId: combined.productId } : {}),
        ...(combined.productImage ? { productImage: combined.productImage } : {}),
        deliveryArea: deliveryArea.trim(),
        items: lines,
        ...(buyerNote.trim() ? { buyerNote: buyerNote.trim() } : {}),
        sourcePlatform: detectSource(),
        createdAt: new Date(),
      })
      setDraft({
        sellerId: current.sellerId,
        shopName: current.businessName,
        orderDocId: orderRef.id,
        orderRef: orderId,
        lines,
        total: current.total,
        itemCount: current.itemCount,
      })
      setPayStage('choice')
      setStep('pay')
    } catch (err) {
      console.error('Could not start the bag payment:', err)
      setError('That did not go through. Check your connection and try again.')
    } finally {
      setStarting(false)
    }
  }

  const handleComplete = (outcome: PaymentOutcome) => {
    if (!draft || completedRef.current === draft.orderDocId) return
    completedRef.current = draft.orderDocId
    const done: ShopPaid = {
      sellerId: draft.sellerId,
      name: draft.shopName,
      total: draft.total,
      outcome,
    }
    trackEvent('order_placed', {
      productId: draft.lines[0]?.productId,
      sellerId: draft.sellerId,
      price: String(draft.total),
      quantity: String(draft.itemCount),
      bagSize: items.length,
      channel: detectSource(),
      surface: 'bag',
    })
    onPaidLines(draft.lines.map(line => line.productId).filter((id): id is string => Boolean(id)))
    setPaid(prev => [...prev, done])
    setLastPaid(done)
    setDraft(null)
    setPayStage(null)
    setStep('between')
  }

  return (
    <div
      className="rt-modal-overlay"
      onClick={requestClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.88)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, overflowY: 'auto' }}
    >
      <div
        onClick={event => event.stopPropagation()}
        style={{ background: '#1a1a1a', borderRadius: 16, padding: 24, width: '100%', maxWidth: 430, border: '1px solid #2a2a2a', textAlign: 'left', maxHeight: '92vh', overflowY: 'auto' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
          <div>
            <h3 style={{ margin: 0, color: '#fff', fontSize: 18, fontWeight: 800 }}>{title}</h3>
            <p style={{ margin: '4px 0 0', color: '#777', fontSize: 12 }}>
              {shopTotal > 1 ? `${shopTotal} shops · one payment per shop` : 'One payment, one order'}
            </p>
          </div>
          <button type="button" onClick={requestClose} style={{ background: 'transparent', border: 'none', color: '#777', fontSize: 20, cursor: payStage === 'waiting' ? 'default' : 'pointer', padding: 0 }}>✕</button>
        </div>

        {step === 'details' && (
          <>
            <div style={{ background: '#111', border: '1px solid #2a2a2a', borderRadius: 12, padding: 12, marginBottom: 14 }}>
              {summary.groups.map((group, index) => (
                <div key={group.sellerId} style={{ padding: '8px 0', borderTop: index === 0 ? 'none' : '1px solid #222' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                    <span style={{ color: '#fff', fontSize: 13, fontWeight: 800 }}>🏪 {group.businessName}</span>
                    <span style={{ color: green, fontSize: 13, fontWeight: 800, whiteSpace: 'nowrap' }}>UGX {group.total.toLocaleString('en-US')}</span>
                  </div>
                  <p style={{ margin: '3px 0 0', color: '#777', fontSize: 12 }}>{shopCheckoutWords(group)}</p>
                  <p style={{ margin: '2px 0 0', color: '#555', fontSize: 11 }}>
                    {group.lines.map(line => `${line.quantity} × ${line.productName}`).join(' · ')}
                  </p>
                </div>
              ))}
              {summary.groups.length === 0 && (
                <p style={{ margin: 0, color: '#888', fontSize: 13 }}>
                  Nothing is ready to pay. Resume a held item, or add something to your bag.
                </p>
              )}
            </div>

            {(summary.heldCount > 0 || summary.unavailableCount > 0) && (
              <p style={{ margin: '0 0 12px', color: '#856404', background: '#241f0c', border: '1px solid #4a3d12', borderRadius: 10, padding: 9, fontSize: 12, lineHeight: 1.5 }}>
                {summary.heldCount > 0 ? `${summary.heldCount} held item${summary.heldCount === 1 ? '' : 's'} (UGX ${summary.heldTotal.toLocaleString('en-US')}) will stay in your bag. ` : ''}
                {summary.unavailableCount > 0 ? `${summary.unavailableCount} unavailable line${summary.unavailableCount === 1 ? '' : 's'} cannot be bought.` : ''}
              </p>
            )}

            <input placeholder="Your name" value={shownName} onChange={event => setBuyerName(event.target.value)} style={inputStyle} />
            <p style={{ margin: '0 0 12px', color: '#777', fontSize: 12 }}>
              Sellers see you as <strong style={{ color: green }}>{nameLabel(shownName)}</strong>
            </p>
            <input placeholder="Delivery area e.g. Nakawa, Kampala" value={deliveryArea} onChange={event => setDeliveryArea(event.target.value)} style={inputStyle} />
            <textarea placeholder="Anything the seller should know? (optional)" value={buyerNote} onChange={event => setBuyerNote(event.target.value)} style={{ ...inputStyle, minHeight: 72, resize: 'vertical' }} />

            {error && <p role="alert" style={alertStyle}>{error}</p>}

            <button
              type="button"
              onClick={startPayment}
              disabled={starting || summary.groups.length === 0}
              style={{ ...primaryStyle, opacity: starting || summary.groups.length === 0 ? 0.6 : 1, cursor: starting || summary.groups.length === 0 ? 'not-allowed' : 'pointer' }}
            >
              {summary.groups.length === 0
                ? 'Nothing ready to pay'
                : shopTotal > 1
                  ? `Pay shop ${shopNumber} of ${shopTotal} · UGX ${(current?.total || summary.readyTotal).toLocaleString('en-US')}`
                  : `Pay & send order · UGX ${summary.readyTotal.toLocaleString('en-US')}`}
            </button>
            <p style={{ margin: '8px 0 0', color: '#555', fontSize: 11, lineHeight: 1.5, textAlign: 'center' }}>
              The seller is only told once this shop's payment succeeds.
            </p>
          </>
        )}


        {step === 'pay' && draft && (
          <>
            <p style={{ margin: '0 0 10px', color: '#888', fontSize: 12 }}>
              Shop {shopNumber} of {shopTotal} · {draft.shopName} · {draft.orderRef}
            </p>
            <PawapayCheckout
              sellerId={draft.sellerId}
              sellerName={draft.shopName}
              items={draft.lines}
              orderDocId={draft.orderDocId}
              orderRef={draft.orderRef}
              onStageChange={setPayStage}
              onComplete={handleComplete}
            />
            <button
              type="button"
              onClick={requestClose}
              style={{ ...secondaryStyle, cursor: payStage === 'waiting' ? 'default' : 'pointer' }}
            >
              {payStage === 'waiting' ? 'Waiting for your phone — keep this open' : 'Close'}
            </button>
          </>
        )}

        {step === 'between' && (
          <>
            {lastPaid && (
              <div style={{ background: '#12210d', border: '1px solid #2f4a1a', borderRadius: 12, padding: 14, marginBottom: 14 }}>
                <p style={{ margin: 0, color: green, fontWeight: 800, fontSize: 15 }}>
                  {lastPaid.outcome === 'paid' ? 'Paid ✓' : 'Sent ✓'} {lastPaid.name}
                </p>
                <p style={{ margin: '4px 0 0', color: '#9ab', fontSize: 12 }}>
                  UGX {lastPaid.total.toLocaleString('en-US')} · {lastPaid.outcome === 'paid' ? 'the seller has been notified' : 'pay on delivery'}
                </p>
              </div>
            )}
            {current ? (
              <>
                <p style={{ margin: '0 0 4px', color: '#fff', fontWeight: 800, fontSize: 16 }}>Next: {current.businessName}</p>
                <p style={{ margin: '0 0 12px', color: '#888', fontSize: 13 }}>{shopCheckoutWords(current)}</p>
                {error && <p role="alert" style={alertStyle}>{error}</p>}
                <button type="button" onClick={startPayment} disabled={starting} style={{ ...primaryStyle, opacity: starting ? 0.6 : 1 }}>
                  {starting ? 'Opening…' : `Pay shop ${shopNumber} of ${shopTotal} · UGX ${current.total.toLocaleString('en-US')}`}
                </button>
                <button type="button" onClick={requestClose} style={secondaryStyle}>Later — keep the rest in my bag</button>
              </>
            ) : (
              <>
                <p style={{ margin: '0 0 14px', color: '#ddd', fontSize: 13 }}>Every shop in this checkout has been sent. The receipts are in your Inbox.</p>
                <button type="button" onClick={requestClose} style={primaryStyle}>Done</button>
              </>
            )}
          </>
        )}

        {step === 'done' && (
          <>
            <p style={{ margin: '0 0 12px', color: green, fontWeight: 800, fontSize: 16 }}>All done ✓</p>
            {paid.map(entry => (
              <p key={entry.sellerId} style={{ margin: '0 0 6px', color: '#ddd', fontSize: 13 }}>
                {entry.name} · UGX {entry.total.toLocaleString('en-US')}
              </p>
            ))}
            <button type="button" onClick={requestClose} style={primaryStyle}>Done</button>
          </>
        )}
      </div>
    </div>
  )
}

const inputStyle = {
  width: '100%',
  boxSizing: 'border-box' as const,
  padding: 12,
  borderRadius: 10,
  border: '1px solid #333',
  background: '#111',
  color: '#fff',
  fontSize: 14,
  marginBottom: 10,
}

const primaryStyle = {
  width: '100%',
  padding: 14,
  borderRadius: 10,
  border: 'none',
  background: green,
  color: '#000',
  fontWeight: 800,
  fontSize: 15,
  cursor: 'pointer',
  marginTop: 4,
}

const secondaryStyle = {
  width: '100%',
  padding: 12,
  borderRadius: 10,
  border: '1px solid #333',
  background: 'transparent',
  color: '#888',
  fontWeight: 700,
  fontSize: 13,
  cursor: 'pointer',
  marginTop: 10,
}

const alertStyle = {
  margin: '4px 0 10px',
  padding: '9px 11px',
  borderRadius: 10,
  background: '#2a0d0d',
  border: '1px solid #f55',
  color: '#ffb3b3',
  fontSize: 12,
  lineHeight: 1.5,
}

