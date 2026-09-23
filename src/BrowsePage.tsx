import { useEffect, useState, useMemo, useRef, useCallback, type ChangeEvent } from 'react'
import { collection, getDocs, doc, getDoc } from 'firebase/firestore'
import { onAuthStateChanged } from 'firebase/auth'
import { db, auth } from './firebase'
import { useNavigate } from 'react-router-dom'
import { detectSource } from './tracking'
import { trackEvent } from './analytics'
import { IMPRESSION_ATTR, IMPRESSION_SELLER_ATTR, observeImpressions } from './analytics/impressions'
import { useBag, getBagCounts, type BagCountData } from './useBag'
import { createBuyerOrder, incrementProductOrderCount, createOrderConversation } from './createBuyerOrder'
import QuickRepliesPanel from './QuickRepliesPanel'
import { getMainCategories } from './categories'
import LoadingScreen from './LoadingScreen'
import { avatarColor, initialOf } from './avatar'
import ProductSheet from './ProductSheet'
import { variantLabel, type Variant } from './productSheetUtils'
import { useBuyerName } from './useBuyerName'
import { nameLabel } from './buyerName'
import { useDraft } from './useDraft'
import { uploadImageToCloudinary } from './uploadImage'
import { getConversationId, sendConversationMessage } from './useConversation'
import { notify } from './notifications'
import { consumePendingAction, requireSignIn } from './signInGate'
import SignInPrompt from './SignInPrompt'
import FloatingBag from './FloatingBag'
import { formatCount, toMillis } from './productCardUtils'
import { useProductLikes } from './useProductLikes'
import LikePill from './LikePill'
import SearchBar from './SearchBar'
import { useRotatingPlaceholder } from './useRotatingPlaceholder'
import { useProductFeed } from './useProductFeed'
import StoreCard from './StoreCard'
import Fuse from 'fuse.js'
import SearchSuggest from './SearchSuggest'
import { buildSuggestions, type Suggestion } from './useSuggestions'

interface Product {
  id: string
  name: string
  price: string
  description: string
  imageUrl: string
  images?: string[]
  sellerSlug: string
  sellerId: string
  businessName: string
  category?: string
  subCategory?: string
  outOfStock?: boolean
  orderCount?: number
  salesCount?: number
  /** ♥ The universal like tally — the same number for every visitor. */
  likeCount?: number
  createdAt?: unknown
  updatedAt?: unknown
}

const categories = ['All', ...getMainCategories()]
const green = '#adff2f'
/** How many stores the directory shows before "Show all". */
const STORE_DIRECTORY_LIMIT = 12
/** How many matching-store cards the search panel shows (the count is always the full total). */
const STORE_MATCH_LIMIT = 6

function BrowsePage() {
  // The catalog feed: one paged query instead of reading every store's products.
  // (The old per-store walk silently capped Browse at the first 50 stores, in
  // document-ID order, and cost 51 reads per visit.)
  const {
    products: feedRows,
    loading: feedLoading,
    loadingMore,
    refreshing,
    hasMore,
    error: feedError,
    loadMore,
  } = useProductFeed({ pageSize: 24 })

  /** Store details, joined onto each product by its sellerId. */
  const [sellerMap, setSellerMap] = useState<Map<string, { slug: string; businessName: string; logoUrl: string }>>(new Map())

  /** Everything we've loaded so far, with its store attached. */
  const products: Product[] = useMemo(
    () => feedRows
      .map(row => {
        const info = sellerMap.get(row.sellerId)
        return {
          ...(row as unknown as Product),
          id: row.id,
          sellerId: row.sellerId,
          sellerSlug: info?.slug || '',
          businessName: info?.businessName || '',
        }
      })
      .filter(p => p.sellerSlug),
    [feedRows, sellerMap],
  )

  const [filtered, setFiltered] = useState<Product[]>([])
  const [activeCategory, setActiveCategory] = useState('All')
  const [search, setSearch] = useState(() => new URLSearchParams(window.location.search).get('q') || '')
  /** Type-ahead dropdown: open while typing, navigable with ↑/↓, picked with Enter. */
  const [showSuggest, setShowSuggest] = useState(false)
  const [activeSuggest, setActiveSuggest] = useState(-1)
  const loading = feedLoading
  const [sortBy, setSortBy] = useState<'relevance' | 'price-asc' | 'price-desc' | 'newest' | 'popular'>('relevance')
  const [minPrice, setMinPrice] = useState('')
  const [maxPrice, setMaxPrice] = useState('')
  const [hideOutOfStock, setHideOutOfStock] = useState(true)
  const [recentSearches, setRecentSearches] = useState<string[]>([])
  const [userId, setUserId] = useState<string | null>(null)
  const [mySlug, setMySlug] = useState<string | null>(null)
  const [ownerFilter, setOwnerFilter] = useState<'all' | 'mine' | 'not-mine'>('all')
  const { addToBag, removeFromBag, isInBag, updateBagVariant, setQuantity: setBagQuantity, count: bagCount } = useBag()
  // ♥ Universal likes: the tally rides on each product, my own vote comes from one listener.
  const { isLiked, likeCountFor, toggleLike } = useProductLikes()
  const navigate = useNavigate()
  const [bagCounts, setBagCounts] = useState<Record<string, BagCountData>>({})
  const [stores, setStores] = useState<{ slug: string; businessName: string; logoUrl: string; bio: string; aliases: string[]; createdAtMs: number }[]>([])
  /** True while the person is in the search box — the rolling hint must not move under them. */
  const [searchFocused, setSearchFocused] = useState(false)

  /**
   * The rolling hint: names from **all of rachett** — the catalog this page has loaded and the
   * whole shops directory. (Nearby is handed a different list: only what is near the buyer.)
   */
  const placeholderProducts = useMemo(() => products.map(p => p.name), [products])
  const placeholderStores = useMemo(() => stores.map(s => s.businessName), [stores])
  const searchPlaceholder = useRotatingPlaceholder({
    products: placeholderProducts,
    stores: placeholderStores,
    fallback: 'Search products, stores...',
    paused: searchFocused || search.trim().length > 0,
  })
  const [storeSort, setStoreSort] = useState<'newest' | 'az'>('newest')
  const [showAllStores, setShowAllStores] = useState(false)
  const [surveyProduct, setSurveyProduct] = useState<Product | null>(null)
  const [surveyImageIndex, setSurveyImageIndex] = useState(0)
  const [orderProduct, setOrderProduct] = useState<Product | null>(null)
  const [messageProduct, setMessageProduct] = useState<Product | null>(null)
  const [orderSuccess, setOrderSuccess] = useState(false)
  const [buyerName, setBuyerName] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [deliveryArea, setDeliveryArea] = useState('')
  /** What sellers call this buyer — the order form pre-fills from it, and remembers what they keep. */
  const myName = useBuyerName()
  const shownName = buyerName.trim() || myName.name
  /** The details sheet: which product is open, and the colour/size picked in it. */
  const [detailsProduct, setDetailsProduct] = useState<Product | null>(null)
  const [orderVariant, setOrderVariant] = useState<Variant>({})
  const [messageVariant, setMessageVariant] = useState<Variant>({})
  const [orderMessage, setOrderMessage] = useState('')
  /**
   * One thread, one draft. When the uid isn't known yet (signed out, or the auth
   * callback hasn't landed) the draft is keyed to the product instead — the old,
   * always-saving behaviour — and it moves onto the conversation once you're in.
   */
  const messageDraftKey = messageProduct
    ? (userId && messageProduct.sellerId
        ? `convo_${getConversationId(messageProduct.sellerId, userId)}`
        : `product_${messageProduct.id}`)
    : 'none'
  const {
    text: messageText,
    setText: setMessageText,
    draft: draftMsg,
    clearDraft: clearMsgDraft,
    saveNow: saveMsgDraft,
  } = useDraft(
    messageDraftKey,
    messageProduct
      ? {
          sellerId: messageProduct.sellerId || '',
          buyerId: userId || '',
          counterpartName: messageProduct.businessName || 'Seller',
          counterpartRole: 'seller',
          productId: messageProduct.id,
          productName: messageProduct.name,
          productPrice: messageProduct.price,
          productImage: messageProduct.imageUrl,
          sellerSlug: messageProduct.sellerSlug,
        }
      : undefined,
    { surface: 'browse' },
  )
  const [showQuickReplies, setShowQuickReplies] = useState(false)
  const clickTimerRef = useRef<number | null>(null)
  const cardSwipeStartRef = useRef<{ id: string; x: number; y: number } | null>(null)
  const swipeSuppressRef = useRef(false)
  const [cardImgIndex, setCardImgIndex] = useState<Record<string, number>>({})
  const guestFileRef = useRef<HTMLInputElement | null>(null)
  const [guestImageUrl, setGuestImageUrl] = useState('')
  const [guestUploading, setGuestUploading] = useState(false)
  const RECENT_SEARCH_LIMIT = 11

  // Load the signed-in user's store slug so the "Yours" badge + "Mine" filter work
  useEffect(() => {
    const u = auth.currentUser
    if (!u) {
      setMySlug(null)
      return
    }
    getDoc(doc(db, 'sellers', u.uid)).then(snap => {
      if (snap.exists()) setMySlug(snap.data().slug || null)
    }).catch(() => {})
  }, [])

  // Fetch bag counts for displayed products
  useEffect(() => {
    const ids = filtered.map(p => p.id)
    if (ids.length === 0) return
    getBagCounts(ids).then(setBagCounts)
  }, [filtered])

  /** The grid Browse renders itself — impressions are read from the DOM (no refactor). */
  const productsGridRef = useRef<HTMLDivElement | null>(null)

  /** One `browse_viewed` per visit, fired once the first page of the feed is in. */
  const browseSeen = useRef(false)
  useEffect(() => {
    if (browseSeen.current || products.length === 0) return
    browseSeen.current = true
    trackEvent('browse_viewed', { category: activeCategory, storeCount: stores.length })
  }, [products.length, activeCategory, stores.length])

  /** Every page of the feed (24 items) is its own step in the journey. */
  const feedPageRef = useRef({ page: 0, count: 0 })
  useEffect(() => {
    if (products.length <= feedPageRef.current.count) return
    feedPageRef.current = { page: feedPageRef.current.page + 1, count: products.length }
    trackEvent('feed_page_loaded', { page: feedPageRef.current.page, count: products.length })
  }, [products.length])

  /** Impressions for the cards currently rendered in the products grid. */
  useEffect(() => observeImpressions(productsGridRef.current, 'browse'), [filtered])

  /** Typing a search away is the end of that attempt — worth knowing. */
  const hadQueryRef = useRef(false)
  useEffect(() => {
    const has = search.trim().length > 0
    if (hadQueryRef.current && !has) trackEvent('search_cleared', { surface: 'browse', hadQuery: true })
    hadQueryRef.current = has
  }, [search])

  /**
   * Type-ahead: built from the shops we loaded, the products in the catalogue, the
   * real categories and this person's own recent searches. Nothing invented — see
   * `useSuggestions`.
   */
  const suggestions = useMemo(
    () => buildSuggestions(search, {
      stores: stores.map(s => ({ slug: s.slug, businessName: s.businessName, aliases: s.aliases, logoUrl: s.logoUrl })),
      products: products.map(p => ({
        id: p.id,
        name: p.name,
        sellerSlug: p.sellerSlug,
        businessName: p.businessName,
        imageUrl: p.imageUrl,
        category: p.category,
      })),
      categories: categories.slice(1),
      recentSearches,
    }),
    [search, stores, products, recentSearches],
  )

  const pickSuggestion = (s: Suggestion) => {
    trackEvent('search_suggestion_clicked', {
      query: search.trim(),
      suggestion: s.label,
      kind: s.kind,
      surface: 'browse',
    })
    setShowSuggest(false)
    setActiveSuggest(-1)
    if (s.kind === 'category') {
      setActiveCategory(s.label)
      setSearch('')
      return
    }
    if (s.kind === 'recent') {
      setSearch(s.label)
      return
    }
    if (s.slug && s.kind === 'product' && s.productId) {
      navigate(`/store/${s.slug}?productId=${s.productId}`)
      return
    }
    if (s.slug) {
      navigate(`/store/${s.slug}`)
      return
    }
    setSearch(s.label)
  }

  const handleToggleBag = (p: Product, variant?: Variant) => {
    if (isInBag(p.id)) {
      removeFromBag(p.id)
      trackEvent('bag_removed', { productId: p.id, sellerId: p.sellerId, price: p.price, surface: 'browse', bagSize: Math.max(0, bagCount - 1) })
      setBagCounts(prev => ({
        ...prev,
        [p.id]: { count: Math.max(0, (prev[p.id]?.count || 0) - 1), baggedCount: prev[p.id]?.baggedCount || 0 },
      }))
    } else {
      addToBag({ productId: p.id, productName: p.name, productPrice: p.price, imageUrl: p.imageUrl, images: p.images?.length ? p.images : (p.imageUrl ? [p.imageUrl] : []), sellerSlug: p.sellerSlug, sellerId: p.sellerId, businessName: p.businessName, color: variant?.color, size: variant?.size })
      trackEvent('bag_added', { productId: p.id, sellerId: p.sellerId, price: p.price, surface: 'browse', bagSize: bagCount + 1 })
      setBagCounts(prev => ({
        ...prev,
        [p.id]: { count: (prev[p.id]?.count || 0) + 1, baggedCount: (prev[p.id]?.baggedCount || 0) + 1 },
      }))
    }
  }

  /**
   * From the details sheet. Already bagged → just remember the new colour/size (a second tap
   * in the sheet must never throw away something the buyer deliberately kept). Not bagged yet →
   * the normal add, carrying the variant.
   */
  const handleSheetBag = (p: Product, variant: Variant, qty = 1) => {
    if (isInBag(p.id)) {
      updateBagVariant(p.id, variant)
      setBagQuantity(p.id, Math.max(1, qty))
      return
    }
    handleToggleBag(p, variant)
    // "Add 3 of them" is one thought, not two — the bag line takes the number straight away.
    setBagQuantity(p.id, Math.max(1, qty))
  }

  /**
   * ♥ One tap, one vote per account. The tally is one number everybody reads — Kenya, Uganda
   * or Morocco — and a second tap takes the vote back. A guest is sent to sign in and
   * returned to this exact card, at which point the vote goes through.
   */
  const handleToggleLike = useCallback((p: Product) => {
    void toggleLike({
      sellerId: p.sellerId,
      productId: p.id,
      currentCount: likeCountFor(p),
      surface: 'browse',
    }).then(res => {
      if (res.needsSignIn) {
        requireSignIn(navigate, { action: 'like', returnTo: '/browse', productId: p.id, sellerSlug: p.sellerSlug })
      } else if (res.ownProduct) alert(notify.likeSelfBlock)
      else if (res.failed) alert(notify.likeFailed)
    })
  }, [toggleLike, likeCountFor, navigate])

  const formatBagCount = formatCount

  const handleCardClick = (p: Product) => {
    if (clickTimerRef.current !== null) {
      // Second tap within window → double-tap, open survey
      clearTimeout(clickTimerRef.current)
      clickTimerRef.current = null
      setSurveyImageIndex(0)
      setSurveyProduct(p)
      trackEvent('product_surveyed', { productId: p.id, sellerId: p.sellerId, sellerSlug: p.sellerSlug, surface: 'browse' })
      return
    }
    // First tap → wait for possible second tap
    clickTimerRef.current = window.setTimeout(() => {
      clickTimerRef.current = null
      trackEvent('product_viewed', { productId: p.id, sellerId: p.sellerId, sellerSlug: p.sellerSlug, surface: 'browse', category: p.category })
      navigate(`/store/${p.sellerSlug}`)
    }, 250)
  }

  const getSurveyImages = (p: Product) => {
    if (p.images && p.images.length > 0) return p.images
    return p.imageUrl ? [p.imageUrl] : []
  }

  // Pinterest-style swipeable card image: multi-image products swipe horizontally in place.
  const renderCardImages = (p: Product, height: number) => {
    const imgs = getSurveyImages(p)
    if (imgs.length <= 1) {
      return (
        <img src={imgs[0] || 'https://placehold.co/300x200/1a1a1a/333333'} alt={p.name}
          style={{ width: '100%', height, objectFit: 'cover', opacity: p.outOfStock ? 0.5 : 1 }} />
      )
    }
    const idx = Math.min(cardImgIndex[p.id] || 0, imgs.length - 1)
    return (
      <div className="rt-swipe"
        onPointerDown={(e) => { cardSwipeStartRef.current = { id: p.id, x: e.clientX, y: e.clientY } }}
        onPointerUp={(e) => {
          const s = cardSwipeStartRef.current
          cardSwipeStartRef.current = null
          if (s && s.id === p.id && Math.abs(e.clientX - s.x) > 10 && Math.abs(e.clientX - s.x) > Math.abs(e.clientY - s.y)) {
            swipeSuppressRef.current = true
          }
        }}
        onClick={(e) => {
          // A swipe just happened — don't bubble a click into navigate/survey.
          if (swipeSuppressRef.current) {
            swipeSuppressRef.current = false
            e.stopPropagation()
          }
        }}
        onScroll={(e) => {
          const el = e.currentTarget
          const i = Math.round(el.scrollLeft / el.clientWidth)
          setCardImgIndex(prev => (prev[p.id] === i ? prev : { ...prev, [p.id]: i }))
        }}
        style={{ display: 'flex', overflowX: 'auto', scrollSnapType: 'x mandatory', cursor: 'pointer', position: 'relative' }}>
        {imgs.map((img, i) => (
          <img key={`${p.id}-${i}`} src={img} alt={p.name} draggable={false}
            style={{ width: '100%', flex: '0 0 100%', height, objectFit: 'cover', scrollSnapAlign: 'start', opacity: p.outOfStock ? 0.5 : 1 }} />
        ))}
        <div style={{ position: 'absolute', bottom: '6px', right: '6px', background: 'rgba(0,0,0,0.6)', color: '#fff', padding: '2px 7px', borderRadius: '12px', fontSize: '10px', fontWeight: '700', zIndex: 2, backdropFilter: 'blur(4px)', lineHeight: 1.4 }}>
          {idx + 1}/{imgs.length}
        </div>
      </div>
    )
  }

  const closeSurvey = () => {
    setSurveyProduct(null)
    if (clickTimerRef.current !== null) {
      clearTimeout(clickTimerRef.current)
      clickTimerRef.current = null
    }
  }

  // Coming back from sign-in? Reopen the sheet they were blocked on.
  useEffect(() => {
    if (products.length === 0) return
    consumePendingAction(products, { order: setOrderProduct, message: setMessageProduct, like: handleToggleLike })
  }, [products, handleToggleLike])

  const handleOrder = async () => {
    if (!auth.currentUser) {
      // Sign in first — then come straight back to this product.
      requireSignIn(navigate, {
        action: 'order',
        returnTo: '/browse',
        productId: orderProduct?.id,
        sellerSlug: orderProduct?.sellerSlug,
      })
      return
    }
    if (orderProduct && orderProduct.sellerId === auth.currentUser.uid) {
      alert(notify.messageSelfBlock)
      return
    }
    if (!shownName.trim() || !deliveryArea.trim() || !orderProduct) return
    // Checkout is where a buyer tells us what to call them — remember it once, silently.
    void myName.rememberIfNew(shownName, 'checkout')
    const sourcePlatform = detectSource()
    try {
      const { orderId } = await createBuyerOrder(orderProduct.sellerId, {
        buyerName: shownName.trim(),
        buyerUid: auth.currentUser.uid,
        productName: orderProduct.name,
        productPrice: orderProduct.price,
        productId: orderProduct.id,
        productImage: orderProduct.imageUrl || '',
        quantity,
        deliveryArea: deliveryArea.trim(),
        // What they picked in the details sheet, carried onto the order so the seller never
        // has to guess which colour or size to pack.
        ...(orderVariant.color ? { color: orderVariant.color } : {}),
        ...(orderVariant.size ? { size: orderVariant.size } : {}),
        status: 'pending',
        read: false,
        sourcePlatform,
        createdAt: new Date(),
      })
      await createOrderConversation({
        sellerId: orderProduct.sellerId,
        buyerId: auth.currentUser.uid,
        sellerName: orderProduct.businessName,
        buyerName: shownName.trim(),
        orderId,
        productId: orderProduct.id,
        productName: orderProduct.name,
        productPrice: orderProduct.price,
        quantity,
        color: orderVariant.color,
        size: orderVariant.size,
      })
      await incrementProductOrderCount(orderProduct.sellerId, orderProduct.id, orderProduct.orderCount || 0)
      trackEvent('order_placed', {
        productId: orderProduct.id,
        sellerId: orderProduct.sellerId,
        price: orderProduct.price,
        quantity,
        bagSize: bagCount,
        channel: sourcePlatform,
        surface: 'browse',
      })
      setOrderSuccess(true)
      setTimeout(() => {
        setBuyerName('')
        setQuantity('1')
        setDeliveryArea('')
        setOrderMessage('')
        setOrderVariant({})
        setOrderProduct(null)
        setOrderSuccess(false)
      }, 2500)
    } catch (err) {
      console.error('Order failed:', err)
      alert('Failed to place order. Try again.')
    }
  }

  const handleSendMessage = async () => {
    if ((!messageText.trim() && !guestImageUrl) || !messageProduct) return
    if (auth.currentUser && messageProduct.sellerId === auth.currentUser.uid) {
      alert(notify.messageSelfBlock)
      return
    }
    if (!auth.currentUser || auth.currentUser.isAnonymous) {
      // Sign in with a real account — that is how the seller can reply to you.
      requireSignIn(navigate, {
        action: 'message',
        returnTo: '/browse',
        productId: messageProduct.id,
        sellerSlug: messageProduct.sellerSlug,
      })
      return
    }
    // Signed-in flow
    try {
      const buyerUid = auth.currentUser.uid
      await sendConversationMessage(
        messageProduct.sellerId,
        buyerUid,
        buyerUid,
        messageText.trim() || (guestImageUrl ? '📷 Photo' : '🛍️ Product'),
        messageProduct.businessName || 'Seller',
        shownName || myName.label,
        {
          ...(guestImageUrl ? { imageUrl: guestImageUrl, type: 'image' } : {}),
          productId: messageProduct.id,
          productName: messageProduct.name,
          productPrice: messageProduct.price,
          productImage: messageProduct.imageUrl,
          color: messageVariant.color,
          size: messageVariant.size,
        }
      )
      trackEvent('message_sent', {
        productId: messageProduct.id,
        sellerId: messageProduct.sellerId,
        hasPhoto: Boolean(guestImageUrl),
        length: messageText.trim().length,
        surface: 'browse',
        channel: detectSource(),
      })
      clearMsgDraft()
      setShowQuickReplies(false)
      setMessageProduct(null)
      alert('Message sent! The seller will reply soon.')
    } catch (err) {
      console.error('Message error:', err)
      alert('Failed to send message. Try again.')
    }
  }

  /** Dismissing keeps the draft — that is the whole point of a draft. */
  const closeMessageModal = () => {
    saveMsgDraft()
    setMessageProduct(null)
    setShowQuickReplies(false)
  }

  /** Cancel is the person's order to throw it away — device and account copy. */
  const cancelMessageModal = () => {
    clearMsgDraft()
    setGuestImageUrl('')
    setMessageProduct(null)
    setShowQuickReplies(false)
  }

  const handleGuestPhoto = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setGuestUploading(true)
    try {
      const url = await uploadImageToCloudinary(file)
      setGuestImageUrl(url)
    } catch (err) {
      console.error('Photo upload failed:', err)
      alert('Photo upload failed. Try again.')
    } finally {
      setGuestUploading(false)
    }
  }

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUserId(user ? user.uid : null)
    })
    return () => unsubscribe()
  }, [])

  useEffect(() => {
    const storageKey = `rachett_recent_searches_${userId || 'guest'}`
    const raw = localStorage.getItem(storageKey)
    if (raw) {
      try {
        setRecentSearches(JSON.parse(raw) as string[])
      } catch {
        setRecentSearches([])
      }
    } else {
      setRecentSearches([])
    }
  }, [userId])

  const getSearchStorageKey = (uid: string | null) => `rachett_recent_searches_${uid || 'guest'}`

  const saveRecentSearch = (term: string) => {
    const trimmed = term.trim()
    if (!trimmed) return
    const storageKey = getSearchStorageKey(userId)
    setRecentSearches((prev) => {
      const next = [trimmed, ...prev.filter(item => item.toLowerCase() !== trimmed.toLowerCase())].slice(0, RECENT_SEARCH_LIMIT)
      localStorage.setItem(storageKey, JSON.stringify(next))
      return next
    })
  }

  const clearRecentSearches = () => {
    const storageKey = getSearchStorageKey(userId)
    localStorage.removeItem(storageKey)
    setRecentSearches([])
  }

  const handleRecentSearchClick = (term: string) => {
    setSearch(term)
    saveRecentSearch(term)
  }

  /**
   * The one search path: the 🔍 button, the phone's Search key and Enter all land here, so the
   * recorded event can never drift from what the page actually did.
   */
  const runSearch = () => {
    setShowSuggest(false)
    saveRecentSearch(search)
    trackEvent('search_performed', {
      query: search.trim(),
      surface: 'browse',
      resultCount: filtered.length,
      zeroResult: filtered.length === 0,
      category: activeCategory,
      sortBy,
    })
  }

  const handleSearchKeyDown = (e: { key: string; preventDefault?: () => void }) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (suggestions.length === 0) return
      e.preventDefault?.()
      setShowSuggest(true)
      setActiveSuggest(prev => {
        const next = e.key === 'ArrowDown' ? prev + 1 : prev - 1
        if (next < -1) return suggestions.length - 1
        if (next >= suggestions.length) return -1
        return next
      })
      return
    }
    if (e.key === 'Escape') {
      setShowSuggest(false)
      setActiveSuggest(-1)
      return
    }
    if (e.key === 'Enter') {
      // A highlighted suggestion wins; otherwise search.
      if (showSuggest && activeSuggest >= 0 && suggestions[activeSuggest]) {
        pickSuggestion(suggestions[activeSuggest])
        return
      }
      runSearch()
    }
  }

  const storeMatches = useMemo(() => {
    const term = search.trim()
    if (!term) return []

    // Product counts per store (from the products we loaded)
    const counts = new Map<string, number>()
    const outCounts = new Map<string, number>()
    products.forEach((p) => {
      counts.set(p.sellerSlug, (counts.get(p.sellerSlug) || 0) + 1)
      if (p.outOfStock) outCounts.set(p.sellerSlug, (outCounts.get(p.sellerSlug) || 0) + 1)
    })

    const fuse = new Fuse(stores, {
      keys: ['businessName', 'aliases'],
      threshold: 0.35,
      includeScore: true,
    })

    return fuse.search(term).map((r) => {
      const st = r.item
      const termL = term.toLowerCase()
      const nameMatches = st.businessName.toLowerCase().includes(termL) || termL.includes(st.businessName.toLowerCase())
      const aliasMatched = (st.aliases || []).some(a => termL.includes(a.toLowerCase()) || a.toLowerCase().includes(termL))
      return {
        ...st,
        productCount: counts.get(st.slug) || 0,
        outOfStockCount: outCounts.get(st.slug) || 0,
        renamed: aliasMatched && !nameMatches,
      }
    })
  }, [stores, products, search])

  // Trending & recommended — what's actually moving (orders + sales)
  const popularProducts = useMemo(() => {
    return [...products]
      .sort((a, b) => ((b.orderCount || 0) * 2 + (b.salesCount || 0)) - ((a.orderCount || 0) * 2 + (a.salesCount || 0)))
      .slice(0, 10)
  }, [products])

  /** The stores directory — every linkable shop, sortable, no searching required. */
  const sortedStores = useMemo(() => {
    const list = [...stores]
    if (storeSort === 'az') {
      return list.sort((a, b) => (a.businessName || a.slug).localeCompare(b.businessName || b.slug))
    }
    return list.sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0))
  }, [stores, storeSort])
  const visibleStores = showAllStores ? sortedStores : sortedStores.slice(0, STORE_DIRECTORY_LIMIT)

  useEffect(() => {
    // Stores only — products come from the paged feed (useProductFeed), so Browse no
    // longer reads every store's products one by one.
    const fetchStores = async () => {
      try {
        const sellersSnap = await getDocs(collection(db, 'sellers'))
        // Only stores that actually have a link can be opened — a seller doc with no
        // slug used to produce /store/undefined and a dead end.
        const linkable = sellersSnap.docs.filter(d => String(d.data().slug || '').trim())
        setStores(linkable.map(d => {
          const s = d.data()
          return {
            slug: s.slug || '',
            businessName: s.businessName || '',
            logoUrl: s.logoUrl || '',
            bio: s.bio || '',
            aliases: Array.isArray(s.aliases) ? s.aliases.filter((a: unknown) => typeof a === 'string') : [],
            createdAtMs: toMillis(s.createdAt) ?? 0,
          }
        }))
        setSellerMap(new Map(linkable.map(d => {
          const s = d.data()
          return [d.id, { slug: s.slug || '', businessName: s.businessName || '', logoUrl: s.logoUrl || '' }]
        })))
      } catch (err) {
        console.error('Browse page: could not load stores:', err)
      }
    }
    void fetchStores()
  }, [])

  /** Auto-load more pages while a search is running, so search isn't limited to whatever happened to load. */
  const autoPagesRef = useRef(0)
  useEffect(() => {
    if (!search.trim()) { autoPagesRef.current = 0; return }
    if (feedLoading || loadingMore || !hasMore) return
    if (filtered.length >= 8) return
    if (autoPagesRef.current >= 5) return
    autoPagesRef.current += 1
    loadMore()
  }, [search, filtered.length, feedLoading, loadingMore, hasMore, loadMore])

  // Fuzzy search with Fuse.js + category + price + out-of-stock filters + sorting
  useEffect(() => {
    let result = products

    // Apply category filter
    if (activeCategory !== 'All') {
      result = result.filter(p => p.category === activeCategory)
    }

    // Apply owner filter (mine / not mine)
    if (ownerFilter === 'mine') {
      result = result.filter(p => p.sellerSlug === mySlug && mySlug)
    } else if (ownerFilter === 'not-mine') {
      result = result.filter(p => p.sellerSlug !== mySlug || !mySlug)
    }

    // Apply out-of-stock filter
    if (hideOutOfStock) {
      result = result.filter(p => !p.outOfStock)
    }

    // Apply price range filter (empty box = no limit on that side)
    const minP = minPrice.trim() === '' ? 0 : Number(minPrice) || 0
    const maxP = maxPrice.trim() === '' ? Number.MAX_SAFE_INTEGER : Number(maxPrice) || Number.MAX_SAFE_INTEGER
    result = result.filter(p => {
      const price = Number(String(p.price).replace(/,/g, '')) || 0
      return price >= minP && price <= maxP
    })

    // Fuzzy search
    if (search.trim()) {
      const fuse = new Fuse(result, {
        keys: ['name', 'description', 'businessName', 'subCategory'],
        threshold: 0.3,
        includeScore: true
      })
      const searchResults = fuse.search(search)
      result = searchResults.map(r => r.item)
    }

    // Apply sorting
    if (sortBy === 'price-asc') {
      result.sort((a, b) => {
        const priceA = Number(String(a.price).replace(/,/g, '')) || 0
        const priceB = Number(String(b.price).replace(/,/g, '')) || 0
        return priceA - priceB
      })
    } else if (sortBy === 'price-desc') {
      result.sort((a, b) => {
        const priceA = Number(String(a.price).replace(/,/g, '')) || 0
        const priceB = Number(String(b.price).replace(/,/g, '')) || 0
        return priceB - priceA
      })
    } else if (sortBy === 'newest') {
      // Real newest-first using the product's createdAt (older items go last).
      result.sort((a, b) => (toMillis(b.createdAt) ?? 0) - (toMillis(a.createdAt) ?? 0))
    } else if (sortBy === 'popular') {
      result.sort((a, b) => (b.orderCount || 0) - (a.orderCount || 0))
    }

    setFiltered(result)
  }, [activeCategory, search, products, sortBy, minPrice, maxPrice, hideOutOfStock, ownerFilter, mySlug])

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f0f', fontFamily: 'sans-serif', color: '#fff' }}>

      {/* Hero */}
      <div style={{ textAlign: 'center', padding: '48px 20px 32px', borderBottom: '1px solid #1a1a1a' }}>
        <h1 className="rt-title-md" style={{ fontSize: '32px', fontWeight: '900', margin: '0 0 8px', letterSpacing: '-1px' }}>
          Shop from real sellers — <span style={{ color: green }}>safely.</span>
        </h1>
        <p style={{ color: '#666', fontSize: '15px', margin: '0 0 24px' }}>
          Every store here is run by a real social media seller. Browse, order, and they'll reach out to complete your purchase.
        </p>

        {/* Search — one magnifier, on the right, and a hint that rolls with real rachett names */}
        <div style={{ maxWidth: '500px', margin: '0 auto' }}>
          <SearchBar
            value={search}
            onChange={value => { setSearch(value); setActiveSuggest(-1); setShowSuggest(true) }}
            placeholder={searchPlaceholder}
            onSearch={runSearch}
            onKeyDown={handleSearchKeyDown}
            onFocus={() => { setSearchFocused(true); setShowSuggest(true) }}
            onBlur={() => { setSearchFocused(false); window.setTimeout(() => setShowSuggest(false), 120) }}
            emptyHint="Type something to search — the names hint at what's here"
          >
            {showSuggest && search.trim().length > 0 && (
              <SearchSuggest suggestions={suggestions} activeIndex={activeSuggest} onPick={pickSuggestion} />
            )}
          </SearchBar>
        </div>
        {/* Result count — always on screen while searching, even at zero */}
        {search.trim() && (
          <p style={{ margin: '14px 0 0', color: '#888', fontSize: 13 }}>
            {loading ? (
              <>🔍 Searching for <strong style={{ color: '#fff' }}>“{search.trim()}”</strong>…</>
            ) : (
              <>
                🔍 <strong style={{ color: filtered.length > 0 ? green : '#fff', fontSize: 15 }}>
                  {filtered.length} result{filtered.length === 1 ? '' : 's'}
                </strong>
                {' for '}<strong style={{ color: '#fff' }}>“{search.trim()}”</strong>
                {storeMatches.length > 0 && (
                  <>
                    {' · '}<strong style={{ color: '#fff', fontSize: 15 }}>{storeMatches.length}</strong>
                    {' '}store{storeMatches.length === 1 ? '' : 's'}
                  </>
                )}
              </>
            )}
          </p>
        )}
        {recentSearches.length > 0 && (
          <div style={{ maxWidth: '500px', margin: '12px auto 0', display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'center' }}>
            {recentSearches.map(term => (
              <button key={term} onClick={() => handleRecentSearchClick(term)}
                style={{ border: '1px solid #333', borderRadius: '20px', background: '#111', color: '#fff', padding: '8px 14px', fontSize: '13px', cursor: 'pointer' }}>
                {term}
              </button>
            ))}
            <button onClick={clearRecentSearches}
              style={{ border: '1px solid #333', borderRadius: '20px', background: '#111', color: '#999', padding: '8px 14px', fontSize: '13px', cursor: 'pointer' }}>
              Clear recents
            </button>
          </div>
        )}
      </div>

      {feedError && (
        <div style={{ padding: '12px 24px' }}>
          <div style={{ background: '#fee', border: '1px solid #fcc', color: '#c33', padding: '12px', borderRadius: '8px', maxWidth: '900px', margin: '0 auto' }}>
            {feedError}
          </div>
        </div>
      )}

      {search.trim() && storeMatches.length > 0 && (
        <div style={{ maxWidth: '900px', margin: '24px auto', padding: '16px', border: '1px solid #222', borderRadius: '16px', background: '#111' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <div>
              <p style={{ margin: 0, color: '#888', textTransform: 'uppercase', fontSize: '12px', letterSpacing: '0.12em' }}>Matching stores</p>
              <h2 style={{ margin: '6px 0 0', fontSize: '20px', fontWeight: '800', color: '#fff' }}>Search matched {storeMatches.length} store{storeMatches.length === 1 ? '' : 's'}</h2>
            </div>
            <p style={{ margin: 0, color: '#777', fontSize: '13px' }}>Tap a store to open its storefront</p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '14px' }}>
            {storeMatches.slice(0, STORE_MATCH_LIMIT).map(store => (
              <div key={store.slug} onClick={() => navigate(`/store/${store.slug}`)}
                style={{ background: '#151515', borderRadius: '14px', cursor: 'pointer', overflow: 'hidden', border: '1px solid #222', minHeight: '170px', display: 'flex', flexDirection: 'column' }}>
                {store.renamed && (
                  <div style={{ padding: '8px 12px', background: '#12210d', color: green, fontSize: '12px', fontWeight: '600', borderBottom: `1px solid ${green}`, lineHeight: 1.4 }}>
                    ✏️ This seller is now called <strong>{store.businessName}</strong>
                  </div>
                )}
                <div style={{ padding: '12px' }}>
                  {/* A logo is square; stretched across a 110px banner it looked smeared.
                      Here it is what it is — a small avatar — and a shop with no photo yet
                      wears its own letter on a colour from its name (`avatar.ts`) rather
                      than a grey placeholder. Same pattern as StoreCard, so a shop looks
                      the same wherever it is listed. */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                    {store.logoUrl ? (
                      <img src={store.logoUrl} alt="" style={{ width: 40, height: 40, minWidth: 40, borderRadius: 10, objectFit: 'cover', background: '#111' }} />
                    ) : (
                      <div aria-hidden="true" style={{ width: 40, height: 40, minWidth: 40, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 17, ...avatarColor(store.businessName) }}>
                        {initialOf(store.businessName)}
                      </div>
                    )}
                    <p style={{ margin: 0, fontWeight: '800', color: '#fff', fontSize: '14px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{store.businessName}</p>
                  </div>
                  {store.bio && <p style={{ margin: '0 0 6px', color: '#888', fontSize: '12px', lineHeight: 1.4 }}>{store.bio}</p>}
                  <p style={{ margin: 0, color: '#888', fontSize: '12px' }}>{store.productCount} product{store.productCount === 1 ? '' : 's'}{store.outOfStockCount > 0 ? ` • ${store.outOfStockCount} unavailable` : ''}</p>
                </div>
              </div>
            ))}
          </div>
          {storeMatches.length > STORE_MATCH_LIMIT && (
            <p style={{ margin: '14px 0 0', color: '#777', fontSize: 12 }}>
              Showing the first {STORE_MATCH_LIMIT} of {storeMatches.length} — the stores directory below lists every shop.
            </p>
          )}
        </div>
      )}

      {/* Sort, Price Range, Out-of-Stock Controls */}
      <div style={{ padding: '16px 24px', borderBottom: '1px solid #1a1a1a', display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', fontSize: '13px' }}>
        <select
          value={sortBy}
          onChange={e => {
            const next = e.target.value as typeof sortBy
            setSortBy(next)
            trackEvent('sort_changed', { sortBy: next, surface: 'browse' })
          }}
          style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid #333', background: '#1a1a1a', color: '#fff', cursor: 'pointer', fontSize: '13px' }}>
          <option value="relevance">Sort: Relevance</option>
          <option value="price-asc">Sort: Price (Low → High)</option>
          <option value="price-desc">Sort: Price (High → Low)</option>
          <option value="popular">Sort: Most Popular</option>
          <option value="newest">Sort: Newest</option>
        </select>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <label style={{ color: '#888' }}>Price: UGX</label>
          <input
            type="number"
            inputMode="numeric"
            placeholder="Min"
            value={minPrice}
            onChange={e => setMinPrice(e.target.value.replace(/[^0-9]/g, ''))}
            style={{ width: '90px', padding: '6px', borderRadius: '6px', border: '1px solid #333', background: '#1a1a1a', color: '#fff', fontSize: '13px' }}
          />
          <span style={{ color: '#555' }}>—</span>
          <input
            type="number"
            inputMode="numeric"
            placeholder="Max"
            value={maxPrice}
            onChange={e => setMaxPrice(e.target.value.replace(/[^0-9]/g, ''))}
            style={{ width: '90px', padding: '6px', borderRadius: '6px', border: '1px solid #333', background: '#1a1a1a', color: '#fff', fontSize: '13px' }}
          />
          {(minPrice || maxPrice) && (
            <button onClick={() => { setMinPrice(''); setMaxPrice('') }} title="Clear price filter"
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 20, background: '#1a2a1a', color: green, border: `1px solid ${green}`, cursor: 'pointer', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>
              💵 {minPrice && maxPrice ? `UGX ${minPrice} – ${maxPrice}` : minPrice ? `UGX ${minPrice} +` : `≤ UGX ${maxPrice}`} ✕
            </button>
          )}
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', color: hideOutOfStock ? green : '#888' }}>
          <input
            type="checkbox"
            checked={hideOutOfStock}
            onChange={e => setHideOutOfStock(e.target.checked)}
            style={{ cursor: 'pointer' }}
          />
          Hide out of stock
        </label>
      </div>

      {/* Categories */}
      <select value={ownerFilter} onChange={e => setOwnerFilter(e.target.value as 'all' | 'mine' | 'not-mine')}
        style={{ padding: '8px 14px', borderRadius: '20px', border: '1px solid #333', background: ownerFilter !== 'all' ? green : 'transparent', color: ownerFilter !== 'all' ? '#000' : '#aaa', fontWeight: ownerFilter !== 'all' ? '700' : '500', cursor: 'pointer', fontSize: '14px', whiteSpace: 'nowrap', marginRight: '8px' }}>
        <option value="all">All Products</option>
        <option value="mine">Mine Only</option>
        <option value="not-mine">Hide Mine</option>
      </select>
        <div className="rt-filters" style={{ padding: '20px 24px', borderBottom: '1px solid #1a1a1a', display: 'flex', gap: '8px', overflowX: 'auto' }}>
        {categories.map(cat => (
          <button key={cat} onClick={() => { trackEvent('category_browsed', { category: cat }); setActiveCategory(cat) }}
            style={{ padding: '8px 18px', borderRadius: '20px', border: `1px solid ${activeCategory === cat ? green : '#333'}`, background: activeCategory === cat ? green : 'transparent', color: activeCategory === cat ? '#000' : '#aaa', fontWeight: activeCategory === cat ? '700' : '500', cursor: 'pointer', fontSize: '14px', whiteSpace: 'nowrap' }}>
            {cat}
          </button>
        ))}
      </div>

      {/* Products */}
      <div className="rt-container" style={{ maxWidth: '800px', margin: '0 auto', padding: '32px 16px' }}>
        {loading && filtered.length === 0 ? (
          <LoadingScreen inline variant="rows" message="Fetching products for you..." />
        ) : filtered.length === 0 ? (
          <div style={{ padding: '24px 0' }}>
            {/* One small line — the trending grid does the talking */}
            <p style={{ margin: '0 0 24px', color: '#777', fontSize: 13, textAlign: 'center' }}>
              {search.trim() && storeMatches.length === 0
                ? `😕 No store called “${search.trim()}” here — and no products matched either.`
                : (minPrice || maxPrice)
                  ? '😕 No products in that price range yet — here are some you may like 👇'
                  : search
                    ? '😕 Nothing matched that — here are some you may like 👇'
                    : '😕 Nothing here yet — here are some you may like 👇'}
            </p>

            {(search.trim() || minPrice || maxPrice) && (
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 20 }}>
                <button onClick={() => { setSearch(''); setMinPrice(''); setMaxPrice(''); setActiveCategory('All') }}
                  style={{ padding: '10px 18px', background: green, color: '#000', border: 'none', borderRadius: 10, fontWeight: 800, cursor: 'pointer', fontSize: 13 }}>
                  🔍 Clear the search & see everything
                </button>
                <button onClick={() => navigate('/nearby')}
                  style={{ padding: '10px 18px', background: '#111', color: '#ddd', border: '1px solid #333', borderRadius: 10, fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>
                  📍 Sellers near me
                </button>
              </div>
            )}

            {search.trim() && (
              <p style={{ margin: '0 0 24px', color: '#555', fontSize: 12, textAlign: 'center', lineHeight: 1.6 }}>
                Tip: shops are matched by the name on their profile (old names work too). If someone sent you a link, opening it directly is the surest way in — and the stores directory below lists every shop here.
              </p>
            )}

            {popularProducts.length > 0 && (
              <div>
                <h2 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 800, color: '#fff' }}>🔥 Trending &amp; recommended</h2>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 14 }}>
                  {popularProducts.map(p => (
                    <div key={p.id} onClick={() => navigate(`/store/${p.sellerSlug}`)}
                      style={{ background: '#1a1a1a', borderRadius: '12px', overflow: 'hidden', border: '1px solid #222', cursor: 'pointer', position: 'relative' }}>
                      {p.sellerSlug === mySlug && mySlug && (
                      <div style={{ position: 'absolute', top: '6px', left: '6px', background: green, color: '#000', padding: '1px 5px', borderRadius: '3px', fontSize: '9px', fontWeight: '800', zIndex: 2 }}>Yours</div>
                    )}
                    {renderCardImages(p, 190)}
                      <div style={{ padding: '12px' }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 4 }}>
                          <p style={{ margin: 0, flex: 1, minWidth: 0, fontWeight: '700', fontSize: '14px', color: '#fff', lineHeight: '1.3', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</p>
                          <LikePill liked={isLiked(p.id)} count={likeCountFor(p)} onToggle={p.sellerId === (userId || '') ? undefined : () => handleToggleLike(p)} />
                        </div>
                        <p style={{ margin: '0 0 8px', color: '#555', fontSize: '12px' }}>{p.businessName}</p>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                          <p style={{ margin: 0, fontWeight: '800', color: green, fontSize: '14px' }}>UGX {p.price}</p>
                          <button onClick={(e) => { e.stopPropagation(); setDetailsProduct(p) }}
                            aria-label={`See details for ${p.name}`}
                            style={{ flexShrink: 0, padding: '4px 10px', background: '#222', color: '#ddd', border: '1px solid #333', borderRadius: '999px', fontSize: '11px', fontWeight: '700', cursor: 'pointer', whiteSpace: 'nowrap', lineHeight: 1.5 }}>
                            ⓘ Details
                          </button>
                        </div>
                      </div>
                      {p.outOfStock && (
                        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: '700', fontSize: '12px', textAlign: 'center', padding: '8px' }}>
                          Out of Stock
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <>
            <p style={{ color: '#555', fontSize: '13px', marginBottom: '20px' }}>
              Showing {filtered.length} product{filtered.length === 1 ? '' : 's'} · newest first
              {refreshing && <span style={{ color: '#666' }}> · updating…</span>}
            </p>
            <div ref={productsGridRef} className="rt-products" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '16px' }}>
                            {filtered.map(p => (
                <div key={p.id} {...{ [IMPRESSION_ATTR]: p.id, [IMPRESSION_SELLER_ATTR]: p.sellerId }}
                  style={{ background: '#1a1a1a', borderRadius: '12px', overflow: 'hidden', border: '1px solid #222', position: 'relative', display: 'flex', flexDirection: 'column' }}>
                  <div onClick={() => handleCardClick(p)} style={{ cursor: 'pointer', position: 'relative' }}>
                    {p.sellerSlug === mySlug && mySlug && (<div style={{ position: 'absolute', top: '6px', left: '6px', background: green, color: '#000', padding: '1px 5px', borderRadius: '3px', fontSize: '9px', fontWeight: '800', zIndex: 2 }}>Yours</div>)}
                    <button onClick={(e) => { e.stopPropagation(); handleToggleBag(p) }}
                      style={{ position: 'absolute', top: '6px', right: '6px', background: isInBag(p.id) ? '#1a3a1a' : 'rgba(0,0,0,0.65)', color: '#fff', border: isInBag(p.id) ? `1px solid ${green}` : '1px solid rgba(255,255,255,0.25)', borderRadius: '8px', padding: '2px 7px', cursor: 'pointer', fontSize: '11px', fontWeight: '700', zIndex: 2, display: 'flex', alignItems: 'center', gap: '3px', backdropFilter: 'blur(4px)', lineHeight: 1.4, whiteSpace: 'nowrap' }}>
                      🛍️ {formatBagCount(bagCounts[p.id]?.baggedCount || 0)}
                    </button>
                    {(p.salesCount || 0) > 0 && (
                      <div style={{ position: 'absolute', top: '30px', right: '6px', background: 'rgba(0,0,0,0.65)', color: '#fff', border: '1px solid rgba(173,255,47,0.4)', borderRadius: '8px', padding: '2px 7px', fontSize: '11px', fontWeight: '700', zIndex: 2, display: 'flex', alignItems: 'center', gap: '3px', backdropFilter: 'blur(4px)', lineHeight: 1.4, whiteSpace: 'nowrap' }}>
                        ✓ {formatBagCount(p.salesCount || 0)} bought
                      </div>
                    )}

                    {renderCardImages(p, 160)}
                    <div style={{ padding: '12px' }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 4 }}>
                        <p style={{ margin: 0, flex: 1, minWidth: 0, fontWeight: '700', fontSize: '14px', color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</p>
                        <LikePill liked={isLiked(p.id)} count={likeCountFor(p)} onToggle={p.sellerId === (userId || '') ? undefined : () => handleToggleLike(p)} />
                      </div>
                      <p style={{ margin: '0 0 8px', color: '#555', fontSize: '12px' }}>{p.businessName}</p>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                        <p style={{ margin: 0, fontWeight: '800', color: green, fontSize: '14px' }}>UGX {p.price}</p>
                        <button onClick={(e) => { e.stopPropagation(); setDetailsProduct(p) }}
                          aria-label={`See details for ${p.name}`}
                          style={{ flexShrink: 0, padding: '4px 10px', background: '#222', color: '#ddd', border: '1px solid #333', borderRadius: '999px', fontSize: '11px', fontWeight: '700', cursor: 'pointer', whiteSpace: 'nowrap', lineHeight: 1.5 }}>
                          ⓘ Details
                        </button>
                      </div>
                    </div>
                  </div>
                  {!p.outOfStock && (
                    p.sellerId === (userId || '') ? (
                      <div style={{ padding: '0 12px 12px' }}>
                        <div style={{ padding: '8px', background: '#111', color: '#666', borderRadius: '8px', fontSize: '11px', textAlign: 'center', border: '1px dashed #333' }}>
                          This is your product
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: '6px', padding: '0 12px 12px' }}>
                        <button onClick={(e) => { e.stopPropagation(); setMessageVariant({}); setMessageProduct(p) }}
                          style={{ flex: 1, padding: '8px', background: '#222', color: '#fff', border: '1px solid #333', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '12px' }}>
                          💬 Message
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); setOrderVariant({}); setOrderProduct(p) }}
                          style={{ flex: 1, padding: '8px', background: green, color: '#000', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '12px' }}>
                          Buy Now
                        </button>
                      </div>
                    )
                  )}
                  {p.outOfStock && (
                    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: '700', fontSize: '13px', textAlign: 'center', padding: '8px' }}>
                      Out of Stock
                    </div>
                  )}
                </div>
              ))}

            </div>

            {/* Paging — the old code silently stopped after 50 stores */}
            <div style={{ textAlign: 'center', marginTop: '26px' }}>
              {loadingMore ? (
                <p style={{ color: '#666', fontSize: 13 }}>Loading more products…</p>
              ) : hasMore ? (
                <>
                  <button onClick={loadMore}
                    style={{ padding: '13px 26px', background: '#1a1a1a', color: '#fff', border: `1px solid ${green}`, borderRadius: 10, fontWeight: 700, cursor: 'pointer', fontSize: 14 }}>
                    Load more products ↓
                  </button>
                  {search.trim() && (
                    <p style={{ color: '#555', fontSize: 12, margin: '10px 0 0' }}>
                      A search looks through what's already loaded — tap Load more to search deeper.
                    </p>
                  )}
                </>
              ) : (
                <p style={{ color: '#555', fontSize: 13 }}>That's every product on rachett right now 🎉</p>
              )}
            </div>
          </>
        )}

        {/* Stores directory — every shop, no search needed (this didn't exist before) */}
        {stores.length > 0 && (
          <section style={{ marginTop: '44px', borderTop: '1px solid #1a1a1a', paddingTop: '26px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#fff' }}>🏪 Stores on rachett ({stores.length})</h2>
                <p style={{ margin: '4px 0 0', color: '#666', fontSize: 13 }}>Every shop with a working link — tap one to look around.</p>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {(['newest', 'az'] as const).map(mode => (
                  <button key={mode} onClick={() => setStoreSort(mode)}
                    style={{ padding: '7px 14px', borderRadius: 20, border: `1px solid ${storeSort === mode ? green : '#333'}`, background: storeSort === mode ? '#1a2a1a' : 'transparent', color: storeSort === mode ? green : '#aaa', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                    {mode === 'newest' ? 'Newest' : 'A–Z'}
                  </button>
                ))}
              </div>
            </div>

            <div className="rt-products" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 14 }}>
              {visibleStores.map(store => (
                <StoreCard key={store.slug} store={store} onClick={() => navigate(`/store/${store.slug}`)} />
              ))}
            </div>

            {stores.length > STORE_DIRECTORY_LIMIT && (
              <div style={{ textAlign: 'center', marginTop: 18 }}>
                <button onClick={() => setShowAllStores(v => !v)}
                  style={{ padding: '11px 22px', background: 'transparent', color: green, border: `1px solid ${green}`, borderRadius: 10, fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>
                  {showAllStores ? 'Show fewer stores ↑' : `Show all ${stores.length} stores ↓`}
                </button>
              </div>
            )}
          </section>
        )}
      </div>

      {/* Product Survey Modal */}
      {surveyProduct && (() => {
        const surveyImages = getSurveyImages(surveyProduct)
        const currentImg = surveyImages[surveyImageIndex] || surveyProduct.imageUrl || ''
        return (
          <div onClick={closeSurvey}
            style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.92)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', overflowY: 'auto' }}>
            <div onClick={e => e.stopPropagation()}
              style={{ background: '#1a1a1a', borderRadius: '16px', padding: '20px', width: '100%', maxWidth: '420px', border: '1px solid #222', maxHeight: '92vh', overflowY: 'auto' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <span style={{ color: '#888', fontSize: '12px', fontWeight: '600' }}>Product details</span>
                <button onClick={closeSurvey}
                  style={{ background: 'transparent', border: 'none', color: '#555', fontSize: '20px', cursor: 'pointer', padding: '0 4px' }}>✕</button>
              </div>

              {/* Survey Image */}
              <div style={{ position: 'relative', borderRadius: '12px', overflow: 'hidden', marginBottom: '14px' }}>
                <img src={currentImg || 'https://placehold.co/600x400/1a1a1a/333333'} alt={surveyProduct.name}
                  style={{ width: '100%', height: '280px', objectFit: 'cover', display: 'block' }} />
                {surveyImages.length > 1 && (
                  <>
                    <button onClick={() => setSurveyImageIndex(prev => (prev === 0 ? surveyImages.length - 1 : prev - 1))}
                      style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', background: 'rgba(0,0,0,0.6)', border: 'none', color: '#fff', borderRadius: '50%', width: '36px', height: '36px', cursor: 'pointer', fontSize: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      ‹
                    </button>
                    <button onClick={() => setSurveyImageIndex(prev => (prev === surveyImages.length - 1 ? 0 : prev + 1))}
                      style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'rgba(0,0,0,0.6)', border: 'none', color: '#fff', borderRadius: '50%', width: '36px', height: '36px', cursor: 'pointer', fontSize: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      ›
                    </button>
                    <div style={{ position: 'absolute', bottom: '10px', right: '10px', background: 'rgba(0,0,0,0.7)', color: '#fff', padding: '4px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: '700' }}>
                      {surveyImageIndex + 1}/{surveyImages.length}
                    </div>
                  </>
                )}
              </div>

              <h2 style={{ margin: '0 0 4px', fontSize: '18px', fontWeight: '800', color: '#fff' }}>{surveyProduct.name}</h2>
              <p style={{ margin: '0 0 8px', color: '#888', fontSize: '13px' }}>{surveyProduct.businessName}</p>
              <p style={{ margin: '0 0 12px', fontWeight: '800', fontSize: '18px', color: green }}>UGX {surveyProduct.price}</p>
              {(bagCounts[surveyProduct.id]?.baggedCount || 0) > 0 || (surveyProduct.salesCount || 0) > 0 ? (
                <div style={{ display: 'flex', gap: '14px', marginBottom: '12px', flexWrap: 'wrap' }}>
                  {(bagCounts[surveyProduct.id]?.baggedCount || 0) > 0 && (
                    <span style={{ color: '#aaa', fontSize: '13px', fontWeight: '700' }}>🛍️ {formatBagCount(bagCounts[surveyProduct.id]?.baggedCount || 0)} accounts bagged this</span>
                  )}
                  {(surveyProduct.salesCount || 0) > 0 && (
                    <span style={{ color: '#8fd14f', fontSize: '13px', fontWeight: '700' }}>✓ {formatBagCount(surveyProduct.salesCount || 0)} bought</span>
                  )}
                </div>
              ) : null}
              {surveyProduct.description && (
                <p style={{ margin: '0 0 16px', color: '#aaa', fontSize: '13px', lineHeight: 1.6 }}>{surveyProduct.description}</p>
              )}

              {/* Actions */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <button onClick={() => handleToggleBag(surveyProduct)}
                  style={{ padding: '12px', background: isInBag(surveyProduct.id) ? '#1a2a1a' : '#222', color: green, border: `1px solid ${green}`, borderRadius: '10px', fontWeight: '700', cursor: 'pointer', fontSize: '14px' }}>
                  {isInBag(surveyProduct.id) ? '✓ In Bag — Tap to Remove' : `🛍️ Add to Bag (${formatBagCount(bagCounts[surveyProduct.id]?.baggedCount || 0)} bagged)`}
                </button>
                {surveyProduct.sellerId === (userId || '') ? (
                  <p style={{ margin: 0, padding: '12px', background: '#111', color: '#666', borderRadius: '10px', fontSize: '13px', textAlign: 'center', border: '1px dashed #333' }}>
                    This is your product
                  </p>
                ) : (
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={() => { setMessageProduct(surveyProduct); setSurveyProduct(null) }}
                      style={{ flex: 1, padding: '12px', background: '#222', color: '#fff', border: '1px solid #333', borderRadius: '10px', fontWeight: '700', cursor: 'pointer', fontSize: '14px' }}>
                      💬 Message
                    </button>
                    <button onClick={() => { setOrderProduct(surveyProduct); setSurveyProduct(null) }}
                      style={{ flex: 1, padding: '12px', background: green, color: '#000', border: 'none', borderRadius: '10px', fontWeight: '700', cursor: 'pointer', fontSize: '14px' }}>
                      Buy Now
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      })()}

      {/* Order Modal */}
      {/* The details sheet: the whole product — photos, colour, size — and Buy, without a
          page load. The page keeps owning the order and message forms below. */}
      {detailsProduct && (
        <ProductSheet
          key={detailsProduct.id}
          product={detailsProduct}
          surface="browse"
          liked={isLiked(detailsProduct.id)}
          likeCount={likeCountFor(detailsProduct)}
          onToggleLike={() => handleToggleLike(detailsProduct)}
          isMine={detailsProduct.sellerId === (userId || '')}
          inBag={isInBag(detailsProduct.id)}
          onClose={() => setDetailsProduct(null)}
          onBuy={(variant, qty) => { setOrderVariant(variant); setQuantity(String(qty)); setOrderProduct(detailsProduct); setDetailsProduct(null) }}
          onMessage={(variant) => { setMessageVariant(variant); setMessageProduct(detailsProduct); setDetailsProduct(null) }}
          onToggleBag={(variant, qty) => handleSheetBag(detailsProduct, variant, qty)}
          onOpenStore={() => { const slug = detailsProduct.sellerSlug; setDetailsProduct(null); navigate(`/store/${slug}`) }}
        />
      )}

      {orderProduct && (
        <div onClick={() => { setOrderProduct(null); setOrderSuccess(false) }}
          style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', overflowY: 'auto' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: '#1a1a1a', borderRadius: '16px', padding: '28px', width: '100%', maxWidth: '400px', border: '1px solid #222', textAlign: 'center' }}>
            {orderSuccess ? (
              <div>
                <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: green, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', fontSize: '28px', color: '#000', fontWeight: '800' }}>
                  ✓
                </div>
                <h3 style={{ color: '#fff', fontWeight: '800', fontSize: '18px', margin: '0 0 8px' }}>Order Sent!</h3>
                <p style={{ color: '#888', fontSize: '14px', margin: 0 }}>The seller will contact you to confirm delivery.</p>
              </div>
            ) : !auth.currentUser || auth.currentUser.isAnonymous ? (
              <SignInPrompt
                action="order"
                returnTo="/browse"
                productId={orderProduct?.id}
                sellerSlug={orderProduct?.sellerSlug}
                onLeave={() => setOrderProduct(null)}
              />
            ) : (
              <>
                <h3 style={{ margin: '0 0 4px', fontSize: '18px', fontWeight: '800', color: '#fff', textAlign: 'left' }}>
                  Order {orderProduct.name}
                </h3>
                <p style={{ margin: '0 0 24px', color: green, fontSize: '14px', fontWeight: '700', textAlign: 'left' }}>
                  UGX {orderProduct.price} each
                  {variantLabel(orderVariant.color, orderVariant.size) && (
                    <span style={{ color: '#ddd' }}> · {variantLabel(orderVariant.color, orderVariant.size)}</span>
                  )}
                </p>
                <input placeholder="Your name" value={shownName} onChange={e => setBuyerName(e.target.value)}
                  style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #333', marginBottom: '6px', boxSizing: 'border-box', fontSize: '14px', background: '#111', color: '#fff' }} />
                <p style={{ margin: '0 0 12px', color: '#777', fontSize: 12, textAlign: 'left' }}>
                  Sellers see you as <strong style={{ color: green }}>{nameLabel(shownName)}</strong>
                </p>
                <input placeholder="Quantity" value={quantity} onChange={e => setQuantity(e.target.value)} type="number" min="1"
                  style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #333', marginBottom: '12px', boxSizing: 'border-box', fontSize: '14px', background: '#111', color: '#fff' }} />
                <input placeholder="Delivery area e.g. Nakawa, Kampala" value={deliveryArea} onChange={e => setDeliveryArea(e.target.value)}
                  style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #333', marginBottom: '12px', boxSizing: 'border-box', fontSize: '14px', background: '#111', color: '#fff' }} />
                <textarea placeholder="Write a message to the seller (optional)" value={orderMessage} onChange={e => setOrderMessage(e.target.value)}
                  style={{ width: '100%', minHeight: '80px', padding: '12px', borderRadius: '8px', border: '1px solid #333', marginBottom: '20px', boxSizing: 'border-box', fontSize: '14px', background: '#111', color: '#fff', resize: 'vertical' }} />
                <button onClick={handleOrder}
                  style={{ width: '100%', padding: '14px', background: green, color: '#000', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '15px', marginBottom: '12px' }}>
                  Send Order
                </button>
                <button onClick={() => { setOrderProduct(null); setOrderSuccess(false) }}
                  style={{ width: '100%', padding: '12px', background: 'transparent', color: '#555', border: '1px solid #222', borderRadius: '8px', cursor: 'pointer', fontSize: '14px' }}>
                  Cancel
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Message Modal */}
      {messageProduct && (
        <div onClick={closeMessageModal}
          style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', overflowY: 'auto' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: '#1a1a1a', borderRadius: '16px', padding: '28px', width: '100%', maxWidth: '400px', border: '1px solid #222', textAlign: 'center' }}>
            <h3 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: '800', color: '#fff', textAlign: 'left' }}>
              Message about {messageProduct.name}
            </h3>
            <div style={{ marginBottom: '20px', padding: '12px', background: '#111', borderRadius: '8px', border: '1px solid #333' }}>
              <img src={messageProduct.imageUrl || 'https://placehold.co/300x120/1a1a1a/333333'} alt={messageProduct.name}
                style={{ width: '100%', height: '120px', objectFit: 'cover', borderRadius: '6px', marginBottom: '8px' }} />
              <p style={{ margin: '0 0 4px', fontWeight: '700', fontSize: '13px', color: '#fff', textAlign: 'left' }}>{messageProduct.name}</p>
              <p style={{ margin: 0, color: green, fontSize: '13px', fontWeight: '700', textAlign: 'left' }}>UGX {messageProduct.price}</p>
              {variantLabel(messageVariant.color, messageVariant.size) && (
                <p style={{ margin: '2px 0 0', color: '#ddd', fontSize: '13px', fontWeight: '700', textAlign: 'left' }}>
                  {variantLabel(messageVariant.color, messageVariant.size)}
                </p>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: showQuickReplies ? '12px' : '16px' }}>
              <button onClick={() => setShowQuickReplies(!showQuickReplies)}
                style={{ padding: '6px 12px', background: showQuickReplies ? '#1a2a1a' : '#111', color: green, border: `1px solid ${green}`, borderRadius: '20px', cursor: 'pointer', fontSize: '12px', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '5px' }}>
                ⚡ Quick replies {showQuickReplies ? '▲' : '▼'}
              </button>
            </div>
            {showQuickReplies && (
              <div style={{ marginBottom: '16px' }}>
                <QuickRepliesPanel onPick={q => { setMessageText(q); setShowQuickReplies(false) }} />
              </div>
            )}


            {auth.currentUser ? (
              <>
                {/* Message Input */}
                {draftMsg && (
                  <span style={{ color: '#888', fontSize: 12, fontWeight: 700, display: 'block', marginBottom: 4 }}>
                    📝 Saved as a draft — it stays in your Inbox until you send or cancel.
                  </span>
                )}
                <textarea placeholder="Write your message..." value={messageText} onChange={e => setMessageText(e.target.value)}
                  style={{ width: '100%', minHeight: '100px', padding: '12px', borderRadius: '8px', border: '1px solid #333', marginBottom: '8px', boxSizing: 'border-box', fontSize: '14px', background: '#111', color: '#fff', resize: 'vertical' }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '20px' }}>
                  <button onClick={() => guestFileRef.current?.click()} disabled={guestUploading}
                    style={{ padding: '8px 12px', background: '#222', color: '#fff', border: '1px solid #333', borderRadius: '8px', cursor: guestUploading ? 'not-allowed' : 'pointer', fontSize: '12px', fontWeight: 700, whiteSpace: 'nowrap' }}>
                    {guestUploading ? '⏳ Uploading…' : '📎 Add photo'}
                  </button>
                  <input ref={guestFileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleGuestPhoto} />
                  {guestImageUrl && (
                    <div style={{ position: 'relative' }}>
                      <img src={guestImageUrl} alt="photo" style={{ width: 48, height: 48, borderRadius: 8, objectFit: 'cover' }} />
                      <button onClick={() => setGuestImageUrl('')} style={{ position: 'absolute', top: -6, right: -6, background: '#ff4444', border: 'none', color: '#fff', borderRadius: '50%', width: 18, height: 18, cursor: 'pointer', fontSize: 11, lineHeight: 1 }}>✕</button>
                    </div>
                  )}
                </div>
                <button onClick={handleSendMessage}
                  style={{ width: '100%', padding: '14px', background: green, color: '#000', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '15px', marginBottom: '12px' }}>
                  Send Message
                </button>
              </>
            ) : (
              <SignInPrompt
                action="message"
                returnTo="/browse"
                productId={messageProduct?.id}
                sellerSlug={messageProduct?.sellerSlug}
                onLeave={closeMessageModal}
              />
            )}

            <button onClick={cancelMessageModal}
              style={{ width: '100%', padding: '12px', background: 'transparent', color: '#555', border: '1px solid #222', borderRadius: '8px', cursor: 'pointer', fontSize: '14px' }}>
              Cancel
            </button>


          </div>
        </div>
      )}

      <FloatingBag count={bagCount} />
    </div>
  )
}

export default BrowsePage