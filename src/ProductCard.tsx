import { useRef, useState } from 'react'
import { formatBagCount, green, productImages, type CardProduct } from './productCardUtils'
import { useImpression } from './analytics/useImpression'

type Props = {
  p: CardProduct
  /** Pinned to the top-left of the photo — "1.3 km" or "~3 km" when approximate. */
  distanceLabel?: string
  inBag: boolean
  bagged: number
  isMine?: boolean
  /** True when you have unsent words waiting for this seller — the card says so. */
  hasDraft?: boolean
  /** Which page this card is on — stamped on impressions and taps. */
  surface?: string
  onOpen: () => void
  onPreview: () => void
  onToggleBag: () => void
  onMessage: () => void
  onOrder: () => void
}

/**
 * The product card used on Browse and Nearby — same bag toggle, swipeable
 * photos ("2/3" counter), seller line and Message / Buy Now buttons.
 * Nearby simply passes a `distanceLabel` so each card shows how far it is.
 */
function ProductCard({
  p,
  distanceLabel,
  inBag,
  bagged,
  isMine,
  hasDraft,
  surface = 'nearby',
  onOpen,
  onPreview,
  onToggleBag,
  onMessage,
  onOrder,
}: Props) {
  // Counts one `product_impression` the moment this card is half on screen.
  const cardRef = useRef<HTMLDivElement | null>(null)
  useImpression(cardRef, { productId: p.id, sellerId: p.sellerId }, { surface })
  const [imgIndex, setImgIndex] = useState(0)
  const swipeStart = useRef<{ x: number; y: number } | null>(null)
  const suppressClick = useRef(false)
  const clickTimer = useRef<number | null>(null)
  const imgs = productImages(p)
  const idx = Math.min(imgIndex, Math.max(0, imgs.length - 1))

  // Single tap → open the store. Double tap → full-screen photo viewer.
  const handleCardClick = () => {
    if (clickTimer.current !== null) {
      window.clearTimeout(clickTimer.current)
      clickTimer.current = null
      onPreview()
      return
    }
    clickTimer.current = window.setTimeout(() => {
      clickTimer.current = null
      onOpen()
    }, 240)
  }

  return (
    <div
      ref={cardRef}
      style={{
        background: '#1a1a1a',
        borderRadius: '12px',
        overflow: 'hidden',
        border: '1px solid #222',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div onClick={handleCardClick} style={{ cursor: 'pointer', position: 'relative' }}>
        {distanceLabel && (
          <div style={{ position: 'absolute', top: '6px', left: '6px', background: 'rgba(0,0,0,0.7)', color: green, border: `1px solid ${green}`, padding: '2px 7px', borderRadius: '8px', fontSize: '11px', fontWeight: '800', zIndex: 2, backdropFilter: 'blur(4px)', lineHeight: 1.4, whiteSpace: 'nowrap' }}>
            📍 {distanceLabel}
          </div>
        )}
        {hasDraft && (
          <div style={{ position: 'absolute', top: distanceLabel ? '30px' : '6px', left: '6px', background: 'rgba(0,0,0,0.7)', color: '#b026ff', border: '1px solid #b026ff', padding: '2px 7px', borderRadius: '8px', fontSize: '11px', fontWeight: '800', zIndex: 2, backdropFilter: 'blur(4px)', lineHeight: 1.4, whiteSpace: 'nowrap' }}>
            📝 Draft
          </div>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onToggleBag() }}
          style={{ position: 'absolute', top: '6px', right: '6px', background: inBag ? '#1a3a1a' : 'rgba(0,0,0,0.65)', color: '#fff', border: inBag ? `1px solid ${green}` : '1px solid rgba(255,255,255,0.25)', borderRadius: '8px', padding: '2px 7px', cursor: 'pointer', fontSize: '11px', fontWeight: '700', zIndex: 2, display: 'flex', alignItems: 'center', gap: '3px', backdropFilter: 'blur(4px)', lineHeight: 1.4, whiteSpace: 'nowrap' }}
        >
          🛍️ {formatBagCount(bagged)}
        </button>
        {(p.salesCount || 0) > 0 && (
          <div style={{ position: 'absolute', top: '30px', right: '6px', background: 'rgba(0,0,0,0.65)', color: '#fff', border: '1px solid rgba(173,255,47,0.4)', borderRadius: '8px', padding: '2px 7px', fontSize: '11px', fontWeight: '700', zIndex: 2, display: 'flex', alignItems: 'center', gap: '3px', backdropFilter: 'blur(4px)', lineHeight: 1.4, whiteSpace: 'nowrap' }}>
            ✓ {formatBagCount(p.salesCount || 0)} bought
          </div>
        )}

        {imgs.length <= 1 ? (
          <img
            src={imgs[0] || 'https://placehold.co/300x200/1a1a1a/333333'}
            alt={p.name}
            style={{ width: '100%', height: 160, objectFit: 'cover', display: 'block', opacity: p.outOfStock ? 0.5 : 1 }}
          />
        ) : (
          <div
            onPointerDown={(e) => { swipeStart.current = { x: e.clientX, y: e.clientY } }}
            onPointerUp={(e) => {
              const s = swipeStart.current
              swipeStart.current = null
              if (s && Math.abs(e.clientX - s.x) > 10 && Math.abs(e.clientX - s.x) > Math.abs(e.clientY - s.y)) {
                suppressClick.current = true
              }
            }}
            onClick={(e) => {
              if (suppressClick.current) {
                suppressClick.current = false
                e.stopPropagation()
              }
            }}
            onScroll={(e) => {
              const el = e.currentTarget
              const i = Math.round(el.scrollLeft / el.clientWidth)
              setImgIndex(prev => (prev === i ? prev : i))
            }}
            style={{ display: 'flex', overflowX: 'auto', scrollSnapType: 'x mandatory', cursor: 'pointer', position: 'relative' }}
          >
            {imgs.map((img, i) => (
              <img
                key={`${p.id}-${i}`}
                src={img}
                alt={p.name}
                draggable={false}
                style={{ width: '100%', flex: '0 0 100%', height: 160, objectFit: 'cover', scrollSnapAlign: 'start', opacity: p.outOfStock ? 0.5 : 1 }}
              />
            ))}
            <div style={{ position: 'absolute', bottom: '6px', right: '6px', background: 'rgba(0,0,0,0.6)', color: '#fff', padding: '2px 7px', borderRadius: '12px', fontSize: '10px', fontWeight: '700', zIndex: 2, backdropFilter: 'blur(4px)', lineHeight: 1.4 }}>
              {idx + 1}/{imgs.length}
            </div>
          </div>
        )}

        <div style={{ padding: '12px' }}>
          <p style={{ margin: '0 0 4px', fontWeight: '700', fontSize: '14px', color: '#fff' }}>{p.name}</p>
          <p style={{ margin: '0 0 8px', color: '#555', fontSize: '12px' }}>{p.businessName}</p>
          <p style={{ margin: 0, fontWeight: '800', color: green, fontSize: '14px' }}>UGX {p.price}</p>
        </div>
      </div>

      {!p.outOfStock && (isMine ? (
        <div style={{ padding: '0 12px 12px' }}>
          <div style={{ padding: '8px', background: '#111', color: '#666', borderRadius: '8px', fontSize: '11px', textAlign: 'center', border: '1px dashed #333' }}>
            This is your product
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: '6px', padding: '0 12px 12px' }}>
          <button
            onClick={(e) => { e.stopPropagation(); onMessage() }}
            style={{ flex: 1, padding: '8px', background: '#222', color: '#fff', border: '1px solid #333', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '12px' }}
          >
            💬 Message
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onOrder() }}
            style={{ flex: 1, padding: '8px', background: green, color: '#000', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '12px' }}
          >
            Buy Now
          </button>
        </div>
      ))}

      {p.outOfStock && (
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: '700', fontSize: '13px', textAlign: 'center', padding: '8px' }}>
          Out of Stock
        </div>
      )}
    </div>
  )
}

export default ProductCard
