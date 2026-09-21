/**
 * The rachett event taxonomy — the single place that says what we record.
 *
 * Every event name and every property it is allowed to carry lives here, so:
 *  - a typo like `trackEvent('prodcut_viewed')` becomes a compile error;
 *  - the shape of each event is documented instead of guessed;
 *  - the training-data exporter and the analytics report read the same list.
 *
 * Rules of the house:
 *  - snake_case names; past tense for things that happened (`bag_added`).
 *  - props carry IDs, counts, categories and money strings — **never** names,
 *    phone numbers, emails, delivery addresses or message text
 *    (see DATA_COLLECTION.md §8). Keep values to JSON scalars.
 *  - `*_viewed` = the person acted (opened it); `*_impression` = it was simply
 *    on screen. Keeping those apart is what makes funnels honest.
 *
 * NOTE: `search_performed`, `product_viewed`, `product_surveyed`, `store_visited`,
 * `category_browsed`, `order_placed` and `message_sent` are the names already
 * being written before this file existed — legacy callers keep working.
 */
export const EVENT_PROPS = {
  // ── Session & acquisition ────────────────────────────────────────────────
  session_start: ['entry', 'returning'],
  page_viewed: ['route', 'title'],
  first_touch_captured: ['had_previous'],
  signin_wall_shown: ['action', 'surface'],
  signin_wall_passed: ['action', 'surface', 'method'],
  signin_completed: ['method', 'role'],
  signup_completed: ['method', 'role'],
  signout: ['role'],
  role_selected: ['role'],
  store_created: ['sellerId', 'slug', 'country', 'hasLogo', 'logoSource'],
  phone_verification_sent: ['country', 'method'],
  phone_verified: ['country', 'method'],

  // ── Discovery ────────────────────────────────────────────────────────────
  browse_viewed: ['category', 'storeCount'],
  feed_page_loaded: ['page', 'count'],
  category_browsed: ['category'],
  sort_changed: ['sortBy', 'surface'],
  rail_tapped: ['rail', 'position'],
  shuffle_tapped: [],
  store_visited: ['sellerId', 'slug', 'productCount', 'channel'],
  store_edited: ['sellerId', 'fields'],
  // The shop's face. Fired on every logo upload (setup or Edit Store) so we can later ask
  // the one question this feature exists to answer: do shops that look like shops stay?
  // `failed` is true when the upload itself failed — a seller who *tried* is not the same
  // as a seller who never saw the button.
  store_logo_added: ['source', 'surface', 'failed'],

  // ── Nearby (its own surface, never mixed into Browse) ────────────────────
  nearby_viewed: ['areaSet', 'rangeKm', 'sortMode', 'sellerCount'],
  nearby_results: ['count', 'sellerCount', 'areaSet', 'rangeKm', 'sortMode', 'category'],
  nearby_sort_changed: ['sortMode', 'previousSortMode', 'resultCount'],
  nearby_range_changed: ['rangeKm', 'previousRangeKm', 'preset', 'resultCount'],
  nearby_area_set: ['method', 'hadArea'],
  nearby_store_opened: ['sellerId', 'slug', 'distanceKm'],

  // ── Search ───────────────────────────────────────────────────────────────
  search_performed: ['query', 'surface', 'resultCount', 'zeroResult', 'category', 'sortBy'],
  search_suggestion_clicked: ['query', 'suggestion', 'kind', 'surface'],
  recent_search_clicked: ['query', 'surface'],
  search_cleared: ['surface', 'hadQuery'],

  // ── Products ─────────────────────────────────────────────────────────────
  product_impression: ['productId', 'sellerId', 'surface', 'position'],
  product_viewed: ['productId', 'sellerId', 'sellerSlug', 'surface', 'position', 'category'],
  product_surveyed: ['productId', 'sellerId', 'sellerSlug', 'surface'],
  product_previewed: ['productId', 'imageIndex'],
  product_shared: ['productId', 'sellerId', 'channel', 'surface'],
  product_out_of_stock_seen: ['productId', 'sellerId'],

  // ♥ Likes — universal, one vote per account. `source` says whether the vote came from a
  // card tap or the post-purchase "Did you love it?" prompt.
  product_liked: ['productId', 'sellerId', 'surface', 'source'],
  product_unliked: ['productId', 'sellerId', 'surface', 'source'],

  // The details sheet: the whole product (photos, colour, size) and Buy, without a page load.
  // `closed` is the honest half — `action: 'none'` is someone who looked and left, and
  // `dwellMs` is how long it held them. Compare sheet → order latency with store → order.
  product_sheet_opened: ['productId', 'sellerId', 'surface', 'hasVariants'],
  product_sheet_closed: ['productId', 'surface', 'dwellMs', 'action'],

  // ── Bag (the only "save" we have today) ──────────────────────────────────
  bag_opened: ['size'],
  bag_added: ['productId', 'sellerId', 'price', 'surface', 'bagSize'],
  bag_removed: ['productId', 'sellerId', 'price', 'surface', 'bagSize'],
  bag_quantity_changed: ['productId', 'from', 'to'],
  bag_cleared: ['size'],
  bag_abandoned: ['size', 'idleMinutes'],
  checkout_started: ['size', 'sellerCount'],

  // ── Messaging ────────────────────────────────────────────────────────────
  conversation_opened: ['conversationId', 'counterpartRole', 'threadType', 'unread'],
  message_sent: ['conversationId', 'senderRole', 'productId', 'sellerId', 'hasPhoto', 'isQuickReply', 'length', 'surface', 'channel'],
  seller_first_response: ['conversationId', 'latencyMinutes', 'productId'],
  // Drafts: typed but never sent. `resumed` fires when an Inbox draft row is opened.
  message_draft_started: ['conversationId', 'surface', 'productId', 'sellerId', 'length'],
  message_draft_resumed: ['conversationId', 'surface', 'ageMinutes'],
  message_draft_abandoned: ['conversationId', 'surface', 'length'],
  quick_reply_created: ['count', 'length'],
  image_uploaded: ['kind', 'surface', 'failed'],

  // ── Orders ───────────────────────────────────────────────────────────────
  order_placed: ['orderId', 'productId', 'sellerId', 'price', 'quantity', 'bagSize', 'channel', 'surface'],
  order_viewed: ['orderId', 'status'],
  // The buyer's own orders list — how many orders they saw gathered in one place.
  buyer_orders_viewed: ['count'],
  order_status_changed: ['orderId', 'from', 'to', 'latencyMinutes', 'productId'],
  order_deleted: ['orderId', 'status'],
  // Reserved for the buyer-side actions that don't exist yet (plan M5 — they
  // need an order-update rule only a seller has today):
  order_cancelled: ['orderId', 'by', 'reason'],
  order_completed: ['orderId', 'by', 'latencyMinutes'],

  // The post-purchase ♥ question, asked on the delivered order bubble. `answer: 'no'` is the
  // only place a "not loved" ever shows up — nothing public is written for it.
  love_prompt_shown: ['orderId', 'productId'],
  love_prompt_answered: ['orderId', 'productId', 'answer'],

  // ── Seller operations ────────────────────────────────────────────────────
  product_created: ['productId', 'category', 'hasImage', 'price'],
  product_updated: ['productId', 'fields'],
  product_deleted: ['productId'],
  stock_toggled: ['productId', 'outOfStock'],
  published_toggled: ['productId', 'published'],
  bulk_upload_finished: ['count', 'failed'],
  store_link_copied: ['sellerId', 'surface'],
  store_shared: ['sellerId', 'channel', 'surface'],
  qr_viewed: ['sellerId'],
  feedback_submitted: ['category', 'role', 'source'],
  // The after-use ask: shown, dismissed, and whether it earned an answer.
  feedback_prompt_shown: ['actions'],
  feedback_prompt_dismissed: ['actions'],

  // ── Health ───────────────────────────────────────────────────────────────
  error_shown: ['kind', 'message'],
} as const

export type EventName = keyof typeof EVENT_PROPS
/** Values an event property may hold — JSON scalars only. */
export type EventPropValue = string | number | boolean | null | undefined
export type EventProps = Record<string, EventPropValue>

export function isKnownEvent(name: string): name is EventName {
  return Object.prototype.hasOwnProperty.call(EVENT_PROPS, name)
}

/** Vite injects `import.meta.env`; guard so plain Node (tests, scripts) is fine. */
const isDev = Boolean(import.meta.env?.DEV)

/**
 * Keeps only the properties this event may carry. Unknown keys are dropped
 * (and logged in dev), so one stray field can never quietly reshape the
 * event lake.
 */
export function pickAllowedProps(name: EventName, props?: EventProps): EventProps {
  if (!props) return {}
  const allowed: readonly string[] = EVENT_PROPS[name]
  const out: EventProps = {}
  for (const key of allowed) {
    const value = props[key]
    if (value !== undefined) out[key] = value
  }
  const dropped = Object.keys(props).filter(key => !allowed.includes(key))
  if (dropped.length > 0 && isDev) {
    console.warn(`[analytics] ${name}: dropped prop(s) not in the taxonomy →`, dropped)
  }
  return out
}
