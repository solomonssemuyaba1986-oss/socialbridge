import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { green } from './productCardUtils'
import {
  AGE_OPTIONS,
  GENDER_OPTIONS,
  askPrompt,
  missingQuestions,
  readAgeAnswer,
  readGenderAnswer,
  type AgeAnswer,
  type DemographicsSource,
  type GenderAnswer,
} from './demographics'
import type { Demographics } from './useDemographics'

/**
 * The two questions: "which age group are you in?" and "how do you identify?".
 *
 * One component because the ask appears on four surfaces and they must all behave identically — the
 * onboarding step, the store setup screen, a buyer's own profile, and the one-time gate for anybody
 * already here. What changes between them is the words and the tone (`dark` for the market screens,
 * `light` for the setup wizard), never the rules.
 *
 * Three things it will not do:
 *  - **It never offers a way past.** There is no Later and no cancel: both answers are required.
 *    What it does offer is "Prefer not to say" on each question, so required never means being
 *    forced into a fact that is not yours.
 *  - **It never invents a default.** Nothing is preselected except what the person already told us,
 *    because a pre-ticked "Woman" is not an answer — it is our answer wearing theirs.
 *  - **It never hides a dead button.** If they tap Continue without both answers, it says which one
 *    is missing, in words.
 */

const THEMES = {
  dark: {
    card: { background: '#141414', border: `1px solid ${green}` } as CSSProperties,
    title: '#fff',
    blurb: '#888',
    label: '#666',
    chip: '#1a1a1a',
    chipBorder: '#333',
    chipText: '#bbb',
    chipOn: '#1a2a1a',
    chipOnBorder: green,
    chipOnText: green,
    note: '#666',
    error: '#ff6b6b',
    ctaBg: green,
    ctaOff: '#242424',
    ctaText: '#000',
  },
  light: {
    card: { background: '#f8fafc', border: '1px solid #e2e8f0' } as CSSProperties,
    title: '#1a1a1a',
    blurb: '#666',
    label: '#888',
    chip: '#fff',
    chipBorder: '#ddd',
    chipText: '#444',
    chipOn: '#e8f5e9',
    chipOnBorder: '#2e7d32',
    chipOnText: '#2e7d32',
    note: '#888',
    error: '#c33',
    ctaBg: '#1a1a1a',
    ctaOff: '#ccc',
    ctaText: '#fff',
  },
}

type Theme = typeof THEMES['dark']

/** One tappable answer. Selected is a border and a colour — never a tick we might misread. */
function Option({ label, selected, theme, onClick }: {
  label: string
  selected: boolean
  theme: Theme
  onClick: () => void
}) {
  return (
    <button onClick={onClick} aria-pressed={selected}
      style={{
        padding: '8px 13px', borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: 'pointer',
        border: `1px solid ${selected ? theme.chipOnBorder : theme.chipBorder}`,
        background: selected ? theme.chipOn : theme.chip,
        color: selected ? theme.chipOnText : theme.chipText,
      }}>
      {label}
    </button>
  )
}

export default function AgeGenderAsk({
  demographics,
  surface,
  tone = 'dark',
  title = 'Two things, so we can show you the right things',
  blurb = 'rachett uses your age group and how you identify to pick what to put in front of you. It is saved on your own account, and never shown to a seller or anybody else.',
  ctaLabel = 'Continue',
  mark = false,
  bare = false,
  onDone,
}: {
  demographics: Demographics
  surface: DemographicsSource
  tone?: 'dark' | 'light'
  title?: string
  blurb?: string
  ctaLabel?: string
  /** True where this *is* the ask (onboarding, setup, the gate) — records the funnel event once. */
  mark?: boolean
  /** True when the host already provides the card, so this renders the questions and nothing else. */
  bare?: boolean
  onDone?: () => void
}) {
  const { state, save, markAsked } = demographics
  /** Seeded from what we already hold, so changing an answer is not re-answering from scratch. */
  const [ageBand, setAgeBand] = useState<AgeAnswer | ''>(() => readAgeAnswer(state.ageBand))
  const [gender, setGender] = useState<GenderAnswer | ''>(() => readGenderAnswer(state.gender))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const announced = useRef(false)
  const theme = THEMES[tone]

  // One funnel event per *ask*, not per render — and never for an edit they opened themselves.
  useEffect(() => {
    if (!mark || announced.current) return
    announced.current = true
    markAsked(surface)
  }, [mark, markAsked, surface])

  const missing = missingQuestions({ ageBand, gender })
  const ready = missing.length === 0

  const submit = async () => {
    if (!ready) {
      setError(askPrompt({ ageBand, gender }))
      return
    }
    setBusy(true)
    setError('')
    const ok = await save(ageBand, gender, surface)
    setBusy(false)
    if (!ok) {
      setError('That did not save. Check your connection and try again.')
      return
    }
    onDone?.()
  }

  return (
    <div style={bare ? { padding: 0 } : { ...theme.card, borderRadius: 12, padding: 14 }}>
      <p style={{ margin: '0 0 4px', color: theme.title, fontSize: 14, fontWeight: 800 }}>{title}</p>
      <p style={{ margin: '0 0 12px', color: theme.blurb, fontSize: 12, lineHeight: 1.55 }}>{blurb}</p>

      <p style={{ margin: '0 0 6px', color: theme.label, fontSize: 11, fontWeight: 800, letterSpacing: '0.4px' }}>
        YOUR AGE GROUP
      </p>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        {AGE_OPTIONS.map(option => (
          <Option key={option.value} label={option.label} theme={theme}
            selected={ageBand === option.value}
            onClick={() => { setAgeBand(option.value); setError('') }} />
        ))}
      </div>

      <p style={{ margin: '0 0 6px', color: theme.label, fontSize: 11, fontWeight: 800, letterSpacing: '0.4px' }}>
        YOU ARE
      </p>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        {GENDER_OPTIONS.map(option => (
          <Option key={option.value} label={option.label} theme={theme}
            selected={gender === option.value}
            onClick={() => { setGender(option.value); setError('') }} />
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={() => void submit()} disabled={busy}
          style={{
            padding: '11px 18px', background: busy ? theme.ctaOff : theme.ctaBg, color: theme.ctaText,
            border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 14,
            cursor: busy ? 'wait' : 'pointer', whiteSpace: 'nowrap',
          }}>
          {busy ? 'Saving…' : ctaLabel}
        </button>
        {/* The reason the button is not moving — said before it is tapped, and again if it is. */}
        <p style={{ margin: 0, flex: 1, minWidth: 160, color: error ? theme.error : theme.note, fontSize: 12, fontWeight: error ? 700 : 400, lineHeight: 1.5 }}>
          {error || askPrompt({ ageBand, gender })}
        </p>
      </div>
    </div>
  )
}
