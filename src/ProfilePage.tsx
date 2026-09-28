/**
 * Your profile — the buyer's own page.
 *
 * The buyer was the one person the app never showed to themselves. It knew their name
 * (`users/{uid}.displayName`, plus the copy this phone kept), their orders, their bag and what they
 * had looked at — but every screen belonged to somebody else: a shop, an order, an inbox. Nowhere
 * said "this is you", so the fair conclusion was that nothing was kept. This is that page.
 *
 * Four rules it keeps:
 *  - **Where something lives is part of the answer.** A name saved to the account, an order a seller
 *    holds, a bag and a history that only ever existed on this phone — each is labelled with where it
 *    is, so "saved" and "kept here" are never confused for one another.
 *  - **Nothing invented.** No follower counts, no "member since", no photo we do not have. An order
 *    we cannot find is simply not in the total, and a delivery area comes from an order that has one.
 *  - **It works for a guest.** An anonymous account has no orders, so the page says what it does have
 *    (a name on this phone, a bag, a history) and offers the one step that changes that.
 *  - **Signing out belongs here.** Until now only a seller could sign out (Edit Store, the storefront);
 *    a buyer had no way to leave an account on a shared phone.
 */
import { useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { auth } from './firebase'
import { useBag } from './useBag'
import { useBuyerName } from './useBuyerName'
import { useBuyerOrders } from './useBuyerOrders'
import { nameLabel } from './buyerName'
import { summariseBuyerOrders } from './buyerOrderUtils'
import { avatarColor, initialOf } from './avatar'
import { getRememberedUser } from './userMemory'
import { useViewHistory } from './useViewHistory'
import ConfirmDialog from './ConfirmDialog'
import NameStrip from './NameStrip'

const green = '#adff2f'

/** A sign-in method in the words a person would use for it. Anything else is shown as it is. */
const PROVIDERS: Record<string, string> = {
  'google.com': 'Google',
  'facebook.com': 'Facebook',
  'apple.com': 'Apple',
  phone: 'a phone number',
}

const card: CSSProperties = {
  background: '#1a1a1a', border: '1px solid #262626', borderRadius: 16, padding: 16, marginBottom: 14,
}
const cardTitle: CSSProperties = { margin: '0 0 4px', color: '#fff', fontSize: 15, fontWeight: 800 }
const smallPrint: CSSProperties = { margin: '0 0 12px', color: '#888', fontSize: 13, lineHeight: 1.5 }
const rowButton: CSSProperties = {
  width: '100%', padding: '13px 14px', background: '#141414', border: '1px solid #262626',
  borderRadius: 12, color: '#ccc', fontWeight: 700, fontSize: 13, cursor: 'pointer', textAlign: 'left',
}

/** One number and what it is — a fact with a label, never a score. */
function Tile({ value, label, tone = '#fff' }: { value: string | number; label: string; tone?: string }) {
  return (
    <div style={{ flex: '1 1 30%', minWidth: '92px', background: '#141414', border: '1px solid #262626', borderRadius: 14, padding: '14px 8px', textAlign: 'center' }}>
      <div style={{ fontSize: 20, fontWeight: 900, color: tone }}>{value}</div>
      <div style={{ marginTop: 4, color: '#888', fontSize: 11, fontWeight: 700, lineHeight: 1.4 }}>{label}</div>
    </div>
  )
}

/** Where one kind of data is kept — the whole point of the page in a single row. */
function Where({ what, where }: { what: string; where: string }) {
  return (
    <div style={{ display: 'flex', gap: 10, padding: '9px 0', borderTop: '1px solid #1f1f1f' }}>
      <span style={{ flex: '0 0 106px', color: '#fff', fontSize: 13, fontWeight: 700 }}>{what}</span>
      <span style={{ flex: 1, color: '#888', fontSize: 13, lineHeight: 1.5 }}>{where}</span>
    </div>
  )
}

function ProfilePage() {
  const navigate = useNavigate()
  const user = auth.currentUser
  const myName = useBuyerName()
  const { count: bagCount } = useBag()
  const { orders, loading: ordersLoading } = useBuyerOrders()
  /** The two device-only lists, counted. Nothing is fetched — these are reads of this phone. */
  const browseLooks = useViewHistory('browse').count
  const nearbyLooks = useViewHistory('nearby').count

  const [editingName, setEditingName] = useState(false)
  const [confirmSignOut, setConfirmSignOut] = useState(false)

  /** Anonymous accounts are guests: they can shop, but nothing of theirs is on our servers. */
  const isGuest = !user || user.isAnonymous
  const me = myName.name
  const identity = user?.email || user?.phoneNumber || ''
  const provider = PROVIDERS[getRememberedUser()?.providerId || ''] || ''
  const summary = summariseBuyerOrders(orders)
  /** The delivery area from the most recent order that has one — read from an order, never guessed. */
  const lastArea = String(orders.find(order => String(order.deliveryArea || '').trim())?.deliveryArea || '').trim()

  const signOut = async () => {
    setConfirmSignOut(false)
    try {
      await auth.signOut()
    } catch (err) {
      console.warn('Sign out failed:', err)
    }
    // A full load, so nothing signed-in is left rendered on the way out (same as Edit Store).
    window.location.href = '/'
  }

  return (
    <div className="rt-page" style={{ minHeight: '100vh', background: '#0f0f0f', fontFamily: 'sans-serif', color: '#fff' }}>
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '20px 16px 60px' }}>

        <h1 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 800 }}>👤 Your profile</h1>
        <p style={{ margin: '0 0 18px', color: '#888', fontSize: 13 }}>
          What rachett knows about you, where it keeps it, and how to change it.
        </p>

        {/* Who we think you are */}
        <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 14 }}>
          {user?.photoURL ? (
            <img src={user.photoURL} alt="" style={{ width: 56, height: 56, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
          ) : (
            <div aria-hidden="true" style={{ width: 56, height: 56, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 900, ...avatarColor(me || identity || 'Guest') }}>
              {initialOf(me || identity || '')}
            </div>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, color: '#fff', fontSize: 17, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {me || 'No name yet'}
            </p>
            <p style={{ margin: '3px 0 0', color: '#888', fontSize: 13, lineHeight: 1.5 }}>
              {me
                ? <>Sellers see you as <strong style={{ color: green }}>{nameLabel(me)}</strong></>
                : <>Sellers see you as <strong style={{ color: '#ccc' }}>{nameLabel('')}</strong> — never the word “Buyer”.</>}
            </p>
            {identity && (
              <p style={{ margin: '3px 0 0', color: '#666', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {identity}{provider ? ` · signed in with ${provider}` : ''}
              </p>
            )}
          </div>
          <button onClick={() => setEditingName(v => !v)}
            style={{ flexShrink: 0, padding: '10px 14px', borderRadius: 10, border: `1px solid ${editingName ? '#333' : green}`, background: editingName ? 'transparent' : green, color: editingName ? '#ccc' : '#000', fontWeight: 800, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            {editingName ? 'Close' : me ? 'Change' : 'Add a name'}
          </button>
        </div>

        {editingName && (
          <NameStrip buyerName={myName} surface="profile" forceOpen onDone={() => setEditingName(false)} />
        )}

        {isGuest && (
          <div style={{ background: '#1a1a2e', border: '1px solid #3333aa', borderRadius: 14, padding: 16, marginBottom: 14 }}>
            <p style={{ margin: '0 0 4px', color: '#88aaff', fontWeight: 800, fontSize: 14 }}>
              {user ? 'You are shopping as a guest' : 'You are not signed in'}
            </p>
            <p style={smallPrint}>
              The bag, the looks and the name on this phone are all we hold — nothing of yours is on our
              servers. An account is what carries your orders, your chats and your name to your next phone.
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button onClick={() => navigate('/signin', { state: { scrollToProviders: true } })}
                style={{ padding: '11px 16px', background: green, color: '#000', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>
                Create an account
              </button>
              <button onClick={() => navigate('/signin')}
                style={{ padding: '11px 16px', background: 'transparent', color: '#ccc', border: '1px solid #333', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                Log in
              </button>
            </div>
          </div>
        )}

        {/* Real accounts only: counted from their own orders, across every shop. */}
        {!isGuest && (
          <div style={card}>
            <p style={cardTitle}>Your shopping</p>
            <p style={smallPrint}>Gathered from your own orders, from every shop, as they stand right now.</p>
            <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
              <Tile value={ordersLoading ? '…' : summary.counted} label="Orders placed" />
              <Tile value={summary.active} label="Waiting or on the way" tone="#ffcc55" />
              <Tile value={summary.delivered} label="Delivered" tone={green} />
            </div>
            <p style={{ margin: '0 0 12px', color: '#888', fontSize: 13, lineHeight: 1.6 }}>
              {summary.counted > 0
                ? <>You have committed <strong style={{ color: green }}>UGX {summary.total.toLocaleString('en-US')}</strong> across {summary.counted} {summary.counted === 1 ? 'order' : 'orders'}. Cancelled and not-available ones are not counted.</>
                : 'No orders yet. Anything you order shows up here and in My Orders.'}
              {lastArea ? <> Last delivery area: <strong style={{ color: '#ccc' }}>{lastArea}</strong>.</> : ''}
            </p>
            <button onClick={() => navigate('/my-orders')} style={rowButton}>📦 See every order →</button>
          </div>
        )}

        <div style={card}>
          <p style={cardTitle}>On this phone</p>
          <p style={smallPrint}>
            Kept in this browser and nowhere else — clearing your browser's data clears these too.
          </p>
          <div style={{ display: 'flex', gap: 10, marginBottom: 6 }}>
            <Tile value={bagCount} label="In your bag" />
            <Tile value={browseLooks} label="Looked at on Browse" />
            <Tile value={nearbyLooks} label="Looked at on Nearby" />
          </div>
          <Where what="Bag" where={bagCount > 0
            ? `${bagCount} ${bagCount === 1 ? 'item' : 'items'} waiting. Your sellers see the total for a product, never who has it.`
            : 'Empty right now.'} />
          <Where what="Looks" where="The two lists are kept apart on purpose: one answers “what was I shopping for”, the other “what is around me”. The strip sits above each page's search bar." />
          <button onClick={() => navigate('/browse')} style={{ ...rowButton, marginTop: 10 }}>🔍 Back to the market →</button>
        </div>

        <div style={card}>
          <p style={cardTitle}>What we keep, and where</p>
          <p style={smallPrint}>Every field, item by item, is listed in the project's data-collection document.</p>
          <Where what="Your name" where="On your account, and this phone remembers the last name it gave a seller so no form ever starts blank. Changing it above updates both." />
          <Where what="Orders" where="With the seller you bought from — they own the record of the sale. Your own copy of them is what My Orders gathers." />
          <Where what="Chats" where="With the seller you messaged: one thread per shop, shared by the two of you." />
          <Where what="Delivery details" where="The name, area and notes a delivery needs are kept on that order itself, so a seller can still read them next week." />
          <Where what="Bag and looks" where="This phone only. Nothing about them is written to your account." />
        </div>

        <div style={card}>
          <p style={cardTitle}>Your account</p>
          {!isGuest ? (
            <>
              <p style={smallPrint}>
                Signing out leaves the bag, the looks and the name on this phone exactly where they are.
              </p>
              <button onClick={() => setConfirmSignOut(true)}
                style={{ width: '100%', padding: '13px', background: 'transparent', color: '#ff6b6b', border: '1px solid #ff4444', borderRadius: 12, fontWeight: 800, fontSize: 14, cursor: 'pointer', marginBottom: 10 }}>
                Sign out
              </button>
            </>
          ) : (
            <p style={smallPrint}>
              There is no account to sign out of yet — the buttons above are the way in.
            </p>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={() => navigate('/help')} style={{ ...rowButton, width: 'auto', flex: '1 1 30%', textAlign: 'center' }}>❓ Help</button>
            <button onClick={() => navigate('/feedback')} style={{ ...rowButton, width: 'auto', flex: '1 1 30%', textAlign: 'center' }}>💡 Feedback</button>
            <button onClick={() => navigate('/terms')} style={{ ...rowButton, width: 'auto', flex: '1 1 30%', textAlign: 'center' }}>📄 Terms</button>
          </div>
        </div>

      </div>

      <ConfirmDialog
        open={confirmSignOut}
        title="Sign out?"
        message="You will need to log in again to see your orders and your chats. The bag, the looks and the name stay on this phone."
        confirmLabel="Sign out"
        cancelLabel="Stay signed in"
        onConfirm={() => void signOut()}
        onClose={() => setConfirmSignOut(false)}
      />
    </div>
  )
}

export default ProfilePage

