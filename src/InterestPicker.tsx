import { useEffect, useRef, useState } from 'react'
import {
  INTEREST_OPTIONS,
  MAX_INTERESTS,
  interestsCountLabel,
  readInterests,
  toggleInterest,
  type InterestSource,
} from './interests'
import type { Interests } from './useInterests'

/**
 * "What are you into?" — the optional interest picker.
 *
 * It uses the same category names sellers pick from, so a choice here can be matched to a real
 * shelf without a translation table. Up to seven; after that the chips that would be an eighth go
 * quiet rather than throwing the first choice away. Skip is always visible, because an optional
 * question that hides its way out is not optional.
 *
 * The component only decides what is selected. `useInterests` decides where the answer is kept
 * (account, or this phone until there is one).
 */
export default function InterestPicker({
  interests,
  surface,
  title = 'What are you into?',
  blurb = 'Pick up to seven. We use these to put the right shops and products in front of you — never to tell a seller what you like.',
  ctaLabel = 'Save my interests',
  mark = false,
  bare = false,
  allowSkip = true,
  onDone,
}: {
  interests: Interests
  surface: InterestSource
  title?: string
  blurb?: string
  ctaLabel?: string
  /** True where this *is* the ask (onboarding) — records the funnel event once. */
  mark?: boolean
  /** True when the host already provides the card, so this renders the picker and nothing else. */
  bare?: boolean
  /** Skip is part of the onboarding ask; a profile edit can simply close. */
  allowSkip?: boolean
  onDone?: () => void
}) {
  const { state, save, markAsked } = interests
  const [picked, setPicked] = useState<string[]>(() => readInterests(state.interests))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const announced = useRef(false)
  /** The account answer can land after this mounts; seed it once, then never overwrite a choice. */
  const hydrated = useRef(!interests.loading)

  useEffect(() => {
    if (interests.loading || hydrated.current) return
    hydrated.current = true
    setPicked(readInterests(state.interests))
  }, [interests.loading, state.interests])

  // One funnel event per ask, not per render — and never for an edit they opened themselves.
  useEffect(() => {
    if (!mark || announced.current) return
    announced.current = true
    markAsked(surface)
  }, [mark, markAsked, surface])

  const full = picked.length >= MAX_INTERESTS

  const toggle = (value: string) => {
    setError('')
    setPicked(current => toggleInterest(current, value))
  }

  const finish = async (value: string[]) => {
    setBusy(true)
    setError('')
    const ok = await save(value, surface)
    setBusy(false)
    if (!ok) {
      setError('That did not save. Check your connection and try again.')
      return
    }
    onDone?.()
  }

  return (
    <div style={bare ? { padding: 0 } : { background: '#141414', border: '1px solid #adff2f', borderRadius: 14, padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: '0 0 4px', color: '#fff', fontSize: 16, fontWeight: 800 }}>{title}</p>
          <p style={{ margin: 0, color: '#888', fontSize: 12, lineHeight: 1.55 }}>{blurb}</p>
        </div>
        {allowSkip && (
          <button onClick={() => void finish([])} disabled={busy}
            style={{ flexShrink: 0, padding: '7px 11px', borderRadius: 999, background: 'transparent', border: '1px solid #444', color: '#aaa', cursor: busy ? 'wait' : 'pointer', fontSize: 12, fontWeight: 700 }}>
            Skip
          </button>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, margin: '12px 0 8px' }}>
        <p style={{ margin: 0, color: full ? '#adff2f' : '#777', fontSize: 11, fontWeight: 800, letterSpacing: '0.4px' }}>
          {interestsCountLabel(picked.length).toUpperCase()}
        </p>
        {full && <p style={{ margin: 0, color: '#888', fontSize: 11 }}>Deselect one to change it</p>}
      </div>

      <div role="group" aria-label="Interests" style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 14 }}>
        {INTEREST_OPTIONS.map(option => {
          const selected = picked.includes(option.value)
          const blocked = full && !selected
          return (
            <button key={option.value} onClick={() => toggle(option.value)} aria-pressed={selected}
              disabled={blocked} title={blocked ? `You can pick ${MAX_INTERESTS} interests` : option.label}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '9px 12px', borderRadius: 999, fontSize: 12, fontWeight: 700,
                cursor: blocked ? 'not-allowed' : 'pointer',
                opacity: blocked ? 0.4 : 1,
                border: `1px solid ${selected ? '#adff2f' : '#333'}`,
                background: selected ? '#1a2a1a' : '#1a1a1a',
                color: selected ? '#adff2f' : '#bbb',
              }}>
              <span aria-hidden="true" style={{ fontSize: 14 }}>{option.emoji}</span>
              {option.label}
            </button>
          )
        })}
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={() => void finish(picked)} disabled={busy || picked.length === 0}
          style={{
            padding: '11px 18px', background: busy || picked.length === 0 ? '#242424' : '#adff2f',
            color: '#000', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 14,
            cursor: busy ? 'wait' : picked.length === 0 ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap',
          }}>
          {busy ? 'Saving…' : ctaLabel}
        </button>
        <p style={{ margin: 0, flex: 1, minWidth: 160, color: error ? '#ff6b6b' : '#666', fontSize: 12, fontWeight: error ? 700 : 400, lineHeight: 1.5 }}>
          {error || (picked.length === 0
            ? 'Nothing picked yet — Skip is fine, and you can change this later in your profile.'
            : 'These stay on your own account. Sellers never see them.')}
        </p>
      </div>
      {allowSkip && (
        <button onClick={() => void finish([])} disabled={busy}
          style={{ width: '100%', padding: '10px', marginTop: 10, background: 'transparent', color: '#666', border: '1px solid #2a2a2a', borderRadius: 10, cursor: busy ? 'wait' : 'pointer', fontSize: 12, fontWeight: 700 }}>
          Skip for now — I’ll pick later
        </button>
      )}
    </div>
  )
}
