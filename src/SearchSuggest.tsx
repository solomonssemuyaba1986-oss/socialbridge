import type { Suggestion } from './useSuggestions'

const green = '#adff2f'

const KIND_ICON: Record<Suggestion['kind'], string> = {
  store: '🏪',
  product: '🛍️',
  category: '🏷️',
  recent: '🕘',
}

/**
 * The type-ahead list under a search box. Every row came from real data (see
 * `useSuggestions`), and the footer says so — the promise is "we only suggest what
 * is actually on rachett".
 */
export default function SearchSuggest({ suggestions, activeIndex, onPick }: {
  suggestions: Suggestion[]
  activeIndex: number
  onPick: (suggestion: Suggestion) => void
}) {
  if (suggestions.length === 0) return null
  return (
    <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, background: '#161616', border: '1px solid #2a2a2a', borderRadius: 12, overflow: 'hidden', zIndex: 30, boxShadow: '0 16px 40px rgba(0,0,0,0.55)', textAlign: 'left' }}>
      {suggestions.map((s, i) => (
        <button
          key={s.id}
          // onMouseDown so the pick lands before the input loses focus
          onMouseDown={e => { e.preventDefault(); onPick(s) }}
          style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', padding: '10px 12px', background: i === activeIndex ? '#12210d' : 'transparent', border: 'none', borderBottom: '1px solid #1f1f1f', color: '#fff', cursor: 'pointer', textAlign: 'left' }}>
          {s.imageUrl ? (
            <img src={s.imageUrl} alt="" style={{ width: 30, height: 30, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />
          ) : (
            <span style={{ width: 30, textAlign: 'center', fontSize: 16, flexShrink: 0 }}>{KIND_ICON[s.kind]}</span>
          )}
          <span style={{ minWidth: 0, flex: 1 }}>
            <span style={{ display: 'block', fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: i === activeIndex ? green : '#fff' }}>{s.label}</span>
            {s.sub && (
              <span style={{ display: 'block', fontSize: 11, color: '#777', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.sub}</span>
            )}
          </span>
          <span style={{ color: '#444', fontSize: 12, flexShrink: 0 }}>↵</span>
        </button>
      ))}
      <div style={{ padding: '8px 12px', fontSize: 11, color: '#555' }}>
        Only shops, products and categories that exist on rachett.
      </div>
    </div>
  )
}
