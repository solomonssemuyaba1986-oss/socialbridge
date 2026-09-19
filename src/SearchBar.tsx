import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { green } from './productCardUtils'

type Props = {
  value: string
  onChange: (value: string) => void
  /** The grey name that rolls while the box is empty (see `useRotatingPlaceholder`). */
  placeholder: string
  /** Spoken name for the box — the visible hint is decorative and hidden from screen readers. */
  label?: string
  /** Runs on the 🔍 button, on Enter, and on the form's own submit — one path, no drift. */
  onSearch: () => void
  /** Arrow keys / Escape still belong to the page's suggestion list. */
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void
  onFocus?: () => void
  onBlur?: () => void
  /** Says what to do when someone taps search with an empty box. */
  emptyHint?: string
  /** The suggestion dropdown, when the page has one. */
  children?: ReactNode
  autoComplete?: string
  style?: CSSProperties
}

/**
 * The one search box in the app: hint text that rolls with real names, a magnifier **on the
 * right** (there is no decorative one on the left), and a real `<form>` so the phone's keyboard
 * key says **Search** and pressing it searches instead of hopping to the next control.
 *
 * Tapping the magnifier with nothing typed does not search — it puts the cursor back where the
 * person meant to be, and says so quietly underneath for a moment.
 */
export default function SearchBar({
  value,
  onChange,
  placeholder,
  label = 'Search products and shops',
  onSearch,
  onKeyDown,
  onFocus,
  onBlur,
  emptyHint = 'Type something to search',
  children,
  autoComplete = 'off',
  style,
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [hint, setHint] = useState(false)
  const hintTimer = useRef<number | null>(null)

  useEffect(() => () => {
    if (hintTimer.current !== null) window.clearTimeout(hintTimer.current)
  }, [])

  const nudge = () => {
    inputRef.current?.focus()
    setHint(true)
    if (hintTimer.current !== null) window.clearTimeout(hintTimer.current)
    hintTimer.current = window.setTimeout(() => setHint(false), 2600)
  }

  const submit = () => {
    if (!value.trim()) {
      nudge()
      return
    }
    setHint(false)
    onSearch()
  }

  return (
    <div style={{ position: 'relative', ...style }}>
      <form role="search" onSubmit={e => { e.preventDefault(); submit() }}>
        <input
          ref={inputRef}
          type="text"
          inputMode="search"
          // The phone's action key becomes a magnifier labelled "Search" (not "Next").
          enterKeyHint="search"
          value={value}
          aria-label={label}
          onChange={e => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={onFocus}
          onBlur={onBlur}
          autoComplete={autoComplete}
          style={{
            width: '100%',
            padding: '14px 96px 14px 16px',
            borderRadius: 12,
            border: '1px solid #333',
            background: '#1a1a1a',
            color: '#fff',
            fontSize: 15,
            boxSizing: 'border-box',
            outline: 'none',
          }}
        />

        {/*
          The rolling hint is drawn here rather than in the input's own placeholder: the
          browser's built-in one cannot be bold-italic and cannot be animated. It is
          `aria-hidden` (the input carries the real label), ignores the pointer, and is cut
          off before it can run under the ✕ / 🔍 buttons.
        */}
        {value.length === 0 && (
          <span aria-hidden="true"
            style={{ position: 'absolute', left: 16, right: 96, top: 0, bottom: 0, display: 'flex', alignItems: 'center', pointerEvents: 'none', overflow: 'hidden' }}>
            <span key={placeholder} className="rt-search-hint"
              style={{ fontStyle: 'italic', fontWeight: 700, fontSize: 15, color: '#8a8a8a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>
              {placeholder}
            </span>
          </span>
        )}

        {value.length > 0 && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => { onChange(''); inputRef.current?.focus() }}
            style={{ position: 'absolute', right: 52, top: 21, background: 'transparent', border: 'none', color: '#666', cursor: 'pointer', fontSize: 16, padding: '4px 6px' }}
          >
            ✕
          </button>
        )}

        <button
          type="submit"
          aria-label="Search"
          title="Search"
          style={{ position: 'absolute', right: 6, top: 6, width: 40, height: 40, borderRadius: 10, background: green, color: '#000', border: 'none', cursor: 'pointer', fontSize: 17, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          🔍
        </button>
      </form>

      {hint && (
        <p style={{ margin: '6px 0 0', color: '#888', fontSize: 12 }}>{emptyHint}</p>
      )}

      {children}
    </div>
  )
}
