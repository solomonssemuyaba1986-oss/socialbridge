/**
 * Marketing — the seller's "how do I sell more" page, built to be read in ten seconds.
 *
 * The order is the advice: one number at the top, one button that says what to do next, then the
 * three things that actually move stock (share the shop, print the QR, share one product), then the
 * five places to put a caption, then the table that says which product to push next.
 *
 * Two honesty rules decide most of what is here:
 *   • every number comes from something rachett really has — store visits from `visits/`, opens from
 *     `productViews/`, bags from `bagCounts/`, likes and orders off the product document. Nothing is
 *     estimated, interpolated or projected.
 *   • "Create an offer" is a real feature nobody has built yet, so it ships as a card that says
 *     **Planned** rather than a button that pretends.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, doc, getDoc, getDocs } from 'firebase/firestore'
import { onAuthStateChanged } from 'firebase/auth'
import { auth, db } from './firebase'
import Sidebar from './Sidebar'
import SellerTabs from './SellerTabs'
import StoreQrCard from './StoreQrCard'
import { fetchProductViews } from './productViews'
import { getBagCounts, type BagCountData } from './useBag'
import {
  emptyTableLine,
  insightFor,
  interestRows,
  nextStep,
  noProductsState,
  productCaption,
  productLink,
  promoteCards,
  shareTargets,
  storeCaption,
  storeLink,
  visitSummary,
  visitsLine,
  type InterestRow,
  type MarketingProduct,
  type PromoteCard,
  type ShareTarget,
} from './marketing'
import { canNativeShare, copyProductLink, copyStoreLink, copyText, markMarketingOpened, markPromoteUsed, markShared, shareLink } from './shareStore'
import { notify } from './notifications'

const green = '#adff2f'

interface SellerInfo {
  businessName: string
  slug: string
  logoUrl?: string
}

function StatChip({ icon, value, label }: { icon: string; value: number; label: string }) {
  return (
    <span
      title={label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        background: '#111',
        border: '1px solid #222',
        borderRadius: 999,
        padding: '3px 9px',
        fontSize: 12,
        fontWeight: 700,
        color: value > 0 ? '#fff' : '#555',
        whiteSpace: 'nowrap',
      }}>
      <span aria-hidden="true">{icon}</span>
      {value}
      <span style={{ color: '#666', fontWeight: 600 }}>{label}</span>
    </span>
  )
}

/** One row of share buttons — the same six everywhere, because the advice should not change. */
function ShareRow({ targets, onCopy, onNative, onChannel, busy }: {
  targets: ShareTarget[]
  onCopy: () => void
  onNative: (() => void) | null
  onChannel: (channel: string) => void
  busy?: boolean
}) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {onNative && (
        <button
          type="button"
          onClick={onNative}
          disabled={busy}
          style={{ padding: '10px 14px', borderRadius: 999, border: 'none', background: green, color: '#000', fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>
          📤 Share
        </button>
      )}
      {targets.map(target => (
        target.href
          ? (
            <a
              key={target.channel}
              href={target.href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => onChannel(target.channel)}
              style={{ padding: '10px 14px', borderRadius: 999, border: '1px solid #222', background: '#111', color: '#fff', fontWeight: 700, fontSize: 13, textDecoration: 'none' }}>
              {target.icon} {target.label}
            </a>
          )
          : (
            <button
              key={target.channel}
              type="button"
              onClick={onCopy}
              style={{ padding: '10px 14px', borderRadius: 999, border: '1px solid #222', background: '#111', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
              {target.icon} {target.label}
            </button>
          )
      ))}
    </div>
  )
}

/** A section with the one heading style this page uses. */
function Section({ id, title, hint, children }: { id: string; title: string; hint?: string; children: ReactNode }) {
  return (
    <section id={id} style={{ marginBottom: 32 }}>
      <h2 style={{ fontSize: 18, fontWeight: 800, margin: '0 0 4px' }}>{title}</h2>
      {hint && <p style={{ margin: '0 0 14px', color: '#888', fontSize: 13 }}>{hint}</p>}
      {children}
    </section>
  )
}

function Marketing() {
  const navigate = useNavigate()
  const [uid, setUid] = useState('')
  const [seller, setSeller] = useState<SellerInfo | null>(null)
  const [products, setProducts] = useState<MarketingProduct[]>([])
  const [bagCounts, setBagCounts] = useState<Record<string, BagCountData>>({})
  const [views, setViews] = useState<Record<string, number>>({})
  const [visits, setVisits] = useState<Array<{ createdAt?: unknown }>>([])
  const [selectedId, setSelectedId] = useState('')
  const [loading, setLoading] = useState(true)
  const opened = useRef(false)
  /** One clock for the whole page, so "today" cannot mean two different things in one render. */
  const [now] = useState(() => Date.now())

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async user => {
      if (!user) {
        navigate('/')
        return
      }
      try {
        setUid(user.uid)
        const [sellerSnap, productsSnap, visitsSnap] = await Promise.all([
          getDoc(doc(db, 'sellers', user.uid)),
          getDocs(collection(db, 'sellers', user.uid, 'products')),
          getDocs(collection(db, 'sellers', user.uid, 'visits')),
        ])
        const data = sellerSnap.exists() ? sellerSnap.data() : {}
        setSeller({
          businessName: String(data.businessName || 'Your store'),
          slug: String(data.slug || ''),
          logoUrl: String(data.logoUrl || ''),
        })
        const list = productsSnap.docs.map<MarketingProduct>(product => {
          const d = product.data()
          return {
            id: product.id,
            name: String(d.name || ''),
            price: String(d.price || ''),
            imageUrl: typeof d.imageUrl === 'string' ? d.imageUrl : '',
            images: Array.isArray(d.images) ? d.images.filter((url: unknown) => typeof url === 'string') : [],
            likeCount: Number(d.likeCount) || 0,
            orderCount: Number(d.orderCount) || 0,
            reviewCount: Number(d.reviewCount) || 0,
            reviewScoreSum: Number(d.reviewScoreSum) || 0,
          }
        })
        setProducts(list)
        setVisits(visitsSnap.docs.map(visit => ({ createdAt: visit.data().createdAt })))

        const ids = list.map(product => product.id)
        if (ids.length > 0) {
          const [bags, viewCounts] = await Promise.all([getBagCounts(ids), fetchProductViews(ids)])
          setBagCounts(bags)
          setViews(viewCounts)
        }
        if (!opened.current) {
          opened.current = true
          markMarketingOpened(list.length)
        }
      } catch (err) {
        console.error('Marketing load failed:', err)
      } finally {
        setLoading(false)
      }
    })
    return unsubscribe
  }, [navigate])

  const businessName = seller?.businessName || 'Your store'
  const slug = seller?.slug || ''
  const origin = window.location.origin
  const shopLink = slug ? storeLink(origin, slug) : ''

  const rows = useMemo(() => interestRows({ products, bagCounts, views }), [products, bagCounts, views])
  const summary = useMemo(() => visitSummary(visits, now), [visits, now])
  const totalOrders = useMemo(() => rows.reduce((sum, row) => sum + row.orders, 0), [rows])
  const step = nextStep({ productCount: products.length, visits: summary.week, orders: totalOrders })

  const selected = useMemo(
    () => rows.find(row => row.id === selectedId) || rows[0] || null,
    [rows, selectedId],
  )
  const productUrl = selected ? productLink(origin, slug, selected.id) : ''

  const storeTargets = useMemo(() => shareTargets(shopLink, storeCaption(businessName)), [shopLink, businessName])
  const productTargets = useMemo(
    () => (selected ? shareTargets(productUrl, productCaption(selected.name, selected.price, businessName)) : []),
    [productUrl, selected, businessName],
  )

  const scrollTo = useCallback((id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  const goToStep = useCallback(() => {
    if (step.to.startsWith('#')) scrollTo(step.to.slice(1))
    else navigate(step.to)
  }, [navigate, scrollTo, step.to])

  const shareShop = useCallback(() => {
    if (!shopLink) return
    void shareLink({ sellerId: uid, link: shopLink, text: storeCaption(businessName), surface: 'marketing' })
  }, [businessName, shopLink, uid])

  const copyShop = useCallback(() => {
    if (!shopLink) return
    void copyStoreLink({ sellerId: uid, link: shopLink, surface: 'marketing' })
  }, [shopLink, uid])

  const shareOne = useCallback(() => {
    if (!selected || !productUrl) return
    void shareLink({
      sellerId: uid,
      link: productUrl,
      text: productCaption(selected.name, selected.price, businessName),
      surface: 'marketing',
      productId: selected.id,
    })
  }, [businessName, productUrl, selected, uid])

  const copyOne = useCallback(() => {
    if (!selected || !productUrl) return
    void copyProductLink({ productId: selected.id, sellerId: uid, link: productUrl, surface: 'marketing' })
  }, [productUrl, selected, uid])

  const copyCaption = useCallback(async (card: PromoteCard) => {
    const copied = await copyText(card.caption)
    markPromoteUsed(card.id, 'marketing')
    alert(copied ? notify.captionCopied : notify.copyFailed)
  }, [])

  const pushProduct = useCallback((row: InterestRow) => {
    setSelectedId(row.id)
    scrollTo('share-product')
  }, [scrollTo])

  if (loading) {
    return (
      <div className="rt-page" style={{ minHeight: '100vh', background: '#0f0f0f', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: '#555', fontFamily: 'sans-serif' }}>Loading your marketing page...</p>
      </div>
    )
  }

  const nothingYet = noProductsState()
  const native = canNativeShare()
  const cards = promoteCards(businessName, shopLink)

  return (
    <div className="rt-page rt-shell" style={{ minHeight: '100vh', background: '#0f0f0f', fontFamily: 'sans-serif', color: '#fff', display: 'flex' }}>
      <Sidebar />
      {/* The phone's navigation — same five places, same badges, hidden on desktop by CSS. */}
      <SellerTabs />

      <div className="rt-main rt-has-tabs" style={{ width: '100%', marginLeft: 260, padding: '24px 28px', minHeight: '100vh' }}>

        {/* ── The hero: one number, one sentence, one button ─────────────────────────────── */}
        <div style={{ background: 'linear-gradient(135deg, #111 0%, #0a1a0a 100%)', borderRadius: 16, padding: '22px 24px', border: '1px solid #1a2a1a', marginBottom: 28 }}>
          <p style={{ margin: '0 0 4px', fontSize: 12, color: '#666', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600 }}>📣 Marketing</p>
          <p className="rt-big" style={{ margin: '0 0 2px', fontSize: 40, fontWeight: 900, color: green, letterSpacing: -1, lineHeight: 1.1 }}>
            {summary.week}
          </p>
          <p style={{ margin: '0 0 4px', fontSize: 14, color: '#ccc' }}>{visitsLine(summary)}</p>
          <p style={{ margin: '0 0 16px', fontSize: 12, color: '#777' }}>
            {summary.today} today · {summary.total} all time · {totalOrders} orders on your products
          </p>
          <button
            type="button"
            onClick={goToStep}
            style={{ padding: '14px 20px', borderRadius: 12, border: 'none', background: green, color: '#000', fontWeight: 800, fontSize: 15, cursor: 'pointer' }}>
            {step.label} →
          </button>
        </div>

        {/* ── Share your store ──────────────────────────────────────────────────────────── */}
        <Section id="share-store" title="🔗 Share your store" hint="Paste this link anywhere you have an audience.">
          <div style={{ background: '#1a1a1a', border: '1px solid #222', borderRadius: 16, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{
              background: '#111', border: '1px solid #222', borderRadius: 12, padding: '12px 14px',
              fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 13, color: '#ddd', wordBreak: 'break-all', userSelect: 'all',
            }}>
              {shopLink || 'Your store link appears once your shop has a name.'}
            </div>
            <p style={{ margin: 0, color: '#777', fontSize: 12, fontStyle: 'italic' }}>{storeCaption(businessName)}</p>
            <ShareRow
              targets={storeTargets}
              onCopy={copyShop}
              onNative={native ? shareShop : null}
              onChannel={channel => markShared({ sellerId: uid, channel, surface: 'marketing' })}
            />
          </div>
        </Section>

        {/* ── Your QR ──────────────────────────────────────────────────────────────────── */}
        <Section id="your-qr" title="🧾 Your QR code" hint="Print it and tape it on every parcel you send.">
          {shopLink
            ? <StoreQrCard sellerId={uid} businessName={businessName} slug={slug} link={shopLink} size={220} />
            : <p style={{ color: '#888', fontSize: 13 }}>Name your shop first — the QR code needs a link to open.</p>}
        </Section>

        {/* ── Share a product ──────────────────────────────────────────────────────────── */}
        <Section id="share-product" title="🛍️ Share a product" hint="This link opens your shop on that one product.">
          {products.length === 0 ? (
            <div style={{ background: '#1a1a1a', border: '1px dashed #333', borderRadius: 16, padding: 20, textAlign: 'center' }}>
              <p style={{ margin: '0 0 6px', fontWeight: 700 }}>{nothingYet.title}</p>
              <p style={{ margin: '0 0 14px', color: '#888', fontSize: 13 }}>{nothingYet.body}</p>
              <button
                type="button"
                onClick={() => navigate('/products')}
                style={{ padding: '12px 18px', borderRadius: 12, border: 'none', background: green, color: '#000', fontWeight: 800, fontSize: 14, cursor: 'pointer' }}>
                {nothingYet.action} →
              </button>
            </div>
          ) : (
            <div style={{ background: '#1a1a1a', border: '1px solid #222', borderRadius: 16, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <select
                value={selected?.id || ''}
                onChange={event => setSelectedId(event.target.value)}
                style={{ width: '100%', padding: '12px 14px', borderRadius: 12, border: '1px solid #222', background: '#111', color: '#fff', fontSize: 14, fontWeight: 600 }}>
                {rows.map(row => (
                  <option key={row.id} value={row.id}>
                    {row.name}{row.price ? ` — ${row.price}` : ''}
                  </option>
                ))}
              </select>
              <div style={{
                background: '#111', border: '1px solid #222', borderRadius: 12, padding: '12px 14px',
                fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 13, color: '#ddd', wordBreak: 'break-all', userSelect: 'all',
              }}>
                {productUrl}
              </div>
              {selected && (
                <p style={{ margin: 0, color: '#777', fontSize: 12, fontStyle: 'italic' }}>
                  {productCaption(selected.name, selected.price, businessName)}
                </p>
              )}
              <ShareRow
                targets={productTargets}
                onCopy={copyOne}
                onNative={native ? shareOne : null}
                onChannel={channel => markShared({ sellerId: uid, channel, surface: 'marketing', productId: selected?.id })}
              />
              {selected && (
                <StoreQrCard
                  compact
                  sellerId={uid}
                  businessName={businessName}
                  slug={slug}
                  link={productUrl}
                  productName={selected.name}
                  label={`Scan to open ${selected.name}`}
                  size={168}
                />
              )}
            </div>
          )}
        </Section>

        {/* ── Promote cards ────────────────────────────────────────────────────────────── */}
        <Section id="promote" title="📣 Where to put it" hint="Tap a card to copy the caption, link and all.">
          <div style={{ display: 'grid', gap: 12 }}>
            {cards.map(card => (
              <button
                key={card.id}
                type="button"
                onClick={() => void copyCaption(card)}
                style={{
                  textAlign: 'left', background: '#1a1a1a', border: '1px solid #222', borderRadius: 14,
                  padding: 14, cursor: 'pointer', color: '#fff', display: 'flex', gap: 12, alignItems: 'flex-start',
                }}>
                <span style={{ fontSize: 20 }} aria-hidden="true">{card.icon}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontWeight: 700, fontSize: 14 }}>{card.title}</span>
                  <span style={{ display: 'block', color: '#888', fontSize: 12, marginTop: 2 }}>{card.why}</span>
                  <span style={{ display: 'block', color: '#666', fontSize: 11, marginTop: 6 }}>📋 Tap to copy the caption</span>
                </span>
              </button>
            ))}
          </div>
        </Section>

        {/* ── Offers: honest about not existing yet ────────────────────────────────────── */}
        <Section id="offers" title="🎁 Create an offer">
          <div style={{ background: '#1a1a1a', border: '1px dashed #333', borderRadius: 16, padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <span style={{ background: '#222', color: '#aaa', fontSize: 11, fontWeight: 800, padding: '2px 8px', borderRadius: 999, textTransform: 'uppercase', letterSpacing: 1 }}>
                Planned
              </span>
              <span style={{ color: '#888', fontSize: 13 }}>Not built yet</span>
            </div>
            <p style={{ margin: 0, color: '#888', fontSize: 13 }}>
              Discounts, bundles and “buy 2 get 1”. Nothing on this page pretends it works — when it ships, it will live here.
            </p>
          </div>
        </Section>

        {/* ── What's working ───────────────────────────────────────────────────────────── */}
        <Section id="whats-working" title="📊 What's working" hint="Sorted by orders, then bags, then likes. Tap a product to share it.">
          {rows.length === 0 ? (
            <div style={{ background: '#1a1a1a', border: '1px dashed #333', borderRadius: 16, padding: 20, textAlign: 'center', color: '#888', fontSize: 13 }}>
              {emptyTableLine()}
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              {rows.map(row => (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => pushProduct(row)}
                  style={{
                    textAlign: 'left', background: '#1a1a1a', border: '1px solid #222', borderRadius: 14,
                    padding: 12, cursor: 'pointer', color: '#fff', display: 'flex', gap: 12, alignItems: 'center',
                  }}>
                  {row.image
                    ? <img src={row.image} alt="" style={{ width: 44, height: 44, borderRadius: 10, objectFit: 'cover', flexShrink: 0 }} />
                    : <span style={{ width: 44, height: 44, borderRadius: 10, background: '#222', flexShrink: 0 }} />}
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontWeight: 700, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {row.name}
                    </span>
                    {row.price && <span style={{ display: 'block', color: green, fontSize: 12, fontWeight: 700 }}>{row.price}</span>}
                    <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                      <StatChip icon="👀" value={row.opens} label="opens" />
                      <StatChip icon="🛍️" value={row.bags} label="bags" />
                      <StatChip icon="♥" value={row.likes} label="likes" />
                      <StatChip icon="🧾" value={row.orders} label="orders" />
                    </span>
                    <span style={{ display: 'block', color: '#888', fontSize: 12, marginTop: 6 }}>{insightFor(row)}</span>
                  </span>
                  <span style={{ color: '#555', fontSize: 12, flexShrink: 0 }}>Share →</span>
                </button>
              ))}
            </div>
          )}
        </Section>

      </div>
    </div>
  )
}

export default Marketing
