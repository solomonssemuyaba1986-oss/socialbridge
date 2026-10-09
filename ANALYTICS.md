# rachett analytics

Every action that matters is recorded once, on the client, in one shape, so the
whole buyer and seller journey can be replayed later — funnels, conversion,
search demand, product performance, seller responsiveness and acquisition.

**The code**

| File | What it owns |
|---|---|
| `src/analytics/taxonomy.ts` | **The source of truth** — 65 event names and the exact properties each may carry |
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

## The events (104)

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
| `buyer_name_prompt_shown` | hasSuggestion, surface | ✅ (the one-time name ask — Inbox / checkout / comment form) |
| `buyer_name_saved` | source, wasSuggestion, surface | ✅ (`source` = google · email · self) |
| `buyer_name_skipped` | surface | ✅ (tapped "Later" — asked once, never again) |
| `demographics_prompt_shown` | surface | ✅ (the one-time age & gender ask — onboarding · setup · profile · the gate) |
| `demographics_answered` | ageBand, gender, surface, changed | ✅ (categories only — `25-34`, `female`; `undisclosed` = "prefer not to say"; `changed` = they corrected an earlier answer) |
| `store_created` | sellerId, slug, country, hasLogo, logoSource | ✅ |
| `phone_verification_sent` | country, method | ✅ |
| `phone_verified` | country, method | ✅ |
| `browse_viewed` | category, storeCount | ✅ |
| `feed_page_loaded` | page, count | ✅ |
| `category_browsed` | category | ✅ |
| `sort_changed` | sortBy, surface | ✅ |
| `rail_tapped` | rail, position | ⏳ |
| `shuffle_tapped` | — | ⏳ |
| `store_visited` | sellerId, slug, productCount, channel | ✅ |
| `store_edited` | sellerId, fields | ⏳ |
| `store_logo_added` | source, surface, failed | ✅ (Setup Store step 1 — optional — and Edit Store) |
| `nearby_viewed` | areaSet, rangeKm, sortMode, sellerCount | ✅ |
| `nearby_results` | count, sellerCount, areaSet, rangeKm, sortMode, category | ✅ |
| `nearby_sort_changed` | sortMode, previousSortMode, resultCount | ✅ |
| `nearby_range_changed` | rangeKm, previousRangeKm, preset, resultCount | ✅ |
| `nearby_area_set` | method, hadArea | ✅ |
| `nearby_store_opened` | sellerId, slug, distanceKm | ⏳ |
| `search_performed` | query, surface, resultCount, zeroResult, category, sortBy | ✅ (Browse + Nearby — fired by the 🔍 button, the phone's Search key, Enter, or a recent search) |
| `search_suggestion_clicked` | query, suggestion, kind, surface | ✅ (Browse + Nearby type-ahead) |
| `search_correction_tapped` | query, suggestion, surface | ✅ (Browse — the “did you mean” button in the empty state, corrected against words real listings carry) |
| `recent_search_clicked` | query, surface | ⏳ |
| `history_entry_opened` | surface, bucket | ✅ (opening something from your own history strip — Browse or Nearby, `bucket` = today · yesterday · past 3 days · this week · last week · this month · last month) |
| `history_cleared` | surface, count | ✅ ("Clear history" — count is what was wiped) |
| `search_cleared` | surface, hadQuery | ✅ |
| `product_impression` | productId, sellerId, surface, position | ✅ |
| `product_viewed` | productId, sellerId, sellerSlug, surface, position, category | ✅ |
| `product_surveyed` | productId, sellerId, sellerSlug, surface | ✅ |
| `product_previewed` | productId, imageIndex | ⏳ |
| `product_shared` | productId, sellerId, channel, surface | ✅ (the seller's own share sheet — Marketing, or the phone's native sheet; `channel` = whatsapp · telegram · facebook · x · email · native · clipboard) |
| `product_out_of_stock_seen` | productId, sellerId | ⏳ |
| `product_liked` | productId, sellerId, surface, source | ✅ (♥ on Browse / Nearby / Store, and the post-purchase prompt) |
| `product_unliked` | productId, sellerId, surface, source | ✅ (tapping a filled ♥ takes the vote back) |
| `product_sheet_opened` | productId, sellerId, surface, hasVariants | ✅ (the ⓘ Details sheet on the product card — Browse, Nearby, the storefront) |
| `product_sheet_closed` | productId, surface, dwellMs, action | ✅ (`action` = buy · bag · message · gallery · store · none — `none` is looked-and-left) |
| `review_posted` | productId, sellerId, score, hasText, hasPhoto, tagCount, edited, surface | ⏳ (needs the reviews rules deployed — `score` is the star, 1–5) |
| `review_form_opened` | productId, sellerId, surface, eligible | ⏳ |
| `review_comments_seen` | productId, count, surface | ⏳ |
| `review_prompt_shown` | productId, sellerId, surface, orderRef | ⏳ (the one-tap stars: the delivered bubble, the seller's ask, under a thread, the My Orders fallback) |
| `review_prompt_answered` | productId, sellerId, surface, score | ⏳ (`score` = the star they tapped — a rating with no words at all) |
| `review_requested` | orderId, productId, delivered | ⏳ (a **seller** asked a buyer to rate, from My Orders; `delivered` says whether the ask reached the thread) |
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
| `order_viewed` | orderId, status | ✅ (seller screen, and the buyer's own list) |
| `order_status_changed` | orderId, from, to, latencyMinutes, productId | ✅ (seller) |
| `order_deleted` | orderId, status | ✅ (seller) |
| `buyer_orders_viewed` | count | ✅ (the buyer's own orders list, `/my-orders`) |
| `order_cancelled` | orderId, by, reason | ⏳ |
| `order_completed` | orderId, by, latencyMinutes | ⏳ |
| `product_created` | productId, category, hasImage, price | ⏳ |
| `product_updated` | productId, fields | ⏳ |
| `product_deleted` | productId | ⏳ |
| `stock_toggled` | productId, outOfStock | ⏳ |
| `published_toggled` | productId, published | ⏳ |
| `bulk_upload_finished` | count, failed | ⏳ |
| `store_link_copied` | sellerId, surface | ✅ (three doors, one helper: the Dashboard block · the sidebar button · the Marketing page — `surface` says which) |
| `store_shared` | sellerId, channel, surface | ✅ (the Marketing page's share row and the phone's native sheet) |
| `qr_viewed` | sellerId | ✅ (a shop QR was drawn — Marketing's card, and each product's own) |
| `product_link_copied` | productId, sellerId, surface | ✅ (Marketing — the per-product link, which is the one worth sending to one person) |
| `qr_downloaded` | sellerId, surface | ✅ (⬇️ Download PNG — the card left the phone and can be printed) |
| `qr_printed` | sellerId, surface | ✅ (🖨️ Print card — a blocked pop-up is a `qr_downloaded` instead, so the two never both fire) |
| `promote_card_used` | card, surface | ✅ (a promotion caption was copied to the clipboard; `card` = status · bio · groups · parcel · ask) |
| `marketing_opened` | productCount | ✅ (the seller opened 📣 Marketing — `productCount` is what they had to work with) |
| `feedback_submitted` | category, role, source | ✅ (the form, and now the after-use ask) |
| `care_ticket_sent` | issue, topic, photos, hasOrder | ✅ (a care ticket actually landed — `careTickets/`, author-readable only) |
| `care_sheet_viewed` | hasOrder, issue | ✅ (the sheet was opened — the top of the care funnel) |
| `return_sheet_viewed` | orderId, canOpen | ✅ (`canOpen` = the policy let them start one; `false` is the interesting half) |
| `return_requested` | orderId, reason, fault | ✅ (the buyer's order got a return on it) |
| `return_updated` | orderId, state | ✅ (photo sent · withdrawn — the buyer's own two states) |
| `return_decided` | orderId, state, hasNote | ✅ (the seller answered: photos_needed · approved · declined · refunded · completed) |
| `returns_viewed` | count, openReturns | ✅ (`/returns` — the policy page, with the buyer's own returns on it) |
| `feedback_prompt_shown` | actions | ✅ (how much they'd used it when the question appeared) |
| `feedback_prompt_dismissed` | actions | ✅ ("Later" — the answer rate is measurable) |
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
- **PHONE VERIFICATION** — the seller signup gate: codes requested → numbers verified, split by
  method (`phone-signup` settles the account and the number with one code; `social-link` owes an
  extra step) and by country. This is where people who never finished setup show up, so it is
  the first place to look when signups dip.
- **SEARCH** — searches per surface, the top queries, and **queries that found
  nothing** (that list is your product roadmap).
- **PRODUCTS** — seen → opened → bagged → ordered → confirmed per product, plus the ♥
  likes cast in the window (split into card taps and post-purchase votes), "seen a lot,
  never ordered", and **"delivered 3+ times and never loved"** (where a "did you love
  it? — no" ends up). The ⭐ half of that funnel is `review_prompt_shown` →
  `review_prompt_answered` (the score is on the event), with `review_requested` saying how
  often a *seller* had to ask — because a rating that only arrives when a shop chases it is a
  different product decision from one that arrives on its own.
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
for funnels today and for modelling later.

**The one seller-facing read-back is deliberately narrow.** `events/` is readable by
nobody but the report (`firestore.rules`: `allow read: if false`), so a seller cannot be
told "12 people looked at this" *from the lake*. The 📣 Marketing page therefore reads only
two things a browser is allowed to read: `sellers/{uid}/visits` — already written on every
non-owner store visit — for "people opened your shop", and `productViews/{productId}`, a
bare counter that is public to read, signed-in to move, and **up by exactly one and
nothing else**. Everything else on that page (bags, ♥, orders) was already a number the
app had. The funnel the page teaches, in the order it teaches it:

    opens (productViews) → shares (store_shared · product_shared · product_link_copied)
      → store visits (visits) → bags (bagCounts.baggedCount) → orders (products.orderCount)

Two rules from this section still hold: a seller-facing number comes from the shop's own
documents, never from `events/`; and nothing new gets written without a rule that keeps it
honest.
