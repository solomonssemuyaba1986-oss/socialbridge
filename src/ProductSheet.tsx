import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from './firebase'
import { green, productImages, type CardProduct } from './productCardUtils'
import {
  listVariants,
  resolveSheetAction,
  stockLine,
  variantComplete,
  variantLabel,
  variantPrompt,
  type SheetAction,
  type Variant,
} from './productSheetUtils'
import LikePill from './LikePill'
import ProductPreview from './ProductPreview'
import { trackEvent } from './analytics'

/**
 * The product details sheet — the whole product, and the buy button, without a page load.
 *
 * Deliberately dumb: it owns the *choice* (colour, size, photos) and nothing else. The host
 * page owns the actions, so Browse, Nearby and the storefront all keep using the order and
 * message forms they already have. **Mount it fresh per product** (`key={product.id}`) so one
 * sheet never inherits the last product's chosen colour.
 *
 * It also *follows the product live* (one `onSnapshot`): a card can be minutes old — Browse and
 * the storefront read one page at a time — but nobody should ever tap Buy on a photo, a price or
 * a size the seller already changed.
 */

type Props = {
  product: CardProduct | null
  /** ♥ state comes from the page's single likes listener. */
  liked?: boolean
  likeCount?: number
  onToggleLike?: () => void
  /** Already in the buyer's bag. */
  inBag?: boolean
  /** You're looking at your own listing — nobody buys or loves their own product. */
  isMine?: boolean
  /** Which page opened it — stamped on every event the sheet fires. */
  surface?: string
  onClose: () => void
  onBuy: (variant: Variant) => void
  onMessage: (variant: Variant) => void
  onToggleBag: (variant: Variant) => void
  /** The way back to the whole shop when a buyer wants more than one product. */
  onOpenStore?: () => void
}

/** Shared looks for the small, dense controls in the sheet. */
const fieldLabel: CSSProperties = { margin: '0 0 7px', color: '#888', fontSize: '11px', fontWeight: 800, letterSpacing: '0.5px', textTransform: 'uppercase' }
const pillRow: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: '8px' }
const pillStyle = (active: boolean): CSSProperties => ({
  padding: '7px 13px',
  borderRadius: '999px',
  background: active ? green : '#1c1c1c',
  color: active ? '#000' : '#ddd',
  border: `1px solid ${active ? green : '#333'}`,
  fontSize: '13px',
  fontWeight: 700,
  cursor: 'pointer',
})

function ProductSheet({
  product: productProp,
  liked,
  likeCount,
  onToggleLike,
  inBag = false,
  isMine = false,
  surface = 'browse',
  onClose,
  onBuy,
  onMessage,
  onToggleBag,
  onOpenStore,
}: Props) {
  const [color, setColor] = useState('')
  const [size, setSize] = useState('')
  const [imgIndex, setImgIndex] = useState(0)
  const [galleryOpen, setGalleryOpen] = useState(false)
  /** The seller's current copy of this product — null until the first snapshot lands. */
  const [liveDoc, setLiveDoc] = useState<CardProduct | null>(null)
  /**
   * What we show: the page's product (it carries the seller's name and slug) with the *live*
   * document's fields laid over it, so a changed price or photo wins without losing the shop.
   */
  const product = productProp ? { ...productProp, ...(liveDoc || {}) } : liveDoc
  const mountedAt = useRef(0)
  /** What the buyer did in here — the last thing wins, so "bagged, then closed" is 'bag'. */
  const lastAction = useRef<SheetAction | null>(null)
  /** One `product_sheet_closed` per mount, however they leave. */
  const recorded = useRef(false)
  /** One `product_sheet_opened` per mount — a funnel needs opens, not re-renders. */
  const announced = useRef(false)

  const imgs = product ? productImages(product) : []
  const colors = listVariants(product?.colors)
  const sizes = listVariants(product?.sizes)
  const picked: Variant = { color, size }
  const ready = variantComplete({ colors, sizes }, picked)
  const prompt = variantPrompt({ colors, sizes }, picked)
  const low = stockLine(product?.stock)
  const label = variantLabel(color, size)

  // Opened exactly once (the ref guard) and with complete deps, so no hooks warning.
  useEffect(() => {
    if (announced.current) return
    announced.current = true
    mountedAt.current = Date.now()
    trackEvent('product_sheet_opened', {
      productId: product?.id,
      sellerId: product?.sellerId,
      surface,
      hasVariants: listVariants(product?.colors).length > 0 || listVariants(product?.sizes).length > 0,
    })
  }, [product?.id, product?.sellerId, product?.colors, product?.sizes, surface])

  const recordClose = useCallback((action?: SheetAction | null) => {
    if (recorded.current) return
    recorded.current = true
    trackEvent('product_sheet_closed', {
      productId: product?.id,
      surface,
      dwellMs: mountedAt.current ? Date.now() - mountedAt.current : 0,
      action: resolveSheetAction(action),
    })
  }, [product?.id, surface])

  /** Leave for good (✕, backdrop, Escape) — reporting whatever they did while in here. */
  const close = useCallback(() => {
    recordClose(lastAction.current)
    onClose()
  }, [onClose, recordClose])

  /** Leave *to do something*: buy, or write to the seller. */
  const leaveWith = (action: SheetAction, run: () => void) => {
    recordClose(action)
    run()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  /**
   * Follow the product itself. The host's card may be minutes old (Browse and the storefront
   * read one page at a time), and this is the surface where money changes hands — so it subscribes
   * to the one document and takes whatever the seller has done since: new photos, new price,
   * new colours, out of stock.
   */
  useEffect(() => {
    const sellerId = productProp?.sellerId
    const productId = productProp?.id
    if (!sellerId || !productId) return
    const unsub = onSnapshot(
      doc(db, 'sellers', sellerId, 'products', productId),
      snap => {
        if (!snap.exists()) return
        setLiveDoc({ id: snap.id, sellerId, ...snap.data() } as CardProduct)
      },
      err => console.warn('Product sheet: could not follow this product live', err),
    )
    return unsub
  }, [productProp?.id, productProp?.sellerId])

  if (!product) return null

  const outOfStock = Boolean(product.outOfStock)
  const actionDisabled = outOfStock || isMine || !ready

  const onGalleryScroll = (el: HTMLDivElement) => {
    const i = Math.round(el.scrollLeft / el.clientWidth)
    setImgIndex(prev => (prev === i ? prev : i))
  }

  return (
    <div
      className="rt-modal-overlay"
      onClick={e => { if (e.target === e.currentTarget) close() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)', zIndex: 1500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px', fontFamily: 'sans-serif' }}
    >
      <div
        className="rt-modal-box"
        style={{ background: '#141414', border: '1px solid #262626', borderRadius: '16px', width: '100%', maxWidth: '480px', maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}
      >
        {/* The ✕ sits above the photos, so it is reachable however far the body is scrolled */}
        <button
          onClick={close}
          aria-label="Close"
          style={{ position: 'absolute', top: '10px', right: '10px', zIndex: 3, width: '32px', height: '32px', borderRadius: '50%', background: 'rgba(0,0,0,0.6)', color: '#fff', border: '1px solid #333', fontSize: '15px', cursor: 'pointer', lineHeight: 1, backdropFilter: 'blur(4px)' }}
        >
          ✕
        </button>

        {/* Photos: the card's own swipe, bigger. A tap opens the full-screen viewer that
            already exists, so there is no second zoom/swipe implementation to maintain. */}
        <div style={{ position: 'relative', flexShrink: 0, background: '#0d0d0d' }}>
          {imgs.length > 0 ? (
            <div
              onScroll={e => onGalleryScroll(e.currentTarget)}
              style={{ display: 'flex', overflowX: 'auto', scrollSnapType: 'x mandatory' }}
            >
              {imgs.map((img, i) => (
                <img
                  key={`${product.id}-${i}`}
                  src={img}
                  alt={product.name}
                  draggable={false}
                  onClick={() => { lastAction.current = 'gallery'; setGalleryOpen(true) }}
                  style={{ width: '100%', flex: '0 0 100%', height: 250, objectFit: 'cover', scrollSnapAlign: 'start', cursor: 'zoom-in', opacity: outOfStock ? 0.5 : 1 }}
                />
              ))}
            </div>
          ) : (
            <div style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555', fontSize: 13 }}>
              No photo yet
            </div>
          )}
          {imgs.length > 1 && (
            <div style={{ position: 'absolute', bottom: 8, right: 8, background: 'rgba(0,0,0,0.6)', color: '#fff', padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 700, backdropFilter: 'blur(4px)' }}>
              {Math.min(imgIndex, imgs.length - 1) + 1}/{imgs.length}
            </div>
          )}
          {imgs.length > 0 && (
            <div style={{ position: 'absolute', bottom: 8, left: 8, background: 'rgba(0,0,0,0.6)', color: '#ccc', padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 700, backdropFilter: 'blur(4px)' }}>
              🔍 Tap to zoom
            </div>
          )}
          {outOfStock && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.55)', color: '#fff', fontWeight: 800, fontSize: 14 }}>
              Out of Stock
            </div>
          )}
        </div>

        {/* Everything scrolls; the buy buttons below do not. */}
        <div style={{ overflowY: 'auto', padding: '14px 16px 6px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <h2 style={{ margin: 0, flex: 1, minWidth: 0, fontSize: 18, fontWeight: 800, color: '#fff', lineHeight: 1.3 }}>
              {product.name}
            </h2>
            <LikePill liked={Boolean(liked)} count={likeCount || 0} onToggle={isMine ? undefined : onToggleLike} />
          </div>

          <p style={{ margin: '4px 0 10px', color: '#777', fontSize: 13 }}>
            {product.businessName}
            {onOpenStore && !isMine && (
              <>
                {' · '}
                <button
                  onClick={() => leaveWith('store', onOpenStore)}
                  style={{ background: 'none', border: 'none', padding: 0, color: green, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
                >
                  Visit shop →
                </button>
              </>
            )}
          </p>

          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <p style={{ margin: 0, fontWeight: 800, color: green, fontSize: 20 }}>UGX {product.price}</p>
            {low && <span style={{ color: '#ffb020', fontSize: 12, fontWeight: 800 }}>{low}</span>}
          </div>

          {/* Only rendered when the seller actually listed them — most products have none yet,
              and an empty "Colours" heading would just look broken. */}
          {colors.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <p style={fieldLabel}>
                Colour {color && <span style={{ color: '#ddd', fontWeight: 600 }}>· {color}</span>}
              </p>
              <div style={pillRow}>
                {colors.map(c => (
                  <button key={c} onClick={() => setColor(prev => (prev === c ? '' : c))} style={pillStyle(color === c)}>
                    {c}
                  </button>
                ))}
              </div>
            </div>
          )}

          {sizes.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <p style={fieldLabel}>
                Size {size && <span style={{ color: '#ddd', fontWeight: 600 }}>· {size}</span>}
              </p>
              <div style={pillRow}>
                {sizes.map(s => (
                  <button key={s} onClick={() => setSize(prev => (prev === s ? '' : s))} style={pillStyle(size === s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {product.description && (
            <p style={{ margin: '14px 0 0', color: '#aaa', fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
              {product.description}
            </p>
          )}

          {/* No options listed: rather than an empty section, offer the question a buyer
              would otherwise have to leave the sheet to ask. */}
          {colors.length === 0 && sizes.length === 0 && !isMine && !outOfStock && (
            <p style={{ margin: '14px 0 0', color: '#777', fontSize: 12, lineHeight: 1.6 }}>
              No colours or sizes listed for this one.{' '}
              <button
                onClick={() => leaveWith('message', () => onMessage({ color, size }))}
                style={{ background: 'none', border: 'none', padding: 0, color: green, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
              >
                Ask the seller
              </button>
            </p>
          )}

          {isMine && (
            <div style={{ margin: '14px 0 0', padding: 10, background: '#111', border: '1px dashed #333', borderRadius: 8, color: '#888', fontSize: 12, textAlign: 'center' }}>
              This is your product
            </div>
          )}
        </div>

        {/* The sticky bar: the whole point of the sheet. Message and bag side by side, Buy
            full width underneath — the thumb reaches it without a scroll. */}
        <div style={{ padding: '12px 16px 16px', borderTop: '1px solid #222', flexShrink: 0 }}>
          {!isMine && !ready && !outOfStock && (
            <p style={{ margin: '0 0 8px', color: '#ffb020', fontSize: 12, fontWeight: 800 }}>{prompt}</p>
          )}
          {!isMine && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <button
                onClick={() => leaveWith('message', () => onMessage({ color, size }))}
                style={{ flex: 1, padding: 11, background: '#222', color: '#fff', border: '1px solid #333', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
              >
                💬 Message
              </button>
              <button
                onClick={() => { lastAction.current = 'bag'; onToggleBag({ color, size }) }}
                style={{ flex: 1, padding: 11, background: inBag ? '#16240c' : '#222', color: inBag ? green : '#fff', border: `1px solid ${inBag ? green : '#333'}`, borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
              >
                {inBag ? '✓ In bag' : '🛍️ Add to bag'}
              </button>
            </div>
          )}
          {!isMine && (
            <button
              onClick={() => leaveWith('buy', () => onBuy({ color, size }))}
              disabled={actionDisabled}
              style={{ width: '100%', padding: 14, background: actionDisabled ? '#242424' : green, color: actionDisabled ? '#777' : '#000', border: 'none', borderRadius: 12, fontWeight: 800, fontSize: 15, cursor: actionDisabled ? 'not-allowed' : 'pointer' }}
            >
              {outOfStock ? 'Out of Stock' : ready ? `⚡ Buy now${label ? ` · ${label}` : ''}` : prompt}
            </button>
          )}
        </div>
      </div>

      {galleryOpen && imgs.length > 0 && (
        <ProductPreview images={imgs} startIndex={imgIndex} onClose={() => setGalleryOpen(false)} />
      )}
    </div>
  )
}

export default ProductSheet

