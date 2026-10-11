import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { auth } from './firebase'
import { useProductFeed } from './useProductFeed'
import { useSellerDirectory } from './useSellerDirectory'
import { useBag } from './useBag'
import { useProductLikes } from './useProductLikes'
import { formatCount, productImages, type CardProduct } from './productCardUtils'
import { type Variant } from './productSheetUtils'
import { notify } from './notifications'
import { requireSignIn } from './signInGate'
import { trackEvent } from './analytics'
import ProductSheet from './ProductSheet'
import ProductActions from './ProductActions'

const green = '#adff2f'

/** The small label under each button on the rail, so a glyph is never the only clue. */
const railLabel = { fontSize: '10px', fontWeight: 800, color: '#fff', textShadow: '0 1px 4px rgba(0,0,0,0.9)' } as const

/**
 * 🛍️▶ Shoppertainment — the market as a channel: one product per screen, edge to edge.
 *
 * This is the one destination that is a *shape* rather than a list. A product takes the whole screen
 * and the scroll stops on it, so the photo is the shelf and the price, the shop and the three things
 * a buyer does with a product (love it, take it, ask about it) sit on top of it where a thumb
 * already is. Everything here is the market's own catalogue and the market's own actions:
 * `useProductFeed` reads it, `useSellerDirectory` puts a name and a slug on it, and Buy and Message
 * are the very same details sheet and forms Browse opens. Nothing is invented for the channel.
 *
 * One honest note about the ▶ it wears: a product document carries photos, not video
 * (`DATA_COLLECTION.md` §2.3), so nothing here plays yet. The ▶ is the channel's mark — the same one
 * the sidebar and the tab bar draw next to the name — and this is where a clip will play the day
 * products carry one.
 */
function ShoppertainmentPage() {
  const navigate = useNavigate()
  /** A page of twelve is twelve screens: small enough to start fast, big enough to keep scrolling. */
  const { products: rows, loading, hasMore, error, loadMore } = useProductFeed({ pageSize: 12 })
  const directory = useSellerDirectory(true)
  const { addToBag, isInBag, updateBagVariant, setQuantity: setBagQuantity, count: bagCount } = useBag()
  // ♥ Universal likes: the tally rides on each product, my own vote comes from one listener.
  const { isLiked, likeCountFor, toggleLike } = useProductLikes()
  const uid = auth.currentUser?.uid || ''

  /**
   * The catalogue with its shop attached — the same join Browse makes, for the same reason: a
   * product document carries neither the shop's name nor its slug, and a slide without a slug cannot
   * be opened at all.
   */
  const items: CardProduct[] = useMemo(
    () => rows.map(row => {
      const shop = directory.stores.get(row.sellerId)
      return {
        ...(row as unknown as CardProduct),
        id: row.id,
        sellerId: row.sellerId,
        sellerSlug: shop?.slug || '',
        businessName: shop?.businessName || '',
      }
    }).filter(p => p.sellerSlug),
    [rows, directory],
  )

  /** The details sheet, and the two forms it can lead to — exactly as Browse and Nearby hold them. */
  const [detailsProduct, setDetailsProduct] = useState<CardProduct | null>(null)
  const [orderProduct, setOrderProduct] = useState<CardProduct | null>(null)
  const [messageProduct, setMessageProduct] = useState<CardProduct | null>(null)
  const [orderVariant, setOrderVariant] = useState<Variant>({})
  const [messageVariant, setMessageVariant] = useState<Variant>({})
  const [sheetQty, setSheetQty] = useState('1')

  /**
   * The feed's scroll behaviour, on the document itself.
   *
   * `scroll-snap` only means anything on the scroll container, and on a phone that container *is* the
   * page: this page has no box of its own to scroll, because a fixed-height box would put the last
   * 60px of every slide behind the appbar. So the snap is switched on for `<html>` — which a page
   * cannot style from JSX — while this page is mounted, and off again the moment it isn't: a
   * document-wide snap that outlived the page would make every other screen sticky. Desktop never
   * takes it (`responsive.css` writes it inside the phone media query); a mouse wheel fights a
   * mandatory snap.
   */
  useEffect(() => {
    document.documentElement.classList.add('rt-shop-snap')
    return () => document.documentElement.classList.remove('rt-shop-snap')
  }, [])

  /** The end of the channel: one screen short of it, ask for the next page. */
  const endRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const node = endRef.current
    if (!node || !hasMore) return
    const observer = new IntersectionObserver(
      entries => { if (entries.some(entry => entry.isIntersecting)) loadMore() },
      { rootMargin: '300px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [hasMore, loadMore, items.length])

  /**
   * ♥ One tap, one vote per account — the same transaction the cards use, with this page stamped on
   * the event so the channel can be told apart from the grid.
   */
  const handleToggleLike = (p: CardProduct) => {
    void toggleLike({
      sellerId: p.sellerId,
      productId: p.id,
      currentCount: likeCountFor(p),
      surface: 'shoppertainment',
    }).then(res => {
      if (res.needsSignIn) {
        requireSignIn(navigate, { action: 'like', returnTo: '/shoppertainment', productId: p.id, sellerSlug: p.sellerSlug })
      } else if (res.ownProduct) alert(notify.likeSelfBlock)
      else if (res.failed) alert(notify.likeFailed)
    })
  }

  /** One add, whichever button asked for it: the app's one bag payload, written in one place. */
  const addOne = (p: CardProduct, variant: Variant, qty: number) => {
    addToBag({
      productId: p.id,
      productName: p.name,
      productPrice: p.price,
      imageUrl: p.imageUrl,
      images: p.images?.length ? p.images : (p.imageUrl ? [p.imageUrl] : []),
      sellerSlug: p.sellerSlug,
      sellerId: p.sellerId,
      businessName: p.businessName,
      color: variant.color,
      size: variant.size,
    }, qty)
    trackEvent('bag_added', { productId: p.id, sellerId: p.sellerId, price: p.price, surface: 'shoppertainment', bagSize: bagCount + 1 })
  }

  /** From the details sheet: already bagged → just remember the new colour and size, never remove. */
  const handleSheetBag = (p: CardProduct, variant: Variant, qty = 1) => {
    if (isInBag(p.id)) {
      updateBagVariant(p.id, variant)
      setBagQuantity(p.id, Math.max(1, qty))
      return
    }
    addOne(p, variant, qty)
  }

  /**
   * From the rail. One tap takes it; a second tap opens the bag it just filled, because this page has
   * no floating bag button of its own and a buyer who has just added something is exactly the person
   * who wants to look inside it.
   */
  const handleRailBag = (p: CardProduct) => {
    if (isInBag(p.id)) {
      navigate('/bag')
      return
    }
    addOne(p, {}, 1)
  }

  return (
    <div className="rt-page" style={{ minHeight: '100vh', background: '#0f0f0f', fontFamily: 'sans-serif', color: '#fff' }}>
      {/* The channel's own strip: it stays put while the products scroll past, so the name of the
          thing you are watching never scrolls away — and the market is always one tap from it. */}
      <header
        style={{
          position: 'sticky', top: 0, zIndex: 5, display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', gap: '10px', padding: '10px 14px',
          background: 'rgba(15,15,15,0.88)', borderBottom: '1px solid #1c1c1c', backdropFilter: 'blur(8px)',
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', fontSize: '14px', fontWeight: 800 }}>
          <span className="rt-play" aria-hidden="true">▶</span> Shoppertainment
        </span>
        <button
          onClick={() => navigate('/browse')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: 'transparent', color: '#ddd', border: '1px solid #2c2c2c', borderRadius: '999px', padding: '6px 12px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
        >
          ▦ Browse the market
        </button>
      </header>

      {loading && items.length === 0 && (
        <div className="rt-shop-item" style={{ alignItems: 'center', justifyContent: 'center', color: '#8a8a8a', fontSize: '14px' }}>
          Tuning the channel…
        </div>
      )}

      {!loading && items.length === 0 && (
        <div className="rt-shop-item" style={{ alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '0 24px' }}>
          <p style={{ margin: '0 0 18px', color: '#8a8a8a', fontSize: '14px', lineHeight: 1.6 }}>
            {error || 'The channel is quiet — nothing has been listed yet.'}
          </p>
          <button
            onClick={() => navigate('/browse')}
            style={{ padding: '13px 18px', background: green, color: '#000', border: 'none', borderRadius: '10px', fontWeight: 800, fontSize: '14px', cursor: 'pointer' }}
          >
            Browse the market instead
          </button>
        </div>
      )}

      {items.map((p, index) => {
        const photo = productImages(p)[0]
        const liked = isLiked(p.id)
        const inBag = isInBag(p.id)
        return (
          /* One product, one screen: `rt-shop-item` is what makes that true on a phone (and what
             keeps a slide's words clear of the floating bag). */
          <article key={p.id} className="rt-shop-item">
            {/* The whole photo is the way in: it opens the product, colour, size and all. */}
            <button
              onClick={() => setDetailsProduct(p)}
              aria-label={`Open ${p.name}`}
              style={{ position: 'absolute', inset: 0, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' }}
            >
              {photo && (
                <img
                  src={photo}
                  alt=""
                  /* The first two screens are the ones somebody is already looking at. */
                  loading={index < 2 ? 'eager' : 'lazy'}
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                />
              )}
            </button>

            {/* The scrim: white words on a white product photo are unreadable. */}
            <div
              aria-hidden="true"
              style={{
                position: 'absolute', inset: 0, pointerEvents: 'none',
                background: 'linear-gradient(180deg, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0) 32%, rgba(0,0,0,0.55) 68%, rgba(0,0,0,0.92) 100%)',
              }}
            />

            <span
              style={{
                position: 'absolute', top: '12px', left: '12px', display: 'inline-flex', alignItems: 'center',
                gap: '6px', padding: '5px 10px', borderRadius: '999px', background: 'rgba(0,0,0,0.55)',
                border: '1px solid rgba(173,255,47,0.35)', fontSize: '10px', fontWeight: 900, letterSpacing: '0.6px',
              }}
            >
              <span className="rt-play" aria-hidden="true">▶</span> SHOPPERTAINMENT
            </span>

            {/* The words: the price first, because that is the question a shelf answers. */}
            <div className="rt-shop-meta" style={{ position: 'relative', width: '100%', padding: '20px 92px 28px 18px' }}>
              <p style={{ margin: 0, fontSize: '22px', fontWeight: 900, color: green }}>{p.price}</p>
              <p style={{ margin: '4px 0 0', fontSize: '16px', fontWeight: 800, color: '#fff', lineHeight: 1.35 }}>{p.name}</p>
              <button
                onClick={() => navigate(`/store/${p.sellerSlug}`)}
                style={{ marginTop: '6px', padding: 0, background: 'transparent', border: 'none', color: '#cfcfcf', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}
              >
                {p.businessName || 'See the shop'} →
              </button>
            </div>

            {/* The rail: the three things a buyer does with a product, where the thumb already is. */}
            <div className="rt-shop-rail" style={{ position: 'absolute', right: '10px', bottom: '28px', display: 'grid', gap: '10px', justifyItems: 'center' }}>
              <button
                onClick={() => handleToggleLike(p)}
                aria-label={liked ? `Take your love back from ${p.name}` : `Love ${p.name}`}
                aria-pressed={liked}
                style={{ display: 'grid', justifyItems: 'center', gap: '2px', background: 'transparent', border: 'none', padding: '2px', cursor: 'pointer' }}
              >
                <span aria-hidden="true" style={{ fontSize: '26px', lineHeight: 1, color: liked ? green : '#fff', filter: 'drop-shadow(0 1px 4px rgba(0,0,0,0.85))' }}>
                  {liked ? '♥' : '♡'}
                </span>
                <span style={railLabel}>{formatCount(likeCountFor(p))}</span>
              </button>

              <button
                onClick={() => handleRailBag(p)}
                aria-label={inBag ? `Open your bag — ${p.name} is in it` : `Add ${p.name} to your bag`}
                aria-pressed={inBag}
                style={{ display: 'grid', justifyItems: 'center', gap: '2px', background: 'transparent', border: 'none', padding: '2px', cursor: 'pointer' }}
              >
                <span aria-hidden="true" style={{ fontSize: '24px', lineHeight: 1, filter: 'drop-shadow(0 1px 4px rgba(0,0,0,0.85))' }}>
                  {inBag ? '✅' : '🛍️'}
                </span>
                <span style={railLabel}>{inBag ? 'In bag' : 'Bag'}</span>
              </button>

              <button
                onClick={() => setDetailsProduct(p)}
                aria-label={`Ask about ${p.name}`}
                style={{ display: 'grid', justifyItems: 'center', gap: '2px', background: 'transparent', border: 'none', padding: '2px', cursor: 'pointer' }}
              >
                <span aria-hidden="true" style={{ fontSize: '24px', lineHeight: 1, filter: 'drop-shadow(0 1px 4px rgba(0,0,0,0.85))' }}>💬</span>
                <span style={railLabel}>Ask</span>
              </button>
            </div>
          </article>
        )
      })}

      {/* The end of what we have loaded — a pixel tall, watched, so scrolling past the last screen
          asks for the next page instead of stopping dead. */}
      {hasMore && items.length > 0 && <div ref={endRef} aria-hidden="true" style={{ height: '1px' }} />}

      {/* The details sheet — the whole product, and Buy, without leaving the channel. It is the same
          component Browse opens, so a product behaves identically in both places. */}
      {detailsProduct && (
        <ProductSheet
          key={detailsProduct.id}
          product={detailsProduct}
          surface="shoppertainment"
          liked={isLiked(detailsProduct.id)}
          likeCount={likeCountFor(detailsProduct)}
          onToggleLike={() => handleToggleLike(detailsProduct)}
          isMine={detailsProduct.sellerId === uid}
          inBag={isInBag(detailsProduct.id)}
          onClose={() => setDetailsProduct(null)}
          onBuy={(variant, qty) => {
            setOrderVariant(variant)
            setSheetQty(String(qty))
            setOrderProduct(detailsProduct)
            setDetailsProduct(null)
          }}
          onMessage={(variant) => {
            setMessageVariant(variant)
            setMessageProduct(detailsProduct)
            setDetailsProduct(null)
          }}
          onToggleBag={(variant, qty) => handleSheetBag(detailsProduct, variant, qty)}
          onOpenStore={() => {
            const slug = detailsProduct.sellerSlug
            setDetailsProduct(null)
            navigate(`/store/${slug}`)
          }}
        />
      )}

      {/* Request and message, the market's own two forms — mounted only while they are open. */}
      <ProductActions
        key={`${orderProduct?.id || 'none'}-${sheetQty}`}
        orderProduct={orderProduct}
        messageProduct={messageProduct}
        orderVariant={orderVariant}
        messageVariant={messageVariant}
        orderQuantity={sheetQty}
        onCloseOrder={() => setOrderProduct(null)}
        onCloseMessage={() => setMessageProduct(null)}
        surface="shoppertainment"
      />
    </div>
  )
}

export default ShoppertainmentPage
