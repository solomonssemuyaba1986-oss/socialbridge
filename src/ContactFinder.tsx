/**
 * "Find your friends" — the consent screen and the result, in one place.
 *
 * It is deliberately a button, never an automatic upload. The browser opens the phone's own
 * contact picker; the person chooses what to share. The selected numbers go to the server once,
 * are converted to the same one-way keys the phone ledger uses, and are forgotten. What comes
 * back is a short list of people already on rachett — a name and a shop link, never a number.
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { auth } from './firebase'
import { trackEvent } from './analytics'
import {
  contactPickerAvailable,
  defaultDialFor,
  findContacts,
  pickContactPhones,
  type ContactMatch,
} from './contactsClient'

const green = '#adff2f'

type Props = {
  surface: 'news' | 'prompt'
  onMatched?: (count: number) => void
  compact?: boolean
}

function Avatar({ name }: { name: string }) {
  const initial = (name.trim().charAt(0) || 'R').toUpperCase()
  return (
    <span aria-hidden="true" style={{
      width: 36, height: 36, borderRadius: '50%', background: '#0f2910', color: green,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontWeight: 900, fontSize: 15, flexShrink: 0,
    }}>{initial}</span>
  )
}

export default function ContactFinder({ surface, onMatched, compact }: Props) {
  const navigate = useNavigate()
  const supported = contactPickerAvailable()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [matches, setMatches] = useState<ContactMatch[] | null>(null)
  const [checked, setChecked] = useState(0)
  const [shared, setShared] = useState(false)

  const look = async () => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const picked = await pickContactPhones()
      if (!picked.ok) {
        if (!picked.cancelled) setError(picked.error)
        else setNotice(picked.error)
        return
      }
      if (picked.phones.length === 0) {
        setNotice('No numbers were selected, so nothing was sent.')
        return
      }
      const user = auth.currentUser
      if (!user) {
        setError('Please sign in again to find your friends.')
        return
      }
      const result = await findContacts(
        picked.phones,
        defaultDialFor(user.phoneNumber),
        await user.getIdToken(),
      )
      if (!result.ok) {
        setError(result.error)
        trackEvent('contacts_lookup_failed', { surface, reason: result.error.slice(0, 80) })
        return
      }
      setMatches(result.matched)
      setChecked(result.checked)
      setNotice('')
      trackEvent('contacts_lookup_finished', {
        surface,
        checked: result.checked,
        matched: result.matched.length,
        consent: true,
      })
      onMatched?.(result.matched.length)
    } catch (err) {
      console.warn('Contact finder failed:', err)
      setError('We could not check those contacts just now. Please try again.')
      trackEvent('contacts_lookup_failed', { surface, reason: 'exception' })
    } finally {
      setBusy(false)
    }
  }

  const invite = async () => {
    const url = typeof window !== 'undefined' ? window.location.origin : ''
    const text = 'Join me on rachett — buy from people you know, and sell from your phone.'
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title: 'rachett', text, url })
        trackEvent('contacts_invite_shared', { surface, channel: 'native' })
        setShared(true)
        return
      }
      await navigator.clipboard.writeText(`${text} ${url}`.trim())
      trackEvent('contacts_invite_shared', { surface, channel: 'clipboard' })
      setShared(true)
    } catch (err) {
      const name = err && typeof err === 'object' && 'name' in err ? String((err as { name?: string }).name) : ''
      if (name === 'AbortError') return
      console.warn('Invite share failed:', err)
      setNotice('Could not open the share sheet. You can copy your link from the top of rachett.')
    }
  }

  return (
    <div>
      <p style={{ margin: '0 0 12px', color: '#aaa', fontSize: 13, lineHeight: 1.6 }}>
        Friends make a market feel like a place. Share your phone book once and we will show you
        who is already here. <strong style={{ color: '#fff' }}>Your contacts are never stored</strong> — each number is
        turned into a one-way code for the check, and we keep only that you agreed and how many
        friends were found.
      </p>

      {!supported && (
        <div style={{
          padding: '12px 14px', borderRadius: 12, border: '1px solid #333', background: '#111',
          color: '#999', fontSize: 12, lineHeight: 1.6, marginBottom: 12,
        }}>
          This browser cannot open a phone book. On Android Chrome, use <strong style={{ color: '#ddd' }}>Find friends</strong>.
          You can still invite somebody with your link.
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {supported && (
          <button type="button" onClick={() => void look()} disabled={busy}
            style={{
              flex: '1 1 160px', padding: '13px 16px', borderRadius: 10, border: 'none',
              background: busy ? '#333' : green, color: '#000', fontWeight: 900,
              fontSize: 14, cursor: busy ? 'not-allowed' : 'pointer',
            }}>
            {busy ? 'Checking…' : matches ? 'Check again' : 'Find friends'}
          </button>
        )}
        <button type="button" onClick={() => void invite()}
          style={{
            flex: '1 1 140px', padding: '13px 16px', borderRadius: 10,
            border: '1px solid #333', background: 'transparent', color: '#ccc',
            fontWeight: 800, fontSize: 13, cursor: 'pointer',
          }}>
          {shared ? 'Invite shared ✓' : 'Invite a friend'}
        </button>
      </div>

      {error && <p role="alert" style={{ margin: '10px 0 0', color: '#ff6b6b', fontSize: 12, lineHeight: 1.5 }}>{error}</p>}
      {notice && <p role="status" style={{ margin: '10px 0 0', color: '#999', fontSize: 12, lineHeight: 1.5 }}>{notice}</p>}

      {matches && (
        <div style={{ marginTop: 14 }}>
          <p style={{ margin: '0 0 8px', color: '#888', fontSize: 12 }}>
            {matches.length > 0
              ? `${matches.length} ${matches.length === 1 ? 'friend is' : 'friends are'} already on rachett · ${checked} numbers checked`
              : `None of the ${checked} numbers you shared are on rachett yet. You could be the one who brings them.`}
          </p>
          <div style={{ display: 'grid', gap: 8 }}>
            {matches.slice(0, 20).map(match => (
              <div key={match.uid} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                border: '1px solid #262626', borderRadius: 12, background: '#141414',
              }}>
                <Avatar name={match.name} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ color: '#fff', fontSize: 14, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {match.name}
                  </div>
                  <div style={{ color: '#777', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {match.slug ? match.businessName || 'Has a shop' : 'On rachett'}
                  </div>
                </div>
                {match.slug && (
                  <button type="button" onClick={() => navigate(`/store/${encodeURIComponent(match.slug)}`)}
                    style={{ padding: '8px 10px', borderRadius: 9, border: '1px solid #333', background: '#1a1a1a', color: green, fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
                    Visit shop →
                  </button>
                )}
              </div>
            ))}
          </div>
          {!compact && matches.length > 20 && (
            <p style={{ margin: '8px 0 0', color: '#666', fontSize: 11 }}>
              Showing the first 20 of {matches.length}. Check again another day for the rest.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
