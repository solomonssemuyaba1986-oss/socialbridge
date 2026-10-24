import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db } from './firebase'
import { useBag } from './useBag'
import { useSellerLive } from './sellerLive'
import FloatingBag from './FloatingBag'
import { requireSignIn } from './signInGate'
import { sendConversationMessage } from './useConversation'
import ProductCard from './ProductCard'
import ProductPreview from './ProductPreview'
import SearchBar from './SearchBar'
import LoadingBanner from './LoadingBanner'
import { useProductFeed } from './useProductFeed'
import { useProductLikes } from './useProductLikes'
import { useSellerDirectory } from './useSellerDirectory'
import { useDemographics } from './useDemographics'
import { rankUnknown, unknownCohortLine, UNKNOWN_TITLE, UNKNOWN_BLURB } from './unknownFeed'
import type { CardProduct } from './productCardUtils'

const green = '#adff2f'

/** The buyer's own search history, kept on their device (never in the database). */
function recentSearches(userId: string | null): string[] {
  try {
    const raw = localStorage.getItem(`rachett_recent_searches_${userId || 'guest'}`)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter((item: unknown): item is string => typeof item === 'string').slice(0, 5)
      : []
  } catch {
    return []
  }
}

/**
 * The buyer's home — **Unknown**, the discovery shelf that gives the market a front door.
 *
 * Buyers used to have nowhere to land: `/` sent every signed-in non-seller back to
 * "What brings you here?", and the only door to the market was a Browse button that
 * lived nowhere in the nav. This is that home, and it works for guests too.
 *
 * Unknown is deliberately not called Discover: it is the shelf of things you did not know you
 * wanted, mixed mostly from the age bracket before yours and the one after (`unknownFeed.ts`).
 * The quick tiles and the rest of the buyer's doors sit underneath it, so the page is useful as a
 * home and not only as a feed.
 */
function BuyerHome() {
  const navigate = useNavigate()
  const bag = useBag()
  const { count: bagCount } = bag
  const { unreadMessages, unreadBuyerConvo } = useSellerLive()
  const user = auth.currentUser
  const { isLiked, likeCountFor, toggleLike } = useProductLikes()
  const { products, loading: feedLoading } = useProductFeed({ pageSize: 24 })
  const directory = useSellerDirectory(true)
  const demographics = useDemographics()
  const [query, setQuery] = useState('')
  const [preview, setPreview] = useState<{ images: string[]; index: number } | null>(null)

  const [hasShop, setHasShop] = useState(false)
  const firstName = (user?.displayName || '').trim().split(/\s+/)[0] || ''
  const searches = recentSearches(user?.uid || null)
  const unread = unreadMessages + unreadBuyerConvo
  /** Anonymous accounts count as logged out — the inbox needs a real account. */
  const isGuest = !user || user.isAnonymous

  /** The inbox is the one thing a guest can't have yet, so it asks nicely. */
  const openInbox = () => {
    if (isGuest) {
      requireSignIn(navigate, { action: 'inbox', returnTo: '/inbox' })
      return
    }
    navigate('/inbox')
  }

  /** Orders need a real account — a guest is asked once and returned straight here. */
  const openOrders = () => {
    if (isGuest) {
      requireSignIn(navigate, { action: 'inbox', returnTo: '/my-orders' })
      return
    }
    navigate('/my-orders')
  }

  // Sellers who wander in here get pointed at their own panel instead.
  useEffect(() => {
    const uid = auth.currentUser?.uid
    if (!uid) return
    let cancelled = false
    getDoc(doc(db, 'sellers', uid))
      .then(snap => { if (!cancelled) setHasShop(snap.exists()) })
      .catch(() => { /* offline — just show the buyer version */ })
    return () => { cancelled = true }
  }, [])

  const tile = (icon: string, label: string, badge: number, onClick: () => void) => (
    <button key={label} onClick={onClick}
      style={{ flex: '1 1 30%', minWidth: '92px', background: '#1a1a1a', border: '1px solid #262626', borderRadius: '14px', padding: '16px 10px', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', position: 'relative' }}>
      <span style={{ fontSize: '22px' }}>{icon}</span>
      <span style={{ fontSize: '12px', color: '#ddd', fontWeight: 700, textAlign: 'center' }}>{label}</span>
      {badge > 0 && (
        <span style={{ position: 'absolute', top: '8px', right: '8px', background: green, color: '#000', borderRadius: '999px', minWidth: '20px', height: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 900, padding: '0 5px', boxSizing: 'border-box' }}>
          {badge}
        </span>
      )}
    </button>
  )

  const ageBand = demographics.state.ageBand
  const cohortLine = unknownCohortLine(ageBand)

  /**
   * The catalog feed carries product documents; the shop's name and slug live on the seller
   * document. The directory is already cached for Nearby and the empty bag, so this joins the rows
   * without another read. A row whose shop cannot be identified is left out rather than shown as a
   * card that cannot be opened.
   */
  const homeRows = useMemo<CardProduct[]>(() => {
    return products
      .map(row => {
        const shop = directory.stores.get(row.sellerId)
        return {
          ...(row as unknown as CardProduct),
          sellerId: row.sellerId,
          sellerSlug: String(row.sellerSlug || shop?.slug || ''),
          businessName: String(row.businessName || shop?.businessName || ''),
        }
      })
      .filter(row => row.sellerSlug && row.name)
  }, [products, directory])

  const unknownRows = useMemo(
    () => rankUnknown(homeRows, ageBand).slice(0, 12),
    [homeRows, ageBand],
  )

  const openStore = (p: CardProduct) => {
    navigate(`/store/${p.sellerSlug}?productId=${encodeURIComponent(p.id)}`)
  }

  const toggleHomeBag = (p: CardProduct) => {
    if (bag.isInBag(p.id)) {
      bag.removeFromBag(p.id)
      return
    }
    bag.addToBag({
      productId: p.id,
      productName: p.name,
      productPrice: p.price,
      imageUrl: p.imageUrl,
      images: p.images?.length ? p.images : (p.imageUrl ? [p.imageUrl] : []),
      sellerSlug: p.sellerSlug,
      sellerId: p.sellerId,
      businessName: p.businessName,
    })
  }

  const notifyHomeProduct = async (p: CardProduct) => {
    const uid = auth.currentUser?.uid
    if (!uid || auth.currentUser?.isAnonymous) {
      requireSignIn(navigate, { action: 'message', returnTo: '/home', productId: p.id, sellerSlug: p.sellerSlug })
      return
    }
    if (p.sellerId === uid) return
    try {
      await sendConversationMessage(
        p.sellerId,
        uid,
        uid,
        `🔔 Please notify me when “${p.name}” is back in stock.`,
        p.businessName || 'Seller',
        user?.displayName || 'Buyer',
        { productId: p.id, productName: p.name, productPrice: p.price, productImage: p.imageUrl },
      )
      alert(`🔔 Done — ${p.businessName || 'the seller'} has been told you want “${p.name}”. Their reply will be in your Inbox.`)
    } catch (err) {
      console.error('Notify-if-back error:', err)
      alert('Could not send that request. Please try again.')
    }
  }

  const likeHomeProduct = (p: CardProduct) => {
    void toggleLike({
      sellerId: p.sellerId,
      productId: p.id,
      currentCount: likeCountFor(p),
      surface: 'home',
    }).then(result => {
      if (result.needsSignIn) {
        requireSignIn(navigate, { action: 'like', returnTo: '/home', productId: p.id, sellerSlug: p.sellerSlug })
      }
    })
  }

  return (
    <div className="rt-page rt-has-tabs" style={{ minHeight: '100vh', background: '#0f0f0f', fontFamily: 'sans-serif', color: '#fff' }}>
      <div style={{ maxWidth: '640px', margin: '0 auto', padding: '20px 16px 40px' }}>

        {/* ── Unknown: the home page ────────────────────────────────────────────────────────
            Not "Discover". Unknown is the honest name for the shelf you did not search for:
            the prior age bracket's taste, the next one's horizon, and a little of your own. */}
        <section style={{ background: 'linear-gradient(145deg, #14210d 0%, #101010 62%)', border: '1px solid #26331c', borderRadius: 20, padding: '22px 18px', marginBottom: 18 }}>
          <p style={{ margin: '0 0 6px', color: green, fontSize: 11, fontWeight: 900, letterSpacing: '1.6px', textTransform: 'uppercase' }}>
            {UNKNOWN_TITLE} · your home shelf
          </p>
          <h1 style={{ margin: '0 0 8px', fontSize: 28, fontWeight: 900, letterSpacing: '-0.8px', lineHeight: 1.08 }}>
            {firstName ? `Hi ${firstName}. ` : ''}Things you didn't know you wanted.
          </h1>
          <p style={{ margin: '0 0 8px', color: '#b9c3b2', fontSize: 14, lineHeight: 1.55 }}>{UNKNOWN_BLURB}</p>
          <p style={{ margin: '0 0 16px', color: '#7e8a76', fontSize: 12.5, lineHeight: 1.55 }}>{cohortLine}</p>

          <SearchBar
            value={query}
            onChange={setQuery}
            placeholder="Search products, stores, categories…"
            onSearch={() => { if (query.trim()) navigate(`/browse?q=${encodeURIComponent(query.trim())}`) }}
            emptyHint="Type a product, a shop or a category"
          />

          <button onClick={() => navigate('/browse')}
            style={{ width: '100%', marginTop: 10, padding: '13px 16px', background: green, color: '#000', border: 'none', borderRadius: 12, fontWeight: 800, cursor: 'pointer', fontSize: 14 }}>
            Browse the whole market →
          </button>
        </section>

        {/* Why rachett — short enough to read, concrete enough to mean something. */}
        <section style={{ background: '#141414', border: '1px solid #242424', borderRadius: 16, padding: '16px 16px 14px', marginBottom: 14 }}>
          <h2 style={{ margin: '0 0 7px', fontSize: 16, fontWeight: 800 }}>Why rachett?</h2>
          <p style={{ margin: '0 0 9px', color: '#aaa', fontSize: 13, lineHeight: 1.6 }}>
            Rachett is the social marketplace where shopping stays a conversation. Find a real shop,
            ask the seller a question, pay from the chat and keep the whole order in one thread — no
            screenshots, no lost DMs, no “send me your number”.
          </p>
          <p style={{ margin: 0, color: '#cfe3c2', fontSize: 13, lineHeight: 1.6, fontWeight: 600 }}>
            No matter the size of your company, your brand or your following, your shop deserves a
            front door. One person with a phone and a warehouse with a loading bay get the same shelf.
          </p>
        </section>

        <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
          {tile('📍', 'Nearby', 0, () => navigate('/nearby'))}
          {tile('🛍️', 'My Bag', bagCount, () => navigate('/bag'))}
          {tile('📩', 'Inbox', unread, openInbox)}
        </div>

        {/* The shelf itself. Twelve is enough to feel curated; the full market is one tap away. */}
        <section style={{ marginBottom: 22 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 900 }}>The Unknown shelf</h2>
              <p style={{ margin: '3px 0 0', color: '#777', fontSize: 12 }}>{cohortLine}</p>
            </div>
            <button onClick={() => navigate('/browse')}
              style={{ background: 'none', border: 'none', color: green, fontWeight: 800, cursor: 'pointer', fontSize: 12, whiteSpace: 'nowrap' }}>
              See all →
            </button>
          </div>

          {feedLoading && unknownRows.length === 0 ? (
            <LoadingBanner message="Finding things you didn't know you wanted…" />
          ) : unknownRows.length === 0 ? (
            <p style={{ color: '#777', fontSize: 13, margin: '8px 0 0' }}>
              The shelf is still filling up. Browse the market while sellers add their first products.
            </p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 }}>
              {unknownRows.map(product => {
                const inBag = bag.isInBag(product.id)
                return (
                  <ProductCard
                    key={product.id}
                    p={product}
                    surface="home"
                    inBag={inBag}
                    bagged={0}
                    isMine={Boolean(user?.uid && product.sellerId === user.uid)}
                    liked={isLiked(product.id)}
                    likeCount={likeCountFor(product)}
                    onToggleLike={() => likeHomeProduct(product)}
                    onOpen={() => openStore(product)}
                    onPreview={() => setPreview({
                      images: product.images?.length ? product.images : (product.imageUrl ? [product.imageUrl] : []),
                      index: 0,
                    })}
                    onDetails={() => openStore(product)}
                    onToggleBag={() => toggleHomeBag(product)}
                    onMessage={() => openStore(product)}
                    onOrder={() => openStore(product)}
                    onNotifyBack={() => void notifyHomeProduct(product)}
                  />
                )
              })}
            </div>
          )}
        </section>

        {searches.length > 0 && (
          <>
            <p style={{ margin: '0 0 8px', color: '#666', fontSize: '12px', fontWeight: '700', letterSpacing: '0.3px' }}>PICK UP WHERE YOU LEFT OFF</p>
            <div className="rt-filters" style={{ display: 'flex', gap: '8px', overflowX: 'auto', marginBottom: '20px', paddingBottom: '2px' }}>
              {searches.map(term => (
                <button key={term} onClick={() => navigate(`/browse?q=${encodeURIComponent(term)}`)}
                  style={{ padding: '8px 14px', borderRadius: '999px', border: '1px solid #333', background: '#1a1a1a', color: '#ccc', fontWeight: '600', fontSize: '13px', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
                  🔎 {term}
                </button>
              ))}
            </div>
          </>
        )}

        <button onClick={openOrders}
          style={{ width: '100%', padding: '14px 16px', background: '#1a1a1a', border: '1px solid #262626', borderRadius: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px', textAlign: 'left' }}>
          <span style={{ fontSize: '20px' }}>📦</span>
          <span style={{ flex: 1 }}>
            <span style={{ display: 'block', color: '#fff', fontWeight: 700, fontSize: '14px' }}>My Orders</span>
            <span style={{ display: 'block', color: '#777', fontSize: '12px', marginTop: '2px' }}>See everything you've ordered — and whether it has arrived</span>
          </span>
          <span style={{ color: '#555' }}>→</span>
        </button>

        <button onClick={() => navigate('/profile')}
          style={{ width: '100%', padding: '14px 16px', background: '#1a1a1a', border: '1px solid #262626', borderRadius: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px', textAlign: 'left' }}>
          <span style={{ fontSize: '20px' }}>👤</span>
          <span style={{ flex: 1 }}>
            <span style={{ display: 'block', color: '#fff', fontWeight: 700, fontSize: '14px' }}>Your profile</span>
            <span style={{ display: 'block', color: '#777', fontSize: '12px', marginTop: '2px' }}>The name sellers see, what we keep, and how to sign out</span>
          </span>
          <span style={{ color: '#555' }}>→</span>
        </button>

        <button onClick={() => navigate(hasShop ? '/dashboard' : '/setup')}
          style={{ width: '100%', padding: '14px 16px', background: '#12210d', border: `1px solid ${green}`, borderRadius: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '12px', textAlign: 'left' }}>
          <span style={{ fontSize: '20px' }}>🏪</span>
          <span style={{ flex: 1 }}>
            <span style={{ display: 'block', color: green, fontWeight: 800, fontSize: '14px' }}>
              {hasShop ? 'Manage my store' : 'Selling on WhatsApp? Open your own shop'}
            </span>
            <span style={{ display: 'block', color: '#8aa87f', fontSize: '12px', marginTop: '2px' }}>
              {hasShop ? 'Products, orders and analytics' : 'One link, and orders stop getting lost in your DMs'}
            </span>
          </span>
          <span style={{ color: green }}>→</span>
        </button>

      </div>

      {preview && preview.images.length > 0 && (
        <ProductPreview
          images={preview.images}
          startIndex={preview.index}
          onClose={() => setPreview(null)}
        />
      )}

      <FloatingBag count={bagCount} />
    </div>
  )
}

export default BuyerHome
