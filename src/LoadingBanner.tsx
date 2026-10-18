import type { CSSProperties } from 'react'

const green = '#adff2f'

type Props = {
  /** What is being fetched, in the buyer's words — "Finding what's around you…". */
  message?: string
  /** A slimmer bar for a section inside a page rather than the page itself. */
  compact?: boolean
}

/**
 * The one loading banner.
 *
 * Every screen that waits for Firestore used to say it in its own way — a full-screen loader here,
 * a line of grey text there. This is the shape the market already uses for "we are working on it":
 * the same green pill, the same sweeping bar, the same words. Mount it while a page's data is on
 * its way and drop it the moment the data lands; a page that is already fast simply never shows it.
 *
 * It is a *banner*, not a blocker: a buyer can still scroll, tap the search bar or leave. Nothing
 * about a slow connection should take the screen hostage.
 */
function LoadingBanner({ message = 'Loading…', compact = false }: Props) {
  const bar: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    position: 'relative',
    overflow: 'hidden',
    padding: compact ? '7px 12px' : '10px 14px',
    marginBottom: compact ? 10 : 16,
    borderRadius: 10,
    background: '#12210d',
    border: '1px solid #2f4a1a',
    color: green,
    fontSize: compact ? 12 : 13,
    fontWeight: 700,
    lineHeight: 1.4,
  }

  return (
    <div role="status" aria-live="polite" style={bar}>
      <style>{`
        @keyframes rt-banner-pulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.35 } }
        @keyframes rt-banner-sweep { 0% { transform: translateX(-110%) } 100% { transform: translateX(310%) } }
        @media (prefers-reduced-motion: reduce) {
          .rt-banner-dot, .rt-banner-sweep { animation: none !important; }
        }
      `}</style>
      <span
        className="rt-banner-dot"
        aria-hidden="true"
        style={{ width: 8, height: 8, borderRadius: '50%', background: green, flexShrink: 0, animation: 'rt-banner-pulse 1.2s ease-in-out infinite' }}
      />
      <span style={{ minWidth: 0 }}>{message}</span>
      <span aria-hidden="true" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 2, background: 'rgba(173,255,47,0.16)' }}>
        <span
          className="rt-banner-sweep"
          style={{ position: 'absolute', top: 0, bottom: 0, width: '34%', background: green, animation: 'rt-banner-sweep 1.3s linear infinite' }}
        />
      </span>
    </div>
  )
}

export default LoadingBanner
