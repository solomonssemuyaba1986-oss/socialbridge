/**
 * The history of what you looked at: a one-line strip that sits directly **in front of the search
 * bar**, and the panel the "See all" opens.
 *
 * Each page hands it its own list (`useViewHistory('browse')` / `'nearby'`), so the two never share
 * a history — and the page owns the list, so the strip and the recording agree by construction.
 *
 * Two rules it keeps:
 *   - **Nothing invented.** No views means no strip at all — no empty shelf, no "no history yet".
 *   - **Nothing stale presented as current.** A row is a snapshot; the product is re-read before it
 *     is opened, and a row whose product is gone is dropped quietly and said out loud.
 */
import { useEffect, useState, type CSSProperties } from 'react'
import { green } from './productCardUtils'
import { useDataSaver } from './dataSaverLive'
import { timeAgo } from './reviewUtils'
import { bucketLabelFor, type HistoryGroup, type ViewEntry } from './history'
import { fetchHistoryProduct, type ViewHistoryApi } from './useViewHistory'
import { trackEvent } from './analytics'

/** How many thumbnails the strip shows before "See all". One line, never two. */
const STRIP_LIMIT = 6

type Props<T> = {
  /** From `useViewHistory(surface)` in the page — the strip and the page must share one instance. */
  history: ViewHistoryApi
  /** How this page opens a product. Handed the product as it is **now**, never the stored row. */
  onOpen: (product: T) => void
  style?: CSSProperties
}

/** The photo, or a stand-in. A view with no image is still a view — never a broken frame. */
function Thumb({ entry, size = 28 }: { entry: ViewEntry; size?: number }) {
  const saver = useDataSaver()
  const box: CSSProperties = {
    width: size, height: size, flexShrink: 0, objectFit: 'cover', background: '#222',
    borderRadius: size >= 40 ? 10 : '50%',
  }
  if (entry.imageUrl) return <img src={saver.image(entry.imageUrl)} alt="" loading="lazy" decoding="async" style={box} />
  return (
    <span aria-hidden="true" style={{ ...box, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size >= 40 ? 18 : 13 }}>
      🛍️
    </span>
  )
}

const chipStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, padding: '4px 12px 4px 4px',
  background: '#141414', border: '1px solid #2a2a2a', borderRadius: 999,
  cursor: 'pointer', flexShrink: 0,
}
const seeAllStyle: CSSProperties = {
  padding: '8px 12px', borderRadius: 999, border: '1px solid #333', background: '#111',
  color: green, fontSize: 12, fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
}
const noticeStyle: CSSProperties = { margin: '0 0 10px', color: '#aaa', fontSize: 12, lineHeight: 1.5 }
const overlayStyle: CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)', zIndex: 120,
  display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
}
const panelStyle: CSSProperties = {
  width: '100%', maxWidth: 560, maxHeight: '82vh', overflowY: 'auto', background: '#111',
  borderTop: '1px solid #2a2a2a', borderRadius: '18px 18px 0 0', padding: '18px 16px 22px',
}
const closeStyle: CSSProperties = {
  width: 36, height: 36, borderRadius: 10, border: '1px solid #333', background: '#1a1a1a',
  color: '#ccc', cursor: 'pointer', fontSize: 15, flexShrink: 0,
}
const groupHeadingStyle: CSSProperties = {
  margin: '0 0 8px', color: '#aaa', fontSize: 12, fontWeight: 800,
  letterSpacing: '0.4px', textTransform: 'uppercase',
}
const rowStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: 8, marginBottom: 6,
  background: '#161616', border: '1px solid #222', borderRadius: 12, cursor: 'pointer',
}
const clearStyle: CSSProperties = {
  width: '100%', marginTop: 6, padding: 12, borderRadius: 12, border: '1px solid #333',
  background: 'transparent', fontWeight: 800, fontSize: 13, cursor: 'pointer',
}

/**
 * The strip, and the panel "See all" opens.
 *
 * `T` is the page's own product type: this component never invents a shape — it fetches the real
 * document and hands it straight to the page's own sheet.
 */
export default function ViewHistory<T>({ history, onOpen, style }: Props<T>) {
  const [panel, setPanel] = useState(false)
  const [busyId, setBusyId] = useState('')
  const [notice, setNotice] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)

  // Escape closes the panel, like every other sheet in the app.
  useEffect(() => {
    if (!panel) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPanel(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [panel])

  // Nothing viewed yet: no strip at all. A shelf of nothing teaches nobody anything.
  if (history.count === 0) return null

  /**
   * Open a row — after re-reading the product, because a row can outlive the thing it points at.
   * One that is gone is dropped from the list and said out loud, never opened as a ghost.
   */
  const open = async (entry: ViewEntry) => {
    setBusyId(entry.productId)
    setNotice('')
    const product = await fetchHistoryProduct(entry)
    setBusyId('')
    if (!product) {
      history.remove(entry.productId)
      setNotice(`“${entry.name}” is no longer on rachett, so it has been removed from your history.`)
      return
    }
    trackEvent('history_entry_opened', { surface: history.surface, bucket: bucketLabelFor(entry.at) })
    setPanel(false)
    // Through `unknown`: the page's own sheet knows its product type, this component must not guess.
    onOpen(product as unknown as T)
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, ...style }}>
        <span aria-hidden="true" style={{ fontSize: 13, color: '#888' }}>🕘</span>
        <div aria-label="Things you looked at" style={{ display: 'flex', gap: 8, overflowX: 'auto', flex: 1, paddingBottom: 2 }}>
          {history.entries.slice(0, STRIP_LIMIT).map(entry => (
            <button key={entry.productId} type="button" onClick={() => void open(entry)}
              title={`${entry.name} — you looked ${timeAgo(entry.at)}`}
              style={chipStyle}>
              <Thumb entry={entry} />
              <span style={{ color: '#ddd', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 130 }}>
                {busyId === entry.productId ? 'Opening…' : entry.name}
              </span>
            </button>
          ))}
        </div>
        <button type="button" onClick={() => { setConfirmClear(false); setPanel(true) }} style={seeAllStyle}>
          See all {history.count}
        </button>
      </div>

      {notice && <p role="status" style={noticeStyle}>{notice}</p>}

      {panel && (
        <div role="dialog" aria-modal="true" aria-label="Your history"
          onClick={e => { if (e.target === e.currentTarget) setPanel(false) }}
          style={overlayStyle}>
          <div style={panelStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <p style={{ margin: 0, flex: 1, color: '#fff', fontWeight: 800, fontSize: 17 }}>
                History
                <span style={{ color: '#666', fontWeight: 600, fontSize: 13 }}>
                  {' · '}{history.surface === 'nearby' ? 'Nearby' : 'Browse'}
                </span>
              </p>
              <button type="button" aria-label="Close history" onClick={() => setPanel(false)} style={closeStyle}>✕</button>
            </div>
            <p style={{ margin: '0 0 14px', color: '#666', fontSize: 12, lineHeight: 1.5 }}>
              Only on this phone — nothing here is saved to your account.
            </p>

            {notice && <p role="status" style={noticeStyle}>{notice}</p>}

            {history.groups.map((group: HistoryGroup) => (
              <div key={group.bucket} style={{ marginBottom: 18 }}>
                <p style={groupHeadingStyle}>
                  {group.label} <span style={{ color: '#555' }}>{group.entries.length}</span>
                </p>
                {group.entries.map(entry => (
                  <button key={entry.productId} type="button" onClick={() => void open(entry)} style={rowStyle}>
                    <Thumb entry={entry} size={44} />
                    <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                      <span style={{ display: 'block', color: '#fff', fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {busyId === entry.productId ? 'Opening…' : entry.name}
                      </span>
                      <span style={{ display: 'block', color: '#888', fontSize: 12, marginTop: 2 }}>
                        {entry.price ? `UGX ${entry.price} · ` : ''}{timeAgo(entry.at)}
                      </span>
                    </span>
                    <span aria-hidden="true" style={{ color: '#555', fontSize: 16 }}>›</span>
                  </button>
                ))}
              </div>
            ))}

            <button type="button"
              onClick={() => {
                if (!confirmClear) { setConfirmClear(true); return }
                // Say what just happened, and stay open long enough to be read — an acknowledgment
                // that vanishes with the thing it is about is not an acknowledgment.
                const wiped = history.count
                history.clear()
                setConfirmClear(false)
                setNotice(`Cleared — ${wiped} ${wiped === 1 ? 'look' : 'looks'} forgotten. This list fills again as you browse.`)
              }}
              style={{ ...clearStyle, borderColor: confirmClear ? '#f55' : '#333', color: confirmClear ? '#ff6b6b' : '#888' }}>
              {confirmClear ? 'Tap again to clear everything' : 'Clear history'}
            </button>
          </div>
        </div>
      )}
    </>
  )
}
