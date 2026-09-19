# rachett analytics

Every action that matters is recorded once, on the client, in one shape, so the
whole buyer and seller journey can be replayed later — funnels, conversion,
search demand, product performance, seller responsiveness and acquisition.

**The code**

| File | What it owns |
|---|---|
| `src/analytics/taxonomy.ts` | **The source of truth** — 63 event names and the exact properties each may carry |
| `src/analytics/core.ts` | Batch shape, batching rules, route normalisation (pure — no Firebase) |
| `src/analytics/identity.ts` | Session id, device (anonymous) id, first touch, opt-out (pure — injectable storage) |
| `src/analytics/client.ts` | Queue → batch → one Firestore write; flush triggers; offline buffer |
| `src/analytics/impressions.ts`, `useImpression.ts` | `product_impression` (once per product per session) |
| `src/analytics/index.ts` | The public API the app imports |
| `src/tracking.ts` | The old `track()` API, now a shim onto the above (existing call sites keep working) |
| `functions/analytics-report.js` | The report: funnels, conversion, search, products, sellers, Nearby, acquisition |

## The rules of the house

1. **New event? Add it to `taxonomy.ts` first.** A name that isn't in the file is
   a compile error, and properties that aren't listed are dropped (with a dev
   warning) — so the event lake can't quietly change shape.
2. **Never put people in the props.** IDs, counts, categories, money strings —
   never names, phone numbers, emails, delivery addresses, or message text.
   Message *length* and *has photo* are fine; the text is not.
3. **`*_viewed` means they acted; `*_impression` means it was on screen.** Keeping
   those apart is what makes the funnel honest.
4. **Names are `snake_case` and past tense** (`bag_added`, `order_placed`).

## What a batch looks like

One document in `events` per ≤25 events (same data, ~25× fewer writes):

```
{
  schemaVersion: 2,          // absent on the older single-event documents
  appVersion: "0.0.0+2026-09-16",
  sessionId, anonymousId,    // who, without needing an account
  userId: "<uid>" | "guest",
  role: "buyer" | "seller" | null,
  firstTouch: { source, referrer, landing, at },
  platform: { ua, lang, tz, screen, standalone },
  count, clientAt, sentAt, expireAt,
  events: [ { n: "bag_added", t: 1757..., r: "/browse", s?: "WhatsApp", p: { productId: "…" } } ]
}
```

Flush triggers: 25 events queued, 10 seconds elapsed, the tab is hidden, the page
is closing, or the device comes back online. Failures keep the events in a
bounded offline buffer (200, oldest dropped) and never break the UI.

## Identity, without accounts

- **`sessionId`** — rotates after 30 minutes of silence (`sessionStorage`).
- **`anonymousId`** — a stable per-device id (`localStorage`), so a signed-out
  visitor is still a *person you can follow* across pages. Previously every guest
  collapsed into the single string `'guest'`, which made funnels impossible.
- **`firstTouch`** — the channel and landing URL of their very first visit,
  written once and never overwritten, so "came from WhatsApp" stays true even if
  they order an hour later.
- **Opt-out** — `localStorage.rachett_analytics_off = '1'` silences every writer
  (see `setAnalyticsOptOut`). Nothing is queued or sent in that state.

## The events (66)

✅ = wired in the app today · ⏳ = reserved name, add the call when the feature or
the page needs it.

| Event | Properties | Status |
|---|---|---|
| `session_start` | entry, returning | ✅ |
| `page_viewed` | route, title | ✅ |
| `first_touch_captured` | had_previous | ✅ |
| `signin_wall_shown` | action, surface | ✅ |
| `signin_wall_passed` | action, surface, method | ✅ |
| `signin_completed` | method, role | ⏳ |
| `signup_completed` | method, role | ⏳ |
| `signout` | role | ⏳ |
| `role_selected` | role | ⏳ |
| `store_created` | sellerId, slug, country | ⏳ |
| `browse_viewed` | category, storeCount | ✅ |
| `feed_page_loaded` | page, count | ✅ |
| `category_browsed` | category | ✅ |
| `sort_changed` | sortBy, surface | ✅ |
| `rail_tapped` | rail, position | ⏳ |
| `shuffle_tapped` | — | ⏳ |
| `store_visited` | sellerId, slug, productCount, channel | ✅ |
| `store_edited` | sellerId, fields | ⏳ |
| `nearby_viewed` | areaSet, rangeKm, sortMode, sellerCount | ✅ |
| `nearby_results` | count, sellerCount, areaSet, rangeKm, sortMode, category | ✅ |
| `nearby_sort_changed` | sortMode, previousSortMode, resultCount | ✅ |
| `nearby_range_changed` | rangeKm, previousRangeKm, preset, resultCount | ✅ |
| `nearby_area_set` | method, hadArea | ✅ |
| `nearby_store_opened` | sellerId, slug, distanceKm | ⏳ |
| `search_performed` | query, surface, resultCount, zeroResult, category, sortBy | ✅ (Browse, Nearby) |
| `search_suggestion_clicked` | query, suggestion, kind, surface | ✅ (Browse + Nearby type-ahead) |
| `recent_search_clicked` | query, surface | ⏳ |
| `search_cleared` | surface, hadQuery | ✅ |
| `product_impression` | productId, sellerId, surface, position | ✅ |
| `product_viewed` | productId, sellerId, sellerSlug, surface, position, category | ✅ |
| `product_surveyed` | productId, sellerId, sellerSlug, surface | ✅ |
| `product_previewed` | productId, imageIndex | ⏳ |
| `product_shared` | productId, sellerId, channel, surface | ⏳ (no share button yet) |
| `product_out_of_stock_seen` | productId, sellerId | ⏳ |
| `product_liked` | productId, sellerId, surface, source | ✅ (♥ on Browse / Nearby / Store, and the post-purchase prompt) |
| `product_unliked` | productId, sellerId, surface, source | ✅ (tapping a filled ♥ takes the vote back) |
| `love_prompt_shown` | orderId, productId | ✅ (the delivered order bubble, buyer side) |
| `love_prompt_answered` | orderId, productId, answer | ✅ (`yes` / `no` — a `no` is recorded here and nowhere else) |
| `bag_opened` | size | ✅ |
| `bag_added` | productId, sellerId, price, surface, bagSize | ✅ |
| `bag_removed` | productId, sellerId, price, surface, bagSize | ✅ |
| `bag_quantity_changed` | productId, from, to | ✅ |
| `bag_cleared` | size | ✅ |
| `bag_abandoned` | size, idleMinutes | ✅ |
| `checkout_started` | size, sellerCount | ✅ |
| `conversation_opened` | conversationId, counterpartRole, threadType, unread | ✅ |
| `message_sent` | conversationId, senderRole, productId, sellerId, hasPhoto, isQuickReply, length, surface, channel | ✅ |
| `seller_first_response` | conversationId, latencyMinutes, productId | ✅ |
| `message_draft_started` | conversationId, surface, productId, sellerId, length | ✅ |
| `message_draft_resumed` | conversationId, surface, ageMinutes | ✅ |
| `message_draft_abandoned` | conversationId, surface, length | ✅ |
| `quick_reply_created` | count, length | ⏳ |
| `image_uploaded` | kind, surface, failed | ✅ (chat photos) |
| `order_placed` | orderId, productId, sellerId, price, quantity, bagSize, channel, surface | ✅ |
| `order_viewed` | orderId, status | ✅ (seller) |
| `order_status_changed` | orderId, from, to, latencyMinutes, productId | ✅ (seller) |
| `order_deleted` | orderId, status | ✅ (seller) |
| `order_cancelled` | orderId, by, reason | ⏳ |
| `order_completed` | orderId, by, latencyMinutes | ⏳ |
| `product_created` | productId, category, hasImage, price | ⏳ |
| `product_updated` | productId, fields | ⏳ |
| `product_deleted` | productId | ⏳ |
| `stock_toggled` | productId, outOfStock | ⏳ |
| `published_toggled` | productId, published | ⏳ |
| `bulk_upload_finished` | count, failed | ⏳ |
| `store_link_copied` | sellerId, surface | ⏳ |
| `store_shared` | sellerId, channel, surface | ⏳ |
| `qr_viewed` | sellerId | ⏳ |
| `feedback_submitted` | category, role | ⏳ |
| `error_shown` | kind, message | ⏳ |

### Two names that must stay reserved for now

`order_cancelled` and `order_completed` describe actions **that do not exist yet**:
only a seller can update an order (`firestore.rules:33-36`), so a buyer can't
cancel or confirm receipt. Today a "cancellation" shows up as `order_deleted` or
`order_status_changed` → `out_of_stock`, and confirmation is `fulfilled`. Adding
the buyer-side actions is a rules change — tracked in the plan as M5.

## Running the report

```
cd functions
npm install                                     # once — firebase-admin
node analytics-report.js --since=2026-09-01
node analytics-report.js --since=2026-08-01 --seller=<uid|slug>
node analytics-report.js --since=2026-09-01 --json > report.json
node analytics-report.js --since=2026-09-01 --out=../report.txt
```

Also available as `npm run analytics:report` from the repo root. Sections:

- **FUNNEL** — unique visitors at each stage (store seen → product seen → opened →
  bagged → checkout → ordered → confirmed), with % of first and % of previous.
- **ACQUISITION** — first-touch channel → visitors → orders → conversion.
- **SEARCH** — searches per surface, the top queries, and **queries that found
  nothing** (that list is your product roadmap).
- **PRODUCTS** — seen → opened → bagged → ordered → confirmed per product, plus the ♥
  likes cast in the window (split into card taps and post-purchase votes), "seen a lot,
  never ordered", and **"delivered 3+ times and never loved"** (where a "did you love
  it? — no" ends up).
- **SELLER PERFORMANCE** — visits, orders, confirmed, **average confirmation
  latency** and **average first-reply time** (minutes), out-of-stock rate,
  orders per visit.
- **NEARBY** — its own block: sessions, average results shown, sort-chip usage,
  range choices, area usage, orders placed from Nearby.
- **SIGN-IN WALL** — shown vs resumed-after-signing-in, per action.
- **DAILY** — events, visitors, orders, confirmations per day.
- **DATA HEALTH** — event counts, build versions, how many legacy v1 documents
  lack identity. **Read this first** before trusting anything above.

Reading older data: documents written before this system have no `sessionId`, so
their funnel contribution lands in the shared `'guest'` bucket. v2 batches carry
`schemaVersion: 2`; the report handles both and reports the split.

## Retention

Every batch carries `expireAt` (400 days out), but **nothing is deleted until you
turn on a TTL policy**: Firebase console → Firestore → TTL → collection `events`,
field `expireAt`. Documents without the field — which is every older document —
are never touched by that policy, so enabling it can't erase history you haven't
decided about. Change the horizon in `src/analytics/core.ts` (`RAW_TTL_DAYS`).

## Adding an event

1. Add the name and its allowed properties to `src/analytics/taxonomy.ts`.
2. Import `{ trackEvent } from './analytics'` where the action happens and call it
   with those properties. Nothing else — the batch, identity and flush are handled.
3. `npx tsc --noEmit -p tsconfig.app.json` · `npm run build` · `npx eslint src`
   (the taxonomy makes typos compile errors, so this step is quick).
4. Run the report and check **DATA HEALTH** lists the new event.

## Not built (deliberately)

No machine-learning models, no session recording, no third-party analytics, no
push tokens. This is first-party, structured, queryable data — the raw material
for funnels today and for modelling later. Seller-facing dashboards (reading this
data back inside the app) need new collections and rules, so they come in M4 once
rules can be deployed.
