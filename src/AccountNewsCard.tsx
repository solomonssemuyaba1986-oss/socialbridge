/**
 * The permanent News & Updates door on the buyer's profile.
 *
 * It says the one thing that matters at a glance — strong account, or one key missing — and
 * carries a quiet dot when the nine-day phone reminder is due. The page itself is `/news`.
 */
import { useNavigate } from 'react-router-dom'
import { useAccountStrength } from './useAccountStrength'
import { strengthLabel } from './accountStrength'

const green = '#adff2f'
const amber = '#ffcc55'

export default function AccountNewsCard() {
  const navigate = useNavigate()
  const account = useAccountStrength()
  const strength = account.strength
  const due = account.nudgeDue

  if (strength.guest) {
    return (
      <div style={{ background: '#1a1a1a', border: '1px solid #262626', borderRadius: 16, padding: 16, marginBottom: 14 }}>
        <p style={{ margin: '0 0 4px', color: '#fff', fontSize: 15, fontWeight: 800 }}>📰 Rachett News &amp; Updates</p>
        <p style={{ margin: '0 0 12px', color: '#888', fontSize: 13, lineHeight: 1.5 }}>
          Account news, safety notes and the things worth knowing. Create an account to make yours strong.
        </p>
        <button onClick={() => navigate('/news')}
          style={{ width: '100%', padding: '12px', background: '#141414', border: '1px solid #333', borderRadius: 10, color: '#ccc', fontWeight: 800, fontSize: 13, cursor: 'pointer', textAlign: 'left' }}>
          Open News &amp; Updates →
        </button>
      </div>
    )
  }

  return (
    <div style={{ background: '#1a1a1a', border: '1px solid #262626', borderRadius: 16, padding: 16, marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <p style={{ margin: 0, color: '#fff', fontSize: 15, fontWeight: 800, flex: 1 }}>📰 Rachett News &amp; Updates</p>
        {due && !strength.hasPhone && (
          <span aria-label="Account reminder" style={{
            minWidth: 9, height: 9, borderRadius: '50%', background: amber,
            boxShadow: '0 0 0 3px rgba(255,204,85,0.15)',
          }} />
        )}
      </div>
      <p style={{ margin: '4px 0 10px', color: '#888', fontSize: 13, lineHeight: 1.5 }}>
        {strength.strong
          ? 'Your account has both keys. News, safety and what is new.'
          : strength.hasPhone
            ? 'Phone verified. Add a Google email for a second way back in.'
            : 'Add a phone number to make this account easier to recover — and to sell.'}
      </p>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <span style={{
          padding: '4px 8px', borderRadius: 999, fontSize: 10, fontWeight: 900,
          background: strength.strong ? '#0f2910' : '#111', border: `1px solid ${strength.strong ? '#285a28' : '#333'}`,
          color: strength.strong ? green : '#aaa',
        }}>
          {strengthLabel(strength)}
        </span>
        {!strength.hasPhone && strength.african && (
          <span style={{ color: amber, fontSize: 11, fontWeight: 700 }}>Phone reminder</span>
        )}
      </div>
      <button onClick={() => navigate('/news')}
        style={{ width: '100%', padding: '12px', background: '#141414', border: '1px solid #333', borderRadius: 10, color: green, fontWeight: 800, fontSize: 13, cursor: 'pointer', textAlign: 'left' }}>
        Open News &amp; Updates →
      </button>
    </div>
  )
}
