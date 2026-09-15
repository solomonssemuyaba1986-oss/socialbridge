import { useNavigate } from 'react-router-dom'
import { requireSignIn, type PendingAction } from './signInGate'

const green = '#adff2f'

type Props = {
  /** What they were trying to do — decides the wording. */
  action: PendingAction
  /** Where they should land after signing in. */
  returnTo: string
  productId?: string
  sellerSlug?: string
  /** Close the sheet they're in, so the round trip returns cleanly. */
  onLeave: () => void
  /** Optional extra sentence under the heading. */
  note?: string
}

const TITLES: Record<PendingAction, string> = {
  order: 'Sign in to send your order',
  message: 'Sign in to message this seller',
  inbox: 'Sign in to open your inbox',
}

const NOTES: Record<PendingAction, string> = {
  order: 'Orders come from real accounts, so the seller knows who to deliver to and you can follow it in your Inbox.',
  message: 'Chats live in your account, so you get the seller’s reply even if you close the app.',
  inbox: 'Your chats and order updates are saved to your account.',
}

/**
 * The one place we ask a logged-out or anonymous visitor to sign in.
 * No guest shortcuts: a real account is what lets a seller reach them back.
 */
function SignInPrompt({ action, returnTo, productId, sellerSlug, onLeave, note }: Props) {
  const navigate = useNavigate()

  const go = () => {
    onLeave()
    requireSignIn(navigate, { action, returnTo, productId, sellerSlug })
  }

  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: '30px', marginBottom: '8px' }}>🔒</div>
      <p style={{ margin: '0 0 8px', fontSize: '16px', fontWeight: '800', color: '#fff' }}>{TITLES[action]}</p>
      <p style={{ margin: '0 0 18px', color: '#999', fontSize: '13px', lineHeight: 1.6 }}>
        {note || NOTES[action]}
      </p>

      <button onClick={go}
        style={{ width: '100%', padding: '14px', background: green, color: '#000', border: 'none', borderRadius: '10px', fontWeight: '800', cursor: 'pointer', fontSize: '15px', marginBottom: '10px' }}>
        Sign in or create an account →
      </button>
      <button onClick={onLeave}
        style={{ width: '100%', padding: '12px', background: 'transparent', color: '#777', border: '1px solid #2a2a2a', borderRadius: '10px', fontWeight: '700', cursor: 'pointer', fontSize: '13px' }}>
        Not now
      </button>

      <p style={{ margin: '14px 0 0', color: '#555', fontSize: '12px', lineHeight: 1.5 }}>
        It takes a few seconds — phone number, Google, Facebook or Apple.
      </p>
    </div>
  )
}

export default SignInPrompt
