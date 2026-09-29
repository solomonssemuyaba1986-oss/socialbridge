import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { auth } from './firebase'
import { useBuyerOrders } from './useBuyerOrders'
import { getMyCareTickets, type StoredCareTicket } from './careTickets'
import { CARE_SLA_HOURS, careTicketLine, type CareContext } from './care'
import {
  RETURN_LIMITS,
  RETURN_PAGE,
  RETURN_PROMISE,
  RETURN_WINDOW_DAYS,
  RETURN_WINDOW_PLAIN,
  SELLER_ANSWER_HOURS,
  returnIsOpen,
} from './returnPolicy'
import { returnContextFromOrder, returnLineForOrder, returnSos, type ReturnOrderLike } from './returnView'
import { useNow } from './useNow'
import { requireSignIn } from './signInGate'
import { trackEvent } from './analytics'
import ReturnSheet from './ReturnSheet'
import CareSheet from './CareSheet'

const green = '#adff2f'

const CARD: CSSProperties = { background: '#1a1a1a', border: '1px solid #222', borderRadius: 14, padding: 14 }
const H2: CSSProperties = { margin: '0 0 10px', fontSize: 15, fontWeight: 800 }
const MUTED: CSSProperties = { margin: 0, color: '#777', fontSize: 13, lineHeight: 1.6 }
const BTN: CSSProperties = { marginTop: 10, padding: '10px 16px', background: '#222', color: '#fff', border: '1px solid #333', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer' }
/** The one action that moves them forward: into their orders, or into an account. */
const PRIMARY: CSSProperties = { ...BTN, background: green, color: '#000', border: 'none', fontWeight: 800 }

interface CareOpen {
  context?: CareContext
  issue?: string
  note?: string
}

/**
 * ↩️ Returns & rachett care — the page a buyer opens when something went wrong.
 *
 * Two halves, and each one is a promise said out loud rather than fine print:
 *  - the **policy** (`RETURN_PROMISE` / `RETURN_LIMITS` straight out of `returnPolicy.ts`): 86 days
 *    (just under three months) from the day it was marked delivered, faults always returnable, who
 *    pays for the trip, and the two things we honestly cannot do;
 *  - the **state of play**: the returns running on this buyer's orders, and their own care tickets
 *    with the 24-hour clock on them.
 *
 * Nothing is written here — the return sheet and the care sheet do the writes, and both send what
 * the pinned policy allows and nothing else.
 */
function ReturnsPage() {
  const navigate = useNavigate()
  const now = useNow()
  const { orders, loading } = useBuyerOrders()
  const [tickets, setTickets] = useState<StoredCareTicket[]>([])
  const [ticketsLoading, setTicketsLoading] = useState(true)
  const [returnsFor, setReturnsFor] = useState<ReturnOrderLike | null>(null)
  const [careOpen, setCareOpen] = useState<CareOpen | null>(null)
  const uid = auth.currentUser?.uid || ''

  const loadTickets = useCallback(async () => {
    setTickets(await getMyCareTickets())
    setTicketsLoading(false)
  }, [])

  useEffect(() => {
    if (!uid) {
      setTickets([])
      setTicketsLoading(false)
      return
    }
    void loadTickets()
  }, [uid, loadTickets])

  /** The returns actually in flight — the only ones with a clock worth showing. */
  const openReturns = useMemo(() => orders.filter(order => returnIsOpen(order.returnState)), [orders])

  useEffect(() => {
    if (orders.length === 0) return
    trackEvent('returns_viewed', { count: orders.length, openReturns: openReturns.length })
  }, [orders.length, openReturns.length])

  /** A guest has no orders and no tickets — but the promise belongs to everybody, so only the
   *  buttons change, never the page. */
  const goSignIn = () => requireSignIn(navigate, { action: 'care', returnTo: RETURN_PAGE })

  return (
    <div className="rt-page" style={{ minHeight: '100vh', background: '#0f0f0f', fontFamily: 'sans-serif', color: '#fff', padding: '20px 16px 60px' }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <h1 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 800 }}>↩️ Returns & rachett care</h1>
        <p style={{ margin: '0 0 20px', color: '#888', fontSize: 13, lineHeight: 1.6 }}>
          Every line below is a promise, not fine print — and if one is broken, this is where you get it fixed.
        </p>

        <h2 style={H2}>Running right now</h2>
        {loading ? (
          <p style={MUTED}>Checking your orders…</p>
        ) : openReturns.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 18 }}>
            {openReturns.map(order => {
              // Past the seller's 48 hours (or refused, or never delivered) the policy hands the
              // buyer one tap straight to care — with the order, the reason and the dates on it.
              const sos = returnSos(order, now)
              return (
                <div key={order.id} style={CARD}>
                  <p style={{ margin: 0, fontWeight: 700, fontSize: 14 }}>
                    {order.productName || 'Order'}{order.orderId ? ` · ${order.orderId}` : ''}
                  </p>
                  <p style={{ margin: '4px 0 0', color: '#ffcc33', fontSize: 12, lineHeight: 1.5 }}>{returnLineForOrder(order, now)}</p>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button onClick={() => setReturnsFor(order)} style={BTN}>Open this return</button>
                    {sos && (
                      <button
                        onClick={() => setCareOpen({ context: returnContextFromOrder(order), issue: sos.issue, note: sos.note })}
                        style={{ ...BTN, background: '#241010', color: '#ff8f8f', border: '1px solid #4a1d1d' }}>
                        {sos.label} →
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div style={{ ...CARD, marginBottom: 18 }}>
            <p style={{ ...MUTED, margin: '0 0 12px' }}>
              Nothing is being returned. A return starts on the order itself — open My Orders, find the one that
              was delivered, and tap ↩️. The {RETURN_WINDOW_DAYS} days ({RETURN_WINDOW_PLAIN}) are counted from the day
              the seller marked it delivered, and that same order prints the exact date your window closes.
            </p>
            {uid ? (
              <button onClick={() => navigate('/my-orders')} style={PRIMARY}>Go to My Orders</button>
            ) : (
              <button onClick={goSignIn} style={PRIMARY}>Sign in to see my orders</button>
            )}
          </div>
        )}

        <h2 style={H2}>Your tickets</h2>
        {!uid ? (
          <p style={{ ...MUTED, marginBottom: 18 }}>
            Sign in to see what you have filed. A ticket lives in your account alone — the seller it is about
            never sees it, so nobody has to weigh the truth against keeping the peace.
          </p>
        ) : ticketsLoading ? (
          <p style={MUTED}>Loading your tickets…</p>
        ) : tickets.length === 0 ? (
          <p style={{ ...MUTED, marginBottom: 18 }}>
            Nothing filed. If something goes wrong, it takes one tap — the message is written for you from the real
            order, and a person answers within {CARE_SLA_HOURS} hours.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 18 }}>
            {tickets.map(ticket => (
              <div key={ticket.id} style={CARD}>
                <p style={{ margin: 0, fontWeight: 700, fontSize: 14 }}>{ticket.subject}</p>
                <p style={{ margin: '4px 0 0', color: '#888', fontSize: 12, lineHeight: 1.5 }}>{careTicketLine(ticket, now)}</p>
                <p style={{ margin: '4px 0 0', color: '#666', fontSize: 12 }}>
                  {ticket.orderId ? `Order ${ticket.orderId}` : 'No order attached'}{ticket.itemName ? ` · ${ticket.itemName}` : ''}
                </p>
                <p style={{ margin: '8px 0 0', color: '#ccc', fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{ticket.message}</p>
                {ticket.photoUrls.length > 0 && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                    {ticket.photoUrls.map(url => (
                      <img key={url} src={url} alt="" style={{ width: 52, height: 52, borderRadius: 8, objectFit: 'cover', border: '1px solid #333' }} />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <button onClick={() => setCareOpen({})} style={{ ...BTN, width: '100%', padding: 14, fontSize: 14 }}>
          🛡️ Something else? Tell rachett care
        </button>

        <h2 style={{ ...H2, marginTop: 26 }}>The promise</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }}>
          {RETURN_PROMISE.map(item => (
            <div key={item.title} style={CARD}>
              <p style={{ margin: 0, fontWeight: 800, fontSize: 13, lineHeight: 1.5 }}>{item.icon} {item.title}</p>
              <p style={{ margin: '6px 0 0', color: '#999', fontSize: 12, lineHeight: 1.7 }}>{item.body}</p>
            </div>
          ))}
        </div>

        <h2 style={{ ...H2, marginTop: 26 }}>What we cannot do — in the same size text</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {RETURN_LIMITS.map(item => (
            <div key={item.title} style={CARD}>
              <p style={{ margin: 0, fontWeight: 800, fontSize: 13, lineHeight: 1.5 }}>{item.icon} {item.title}</p>
              <p style={{ margin: '6px 0 0', color: '#999', fontSize: 12, lineHeight: 1.7 }}>{item.body}</p>
            </div>
          ))}
        </div>

        <p style={{ margin: '20px 0 0', color: '#555', fontSize: 12, lineHeight: 1.7 }}>
          {RETURN_WINDOW_DAYS} days ({RETURN_WINDOW_PLAIN}) from the day it was delivered — and the order itself prints
          the calendar day that closes · the seller answers in {SELLER_ANSWER_HOURS} hours ·
          a person answers a care ticket within {CARE_SLA_HOURS} hours.
        </p>
      </div>

      {returnsFor && (
        <ReturnSheet
          order={returnsFor}
          returnTo={RETURN_PAGE}
          onClose={() => setReturnsFor(null)}
        />
      )}

      {careOpen && (
        <CareSheet
          context={careOpen.context}
          returnTo={RETURN_PAGE}
          initialIssue={careOpen.issue}
          initialNote={careOpen.note}
          onClose={() => {
            setCareOpen(null)
            // A ticket that was just filed should be on the page the buyer is already looking at.
            void loadTickets()
          }}
        />
      )}
    </div>
  )
}

export default ReturnsPage

