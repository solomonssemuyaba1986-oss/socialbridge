import { useEffect, useRef, useState } from 'react'
import { NAME_MAX } from './buyerName'
import { green } from './productCardUtils'
import type { BuyerName } from './useBuyerName'

/**
 * The one-time ask: "sellers will see you as …".
 *
 * Two shapes, one idea — never a blank stare:
 *  - we have something to suggest (a Google name, or an email to guess from): one tap accepts it;
 *  - we have nothing (a phone sign-up): one short field, with an example in it.
 *
 * It never appears twice: accepting, typing, or tapping Later all stop it for good. And it only
 * lives where the name is about to be *seen* — the Inbox, the checkout form, the comment form —
 * never as a first-run sheet that costs the funnel a step.
 */
export default function NameStrip({ buyerName, surface, forceOpen = false }: { buyerName: BuyerName; surface: string; forceOpen?: boolean }) {
  const { suggestion, needsAsk, markAsked, save, skip } = buyerName
  /** Start in "confirm" mode when we have a suggestion; otherwise straight to the field. */
  const [typing, setTyping] = useState(!suggestion.name || forceOpen)
  const [value, setValue] = useState(forceOpen ? (buyerName.name || suggestion.name) : suggestion.name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const announced = useRef(false)
  /** `forceOpen` is the "change it later" path — it renders the field even once they've answered. */
  const visible = forceOpen || needsAsk

  // One funnel event per *ask*, not per render, and never for an edit they opened themselves.
  useEffect(() => {
    if (!needsAsk || forceOpen || announced.current) return
    announced.current = true
    markAsked(surface)
  }, [needsAsk, forceOpen, markAsked, surface])

  if (!visible) return null

  const handleSave = async () => {
    setBusy(true)
    setError('')
    const ok = await save(value, surface)
    setBusy(false)
    if (!ok) setError(`Keep it simple: 2–${NAME_MAX} letters, no links or numbers-only.`)
  }

  const openTyping = () => {
    setTyping(true)
    setValue(suggestion.name)
    setError('')
  }

  return (
    <div
      style={{ background: '#141414', border: `1px solid ${green}`, borderRadius: 12, padding: 12, marginBottom: 14 }}
    >
      {!typing && suggestion.name ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ width: 34, height: 34, borderRadius: '50%', background: green, color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 15, flexShrink: 0 }}>
            {suggestion.name.charAt(0).toUpperCase()}
          </div>
          <div style={{ flex: 1, minWidth: 150 }}>
            <p style={{ margin: 0, color: '#fff', fontSize: 13, fontWeight: 700 }}>
              Sellers will see you as <span style={{ color: green }}>{suggestion.name}</span>
            </p>
            <p style={{ margin: '2px 0 0', color: '#888', fontSize: 11 }}>
              {suggestion.source === 'google' ? 'From your account — you can change it any time.' : 'From your email — you can change it any time.'}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <button onClick={() => void handleSave()} disabled={busy}
              style={{ padding: '9px 14px', background: green, color: '#000', border: 'none', borderRadius: 9, fontWeight: 800, fontSize: 12, cursor: busy ? 'wait' : 'pointer', whiteSpace: 'nowrap' }}>
              {busy ? 'Saving…' : "That's me ✓"}
            </button>
            <button onClick={openTyping}
              style={{ padding: '9px 14px', background: 'transparent', color: '#ccc', border: '1px solid #333', borderRadius: 9, fontWeight: 700, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              Another name
            </button>
          </div>
        </div>
      ) : (
        <div>
          <p style={{ margin: '0 0 8px', color: '#fff', fontSize: 13, fontWeight: 700 }}>
            What should sellers call you?
          </p>
          <p style={{ margin: '0 0 10px', color: '#888', fontSize: 11, lineHeight: 1.5 }}>
            They see this when you message or order — your number is never shown as your name.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input
              value={value}
              onChange={e => setValue(e.target.value)}
              placeholder="e.g. Aisha"
              maxLength={NAME_MAX}
              autoFocus={!suggestion.name ? false : true}
              onKeyDown={e => { if (e.key === 'Enter') void handleSave() }}
              style={{ flex: 1, minWidth: 140, padding: '10px 12px', background: '#0d0d0d', color: '#fff', border: '1px solid #333', borderRadius: 9, fontSize: 14, boxSizing: 'border-box' }}
            />
            <button onClick={() => void handleSave()} disabled={busy || !value.trim()}
              style={{ padding: '10px 16px', background: busy || !value.trim() ? '#242424' : green, color: busy || !value.trim() ? '#777' : '#000', border: 'none', borderRadius: 9, fontWeight: 800, fontSize: 13, cursor: busy ? 'wait' : 'pointer' }}>
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button onClick={() => void skip(surface)} disabled={busy}
              style={{ padding: '10px 14px', background: 'transparent', color: '#888', border: '1px solid #222', borderRadius: 9, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
              {forceOpen ? 'Cancel' : 'Later'}
            </button>
          </div>
          {error && <p style={{ margin: '8px 0 0', color: '#ff6b6b', fontSize: 12, fontWeight: 700 }}>{error}</p>}
        </div>
      )}
    </div>
  )
}
