# 🗃️ DATA COLLECTION — everything rachett stores

**Purpose:** the single source of truth for (1) what we hold on sellers and buyers, and (2) what we may use for machine learning / AI training.
**Verified against the code** — each claim carries a `file:line` so it can be re-checked. If you change a write path, update this file.

**Last updated:** 15 Sep 2026 — three changes since the first draft: conversation rules hardened (§11), National ID capture switched off until there is a review path (§2.2, §2.4, §8, §10), payments deliberately left alone until they've been tested (§7).

**Buyer experience (new):** buyers now have their own home at `/home` (mirror of the seller Dashboard), the nav carries a **Browse** door, and a guest who taps Buy or Message is returned to that exact action after signing in (`role.ts`, `signInGate.ts`, `BuyerHome.tsx`, plus `users/{uid}.role` in §3.1).

**Market-first + accounts required (16 Sep 2026):** `/` now sends everyone without a shop to `/home` — logged-out visitors included — and sign-in lives on its own `/signin` route. **Messaging and buying require a real account**: anonymous accounts count as logged out, the guest OTP path was removed (`useGuestOTP.ts` deleted, `sendGuestOrderRequest` deleted), and every order/message sheet now shows a sign-in prompt. Browsing, Nearby and the local bag stay open to guests.

**Catalog & discovery (16 Sep 2026):** Browse no longer walks every store's products (that silently capped it at the **first 50 stores**, in document-ID order, and cost 51 reads a visit). Products now come from one paged `collectionGroup('products')` feed ordered by `createdAt` (`useProductFeed.ts`) with a **Load more** button, store details are joined client-side, a **stores directory** lists every shop, and searching a store that doesn't exist says so. The feed needs a collection-group index — see §12.

---

## 0. TL;DR

| Who | What we hold |
|---|---|
| **Seller** | 1 Auth account + 1 `sellers/{uid}` doc + 5 subcollections (`products`, `orders`, `messages`, `visits`, `stats`) |
| **Buyer (signed in)** | 1 Auth account + `users/{uid}` + `users/{uid}/bag/*` + `conversations/*` + orders |
| **Buyer (anonymous)** | An anonymous Auth uid (guest checkout) — orders and chats carry that uid |
| **Buyer (guest, no account)** | Phone + name only: on their device, plus their phone inside the seller's `messages` |
| **Behavioural lake** | `events/` — 7 event types, each with uid-or-`guest`, source platform and payload |

**Most sensitive:** phone numbers (`whatsapp`, `senderPhone`, `buyerPhone`) and emails (`email`, `recoveryEmail`, `userEmail`).
**Deliberately NOT collected:** National IDs and other identity documents (capture is switched off — "coming soon"), birthdays and exact ages (age is a *group* — §3.1), payment data (the Flutterwave wrapper is dead code), push tokens (no FCM), buyer GPS coordinates (device-only by design).

---

## 1. Where data physically lives

| Store | Contents |
|---|---|
| **Firebase Auth** | Seller + buyer + anonymous accounts |
| **Firestore** | `sellers/{uid}` (+ `products` — each with `likes/{uid}` ♥ votes —, `orders`, `messages`, `visits`, `stats`) · `users/{uid}` (+ `bag`, `likes`, `loveAnswers`) · `conversations/{id}` (+ `messages`) · `events` (**two shapes** — legacy single events, and `schemaVersion: 2` batches; see §13) · `bagCounts/{productId}` (+ `baggers`) · `feedback` · `recoveries` · `trust/{uid}` (**no PII** — the 🟢 badge; see §2.2) · `otpCodes/{phoneKey}` / `phones/{phoneKey}` / `meta/otpSends` (HMAC keys, so no readable number) |
| **Firebase Storage** | Nothing new: National ID capture is switched off ("coming soon"), so no new files are written. IDs uploaded before this change are still at `sellers/{uid}/private/national-id.{ext}` — readable **only** by that seller (`storage.rules:11-14`). |
| **Cloudinary** | Store logos, product photos, chat photos |
| **OTP server** (`api/otp/send.js`, `api/otp/verify.js` — Vercel serverless functions) | Phone numbers + OTP codes, held in Firestore (`otpCodes/{phoneKey}`, `phones/{phoneKey}`, `meta/otpSends` — all closed to the browser, and none holding a readable number, because the key is an HMAC of one) — and the code never in the clear: only its HMAC is written, and it expires after 5 minutes or on first use |
| **Device (localStorage/sessionStorage)** | Drafts, bag, buyer area, remembered user, guest verification |
| **Third parties** | Cloudinary, Yoola, Resend, Formspree*, Nominatim/OSM, Google/Facebook/Apple |

\* Formspree only receives anything if `VITE_FORMSPREE_ID` is set.

---

## 2. SELLER data

### 2.1 Account (Firebase Auth)

`uid`, `email` **or** `phoneNumber` (E.164, e.g. `+256771234567`), `displayName`, `photoURL`, `providerId` (`google.com` / `facebook.com` / `apple.com` / `phone`), `emailVerified`, `creationTime`, `lastSignInTime`. Firebase also keeps its own IP/timestamp logs server-side. **A shop's `phoneNumber` is written by our server, never by the browser** (`api/_lib/identity.js:70,84` — only after a code it texted came back correct), and the wizard reads it back rather than setting it.

### 2.2 `sellers/{uid}` — field dictionary

Written by `SetupStore.tsx:552` (create), `EditStore.tsx:234-258` (edit), `Dashboard.tsx:78-82, 153-158` (recovery email + location backfill), `RecoveryModal.tsx:121` (phone recovery).

> **Every live shop has a verified phone number (since 19 Sep 2026).** Setup checks the number
> against its own country's length (`src/phone.ts` — Uganda 9 digits, Kenya 9, Egypt 10, …,
> verified in Node by `_phone_check.cjs`) and then **refuses to create the shop** until a
> code texted by *our* server to that exact number has come back correct (`api/otp/send.js` → Yoola,
> checked by `api/otp/verify.js`, which re-runs the same per-country rule in `api/_lib/phone.js`;
> the proof lands in `trust/{uid}`, written server-side). Signing in with
> Google/Apple/Facebook gets one extra step (verify your phone number, last); signing in with
> the number itself settles both at once, so that path has no extra step. (The `/signin`
> screen still opens Firebase's own phone *session* for `+number` accounts, but a session is not the
> proof — the wizard asks our server for a code all the same.) This is what
> the 🟢 Real Seller badge rests on — and the number stays private: `showWhatsapp` is `false`,
> so buyers never see it.

| Field | Type / example | Notes / source |
|---|---|---|
| `businessName` | string `"Aisha Fabrics"` | required at setup |
| `bio` | string ≤500 | "What do you sell?" — sanitised |
| `story` | string ≤200 | the seller's own words about themselves (optional) — shown on the store page under the bio, warm and slightly italic, clamped to ~4 lines (SetupStore step 1 / EditStore) |
| `slug` | string `"aisha-fabrics"` | the store link; **never changes on rename** |
| `aliases` | string[] (≤8) | previous business names, for search recall (EditStore.tsx:250-251) |
| `whatsapp` | string `"+256771234567"` | contact/payout number — **PII** |
| `phoneVerified` | boolean | **true on every shop created since 19 Sep 2026** — the setup gate will not save a store without a confirmed SMS code for this number, and for shops created then it still says so. **It is a Firebase-era field, though, and nothing writes it any more**: the wizard's create payload no longer names it, and `firestore.rules:18,20` refuses any write that so much as touches it — so a `true` here is history, kept for shops that proved a number before the move. The proof the badge reads now is the server-written `trust/{uid}` above |
| `email` | string | store contact email — **PII** |
| `recoveryEmail` | string | account-recovery anchor — **PII** |
| `recoveryEmailVerified` | boolean | |
| `recoveryEmailPromptCount` | number | how many times we nagged |
| `recoveryEmailLastPrompted` | Date | |
| `nationality` | string `"Uganda"` | |
| `location` | string ≤75 `"Kikuubo, Kampala opposite energy centre, shop number 5"` | the seller's **own words**, kept exactly as typed — a landmark finds a shop better than a town name (SetupStore step 2 / EditStore). Geocoding no longer overwrites it; `geo`/`place`/`geoSource` below are still derived from it (or from a dropped pin) so Nearby keeps working |
| `geo` | `{ lat: number, lng: number }` | store coordinates |
| `place` | `{ city, area, region, country }` | structured area (place.ts:20-25) |
| `geoSource` | `'gps' \| 'area'` | real pin vs approximate town |
| `showWhatsapp` | boolean | number public? (always `false` today) |
| `instagram`, `tiktok` | string | `@` stripped |
| `logoUrl` | string (Cloudinary) | set in Setup Store step 1 (optional, one tap) or Edit Store; falls back to the provider `photoURL` at creation, and to a colour + initial tile when empty (`avatar.ts`) |
| `idDocumentPath` | string | **Legacy — no longer written.** National ID capture is off (see §11); older stores may still carry a path. Always stripped from exports. |
| `idStatus` | `'pending'` | **Legacy — no longer written.** Was always `'pending'` with nothing to advance it. |
| `createdAt` | Date | when the store was created (`SetupStore.tsx:575`) — powers the "Selling since …" trust line in the sidebar and dashboard. Older stores may be missing it; `functions/backfill-store-dates.js` fills it from real evidence only (first product → first order → first visit) and records where it came from. |
| *read but never written* | `verifiedSeller`, `realSellerBadgeEarnedAt`, `realSellerBadgeGraceUntil` | `useSellerStats.ts` — the 🟢 Real Seller badge is recomputed client-side from the fields above plus `trust/{uid}`, never persisted. The 💎 Reliable Seller badge is not stored here either: it is derived from rachett's own numbers in `stats/main` (below). |

### 2.3 Subcollections under `sellers/{uid}/`

**`products/{id}`** — `name`, `price` *(string)*, `description`, `imageUrl`, `images[]`, `colors[]`, `sizes[]`, `stock`, `published`, `outOfStock`, `category`, `subCategory`, `orderCount`, `salesCount`, `likeCount`, `reviewCount`, `reviewScoreSum`, `reviewLovedCount`, `createdAt`, `updatedAt`.
⚠️ Inconsistently populated: `category`/`subCategory` only from `ProductsPage` + `StorePage` quick-add (`StorePage.tsx:570-572`); `images[]`/`colors`/`sizes`/`stock` only from `ProductsPage` (`ProductsPage.tsx:174-186`); `BulkUpload.tsx:98-104` writes just `name`, `price`, `description: ''`, `imageUrl`, `createdAt`.

**`products/{id}/reviews/{buyerUid}`** — a buyer's comment, written **only after delivery**:
`buyerUid`, `reaction` (`love` / `fine` / `bad`), `score` (5 / 3 / 1 — kept so a star average stays possible later), `tags[]` (the tapped chips: "Fast delivery", "Good quality", …), `text` (≤ 400 chars, line breaks kept), `photoUrl` *(Cloudinary)*, `orderId` (the **document id** of the delivered order — the rules look it up), `orderRef` (`RT-XXXXXX`, display only), `variant`, `buyerName` (**shortened to "Aisha N." — a full name is never published**), `verified: true`, `createdAt`, `editedAt` *(24-hour edit window; after that the comment is final)*.
- The document ID **is** the buyer's uid, so one comment per buyer per product is structurally the only possibility.
- **It is public.** This is the first buyer-written text on rachett: anyone can read it, and it stays readable until the buyer deletes it (`firestore.rules` — public read, buyer-only write, and the seller can never edit or delete one).
- What authorises it is the buyer's **own delivered order**: the rule reads that order (`get()`), so "✓ Bought it" is a fact rather than a checkbox. That read costs one document read per post attempt.
- The counters live on the product (`reviewCount`, `reviewScoreSum`, `reviewLovedCount`) and a buyer may move them by exactly what their one comment can move — only in the same write as the comment itself (`existsAfter`).

**`orders/{id}`** — see §3.4.

**`messages/{id}`** — the **legacy** channel (signed-in buyers now use `conversations/*`; the guest writer was removed on 16 Sep 2026): `senderName`, `senderUid` (legacy `guest_+256…` values may exist), `senderPhone` (**PII**, legacy), `productName`, `productPrice`, `productId`, `quantity`, `deliveryArea`, `text`, `sourcePlatform`, `verified`, `read`, `createdAt` (`createBuyerOrder.ts:128-142`).

**`visits/{id}`** — `{ sourcePlatform, createdAt }` only. **No uid** → anonymous traffic counter (`StorePage.tsx:428-432`).

**`stats/main`** — rachett's own measurement of the shop, written **only by the server** (`functions/index.js`: `recomputeSellerCompletion` on every order write, `recordSellerFirstResponse` on the seller's first reply in a thread; backfill existing shops with `node functions/backfill-seller-stats.js`). `firestore.rules` closes it to browser writes, so the badge it feeds cannot be self-awarded. Fields: `completedOrders`, `totalOrders`, `orderCompletionRate` (whole %, `null` until the shop has an order), `responsesMeasured`, `responseTotalMinutes`, `avgResponseMinutes` (`null` until a reply exists), `updatedAt`. The app reads these in `useSellerStats.ts` and applies the thresholds from `src/reliableBadge.ts` (completion ≥ 80%, reply < 120 min) to draw the 💎 Reliable Seller badge.

### 2.4 Seller files

| File | Where | Who can read |
|---|---|---|
| National ID | **Not collected any more** — capture is switched off in SetupStore and EditStore until there is a way to review it. Older files may remain in Firebase Storage at `sellers/{uid}/private/national-id.{ext}`, readable only by that seller (`storage.rules:11-14`). | — |
| Logo, product photos, chat photos | Cloudinary | Public URLs |

---

## 3. BUYER data

### 3.1 Signed-in buyer
- **`users/{uid}`** — `displayName`, `email`, `lastSeen`, `signupAt` (`StorePage.tsx:708-713`), `role` (`'buyer' | 'seller'` — the onboarding choice, mirrored from the device so a buyer is never asked who they are again; `role.ts`. **A missing role means "just looking"**: a visitor who never chose, and nothing is claimed about them), `quickReplies[]` (≤20 replies, ≤200 chars each — the buyer's own canned messages; `useQuickReplies.ts:6-8, 62`) and `drafts[]` (≤10 unsent messages: text + conversation/person/product context, so your Inbox can show a draft with no thread yet and a lost phone doesn't lose the question; `draftStore.toAccountDrafts`, `useDraft.pushDraftToAccount`). A draft is **never** readable by the other party — it lives on your own document, not on the thread.
- **`users/{uid}/bag/{productId}`** — a frozen snapshot of purchase intent: `productId`, `productName`, `productPrice`, `imageUrl`, `images[]`, `sellerSlug`, `sellerId`, `businessName`, `addedAt` (ms), `quantity` (`useBag.ts:7-18, 195`).
- **`users/{uid}.ordersSeenAt`** — a plain timestamp (ms) of when this person last opened their own orders list. It is only ever read then moved forward, so the ● NEW dots describe the *previous* visit rather than vanishing under their finger (`BuyerOrders.tsx`).
- **`users/{uid}.feedbackAskedAt` / `feedbackDoneAt`** — when we last asked "what didn't you like?", and when they answered. Only used so the ask never follows someone onto a second device (`feedback.ts`).
- **`users/{uid}.displayName` + `nameSource` / `nameAskedAt` / `nameConfirmedAt` / `nameSkipped`** — **what we call this person**, which a seller reads on every order and message. `displayName` is the name they confirmed: either accepted from our suggestion (their social account name, shortened to "Aisha N.") or typed themselves; `nameSource` records which of those it was. The timestamps mark the one-time ask and `nameSkipped` means they tapped "Later" — so we never ask twice, on any device. It is written by the buyer on their own document, and **mirrored into the Firebase Auth profile** (`updateProfile`) so the many places that previously fell back to the word "Buyer" now show a real name. A name is a *label* — the uid stays the identity — and links, handles, phone numbers and digits-only are refused (`buyerName.ts`).
- **`users/{uid}.ageBand` + `gender` / `demographicsAt` / `demographicsAskedAt` / `demographicsSource`** — **the two things a recommendation is built on**, and the only facts we hold about somebody's body or life stage. `ageBand` is a *group*, never a birthday: `under-18` / `18-24` / `25-34` / `35-44` / `45-54` / `55+` / `undisclosed`, and `gender` is `female` / `male` / `other` / `undisclosed` — where **`undisclosed` is a real answer meaning "asked, and chose not to say"**, not a missing field. It is asked **once**, and it cannot be walked past: at sign-up (`Onboarding.tsx`, the step after the name), on the store setup screen (`SetupStore.tsx` step 2), or by the one-time card for anybody already here (`DemographicsGate.tsx`, mounted next to `FeedbackNudge`). `demographicsAt` is the marker that stops the asking, `demographicsAskedAt` records the ask itself, and `demographicsSource` says which surface it came from. Written by the person on **their own** document (`firestore.rules:221-222` already allowed it — no rule was added), or kept on their phone (`rachett_demographics`) until an account exists, and adopted on first sign-in. **It is never written onto an order, onto a shop, or anywhere a seller can read**, and nothing outside the recommender reads it: `recommendationAudience()` in `demographics.ts` is that seam, and it returns `null` rather than a guess when the answer is missing or "prefer not to say" (see gap 11).
- **`users/{uid}/likes/{productId}`** — `{ sellerId, at }`: a mirror of **your own** ♥ votes only, so any page can draw every heart on it from one listener. The vote itself lives on the product (§5) — this is just the index of yours.
- **`users/{uid}/comments/{productId}`** — `{ sellerId, at }`: a private index of "products I have commented on", so a later **rename** knows exactly which of my published comments to relabel (`useProductReviews.postReview`, `spreadNameEverywhere`). Renaming reaches those comments and my chat threads; **orders keep the name they were placed under**, because that is the name a delivery was actually made in. This document is owner-only — nobody else can read your index.
- **`users/{uid}/loveAnswers/{orderId}`** — `{ answer: 'yes' | 'no', productId, sellerId, at }`: the post-delivery "Did you love it?" answer, kept so the buyer is never asked twice. A **`no` exists nowhere else** — nothing public is ever written for it.

### 3.2 Anonymous buyer
Created by guest checkout so the order/chats behave like a signed-in buyer's (`ProductActions.tsx:163`). Their uid is a normal Firebase uid but `isAnonymous` is true, so the app treats them as a guest for UI purposes (`App.tsx:60-63`).

### 3.3 Guest buyer (no account at all)

A guest can browse, search, view stores, use Nearby, keep a **local** bag (`rachett_bag` on their device, merged into their account when they sign in) **and see every ♥ tally** (the number is public). **They cannot message, buy, or vote** — those all show a sign-in prompt (`SignInPrompt.tsx`) and return them to the same action afterwards (`signInGate.ts`); a tapped ♥ is cast the moment they come back to the card.

Because of that, these no longer happen:

- ❌ No `senderUid: "guest_+256…"` messages — the guest OTP flow was removed and `useGuestOTP.ts` deleted (16 Sep 2026).
- ❌ No `sendGuestOrderRequest` fallback, and no anonymous (`signInAnonymously`) buyer accounts.
- ⚠️ **Legacy data may still contain them** — older `sellers/{uid}/messages` rows written by guests, plus `localStorage.rachett_verified_guest` on old devices. Treat `guest_*` uids as historical; nothing writes them any more.

### 3.4 Order document (`sellers/{sellerId}/orders/{id}`)

`buyerName`, `buyerUid`, `buyerPhone` *(guests only — PII)*, `verified`, `productName`, `productPrice` *(string)*, `productId`, `productImage` *(a thumbnail for the buyer's own orders list; only on orders placed after Sep 2026)*, `quantity` *(string)*, `deliveryArea` *(free text)*, `color` + `size` *(what the buyer picked in the details sheet — `ProductSheet`; absent on older orders and on products that never listed any options, and `color`/`size` are the seller's own words)*, `status` (`pending` → `paid` / `awaiting_payment` → `fulfilled` / `out_of_stock` / `needs_details`), `read`, `sourcePlatform`, `orderId` (`RT-XXXXXX`), `createdAt`, `updatedAt` *(stamped by `OrderHistory.updateOrderStatus`; the buyer's own list uses it to say "Updated 2h ago" and to light the ● NEW dot)* (`createBuyerOrder.ts:5-40`; `useSellerOrders.ts`).
Payment fields are written by the two online flows — **pawaPay** (mobile money) at `functions/index.js:656-668` when the prompt goes out and `:749-763` when it settles, and **Pesapal** at `:270-275` and `:351-361`: `paymentProcessor` (`pawapay`), `paymentStatus` (`initiated` → `completed` / `failed` / `unknown`), `paymentDepositId`, `paymentProvider`, `paymentMethod` *(the rail id, e.g. `MTN_MOMO_UGA`)*, `paymentAmount` *(number)*, `paymentCurrency`, `paymentNote` *(only when the seller must know: a mismatched amount, or a rail they had not listed)*, `paymentInitiatedAt`, `paymentAttempts`, `paymentUpdatedAt`, and `paidAt` — which is set **together with `status: 'paid'`** by the **server** (`paymentRules.decideOutcome`), never by the seller. The seller's Orders screen words all of it through `src/orderPayment.ts` (`paidCount` on the Dashboard), pinned by `_order_payment_check.cjs` and `_payments_check.cjs`; before that the fields existed and nothing displayed them, so a paid order read "Pending". The Flutterwave-era `transactionId` / `flwRef` are still declared as optional fields (`createBuyerOrder.ts:22-23`, `paymentService.ts:33-34`) and written by no flow that is still wired up.

### 3.5 Conversations and messages

`conversations/{sellerId_buyerId}` — `sellerId`, `buyerId`, `sellerName`, `buyerName`, `lastMessage`, `lastMessageAt`, `lastMessageBy`, `lastMessageStatus` (`sent` / `seen` = **read receipts**), `unreadBySeller`, `unreadByBuyer`, `unreadBySellerCount`, `unreadByBuyerCount` (`useConversation.ts:52-79`).

`conversations/{id}/messages/{id}` — `senderId`, `text`, `imageUrl`, `type` (`text` / `image` / `product` / `order`), `productId`, `productName`, `productPrice`, `productImage`, `orderId`, `quantity`, `status`, `orderStatus` (`fulfilled` marks the **delivery** bubble a seller's "✓ Confirm" posts — it is what shows the buyer the "Did you love it?" question), `createdAt` (`useConversation.ts:81-96, 162-172`; `createBuyerOrder.ts`).

⚠️ **Two chat systems coexist**: `sellers/{uid}/messages` (legacy/guest) and `conversations/*` (one thread per seller↔buyer pair). Any training pipeline must dedupe/merge them.

### 3.6 The buyer's own orders (`/my-orders`)

Orders live under each **seller**, so a buyer's history is gathered with one query: `collectionGroup('orders')` where `buyerUid == me`, newest first (`useBuyerOrders.ts`; 20 per page with **Show older orders**). It is a **live listener**, so a seller confirming an order flips the buyer's row to "Delivered" while they are looking at it.

Reading this needed **no rules change**: `firestore.rules:26-28` already allows a read when `resource.data.buyerUid == request.auth.uid`, and the query's own equality filter satisfies that rule. The page is deliberately **read-only** — a buyer cannot cancel or confirm an order, because order documents may only be updated by the seller (`firestore.rules:33-36`).

Shop names and logos are joined client-side (one read per *distinct* shop, cached for the visit). Orders written before `buyerUid` / `productImage` existed simply never appear / show a placeholder — nothing is backfilled, and a "did you love it?" answer is kept per order in `users/{uid}/loveAnswers`.

### 3.7 The buyer's own page (`/profile`) — `ProfilePage.tsx`

The buyer was the one person the app never showed to themselves: their name, orders, bag and looks were each held somewhere, and no screen said so. `/profile` is that screen. It is reached from the top bar (`👤 Profile`, buyers only — sellers keep "Manage Store") and from the buyer's home (`/home`), and it is open to guests.

**It writes almost nothing new.** The age & gender card below is the one addition (§3.1) — the same two-question ask every other surface uses, so a person can correct an answer without hunting for the screen that first asked them. The name goes through `useBuyerName` exactly as the Inbox header and the checkout forms do — `users/{uid}` (`displayName` / `nameSource` / `nameAskedAt` / `nameSkipped`) plus the device copy (`rachett_last_name`) — and everything else is a read: orders through `useBuyerOrders` (the same collection-group query as `/my-orders`), the bag count, and the two device histories. The age & gender fields (§3.1) are the only document change of any kind, and they needed no rule either — the person already owns `users/{uid}`.

The one number it computes is money: `summariseBuyerOrders` (`buyerOrderUtils.ts`, pinned by `_orders_check.cjs`) counts every order that is not `cancelled` / `out_of_stock`, because those were never a purchase — an order still waiting on the seller **is** counted, since the buyer has committed to it.

It is also the only place a **buyer** can sign out (`auth.signOut()` + a full reload). Before this, signing out existed only inside seller screens: `EditStore.tsx:325`, `SetupStore.tsx:749`, `StorePage.tsx:1329`. The bag, the looks and the device name are deliberately left alone — they are this phone's, not the account's.

---

## 4. Behavioural event lake — `events/` (`tracking.ts:13-26`)

Every document: `{ event, userId: string (uid | 'guest'), sourcePlatform, data: {...}, createdAt }`.
`sourcePlatform` is derived from `?source=` / `?utm_source=` / `document.referrer` → WhatsApp, Instagram, TikTok, Telegram, Twitter, Facebook, Email, Web (`tracking.ts:28-49`; StorePage has its own `detectPlatform`, `StorePage.tsx:74+`).

| Event | `data` payload | Fired from |
|---|---|---|
| `product_viewed` | productId, productName, sellerSlug | BrowsePage (on tap), NearbyPage |
| `product_surveyed` | productId, productName, sellerSlug | BrowsePage **double-tap** survey |
| `search_performed` | `query` | BrowsePage (Enter key only) |
| `category_browsed` | `category` | BrowsePage chips |
| `order_placed` | productId, productName, sellerId | ProductActions, Browse, Bag, StorePage |
| `message_sent` | productId, productName, sellerId | same four |
| `store_visited` | `sellerSlug` | StorePage |

**Read access is `false` for clients** (`firestore.rules:69-70`) — only the Admin SDK (this export script) can read the lake.

---

## 5. Counters and aggregates

| Data | Shape | Source |
|---|---|---|
| `bagCounts/{productId}` | `{ count, baggedCount }` | `useBag.ts` |
| `bagCounts/{productId}/baggers/{uid}` | `{ at }` — one marker per user (distinct-people counting) | same |

**Bags are free; the number is not.** Anybody may add to their bag without an account (it stays on their device), but `bagCounts` can only be written by a **signed-in** account (`firestore.rules`) — because a number the whole world sees must be a number nobody can fake. So a guest's add is never counted, and **a guest's bag is credited the moment they sign in** (the bag moves into their account then, and the `baggers` marker makes it exactly once, so bagging the same thing again never doubles it). Guests who never sign in are still visible in `events` as `bag_added` — real interest, just never public proof (`npm run analytics:report` splits the two crowds).
| `products.orderCount` | number — bumped on every order placed | `createBuyerOrder.ts:152-153` |
| `products.salesCount` | number — bumped on fulfilment | `OrderHistory.tsx` |
| `products.likeCount` | number — the **public ♥ tally**, one number the whole world reads (a buyer in one country and a seller in another see the same figure) | `useProductLikes.ts` |
| `sellers/{sellerId}/products/{productId}/likes/{uid}` | `{ at, source: 'tap' \| 'purchase', orderId? }` — **the document ID *is* the voter**, so one account = one vote and a second tap can only be an un-like (delete). Public to read (uids only, no names anywhere); `update` is denied so a vote can never be edited | same |
| `users/{uid}/likes/{productId}` | `{ sellerId, at }` — a mirror of **my own** votes, so a page draws every ♥ from one listener instead of one read per card | same |
| `users/{uid}/loveAnswers/{orderId}` | `{ answer: 'yes' \| 'no', productId, sellerId, at }` — asked once after delivery, never twice. A **`no` is stored here only**: nothing public is written for it, and the seller sees aggregates, never who answered no | `LovePrompt.tsx` |
| `sellers/{uid}/visits/*` | per-visit channel | `StorePage.tsx:428` |
| `feedback/{id}` | `role` (seller/buyer), `category`, `message`, `name`, `contact`, `page` (full URL), `source` (`page` = the full form, `prompt` = the after-use card), `submittedAt`, `userEmail`, `uid`, `createdAt` | `feedback.ts` (used by `FeedbackPage.tsx` + `FeedbackNudge.tsx`) |
| `recoveries/{id}` | `email`, `codeHash` (SHA-256), `expiresAt`, `verified`, `attempts`, `createdAt` — client access denied | `functions/index.js:27-107`, `firestore.rules:89-91` |

---

## 6. Device-local only (never in the database)

| Key | Contents | Source |
|---|---|---|
| `rachett_setup_draft` | Half-finished store form (name, link, bio, country, location, phone, step) | `SetupStore.tsx:34` |
| `rachett_bag` | Bag items (full product snapshot + the chosen colour/size from the details sheet) | `useBag.ts:20` |
| `rachett_buyer_area` | `{ lat, lng, place, label, source }` — **buyer's area, deliberately device-only** | `place.ts:165-175` |
| `rachett_verified_guest` | **Legacy** — written by the removed guest OTP flow; old devices may still hold it, nothing reads or writes it now | — |
| `rachett_last_user` | Last signed-in identity for "Continue as": displayName, **email**, photoURL, uid, providerId | `userMemory.ts:3-28` |
| `rachett_quick_replies_guest` | Guest quick replies | `useQuickReplies.ts:6` |
| `rachett_role` | The buyer/seller choice made on the onboarding screen — stops us asking twice (`role.ts`) | `role.ts` |
| `rachett_name` | The name chosen *before* there is an account (`{ name, skipped, at }`) — a "just looking" visitor can choose one, and it is adopted onto `users/{uid}` at their first sign-in rather than evaporating. Written only when nobody is signed in, cleared the moment it is adopted | `buyerNameDevice.ts` → `buyerName.ts` |
| `rachett_feedback` | When the "what didn't you like?" ask was last shown, and when they answered (ms). "Later" = a week; answered = three months of quiet. Mirrored onto `users/{uid}` so a second phone doesn't ask again | `feedbackRules.ts` |
| `rachett_feedback_visit` (session) | The distinct pages seen this visit — that is what "they have actually used it" means (3+ pages before the ask is deserved) | `feedbackRules.ts` |
| `rachett_nearby_sort` | The Nearby quick control the buyer prefers (`closest` / `newest` / `popular`) — remembered so the page opens the way they like it (`NearbyPage.tsx`) | `NearbyPage.tsx` |
| `rachett_pending_action` (session) | The Buy/Message a guest was blocked on, so signing in returns them to it; expires after 15 min (`signInGate.ts`) | `signInGate.ts` |
| `rachett_draft_*` | Unsent message drafts — the text plus the conversation, person and product context (`draftStore.ts` / `useDraft.ts`). Keyed `rachett_draft_convo_<conversationId>` once signed in; keyed `rachett_draft_product_<productId>` when there is no uid yet (signed out, or before auth restores) and **migrated onto the conversation key the moment the uid is known** — so typing is never lost either way. Signed-in users also get a copy on `users/{uid}.drafts` so a lost phone doesn't lose the question. Cleared on send or discard; stale ones dropped after 30 days. | `draftStore.ts` |
| `rachett_recent_searches_{uid}` | Last N searches | `BrowsePage.tsx:362-390` |
| `rachett_last_name` | The name this phone last gave a seller — **not** an answer to the ask (that is `rachett_name`), just a memory, so every order form is already filled in on the first paint instead of waiting for a Firebase round-trip. Whatever the account says still wins; the buyer can always overtype it. Written at checkout, never cleared | `buyerNameDevice.ts` (`readLastName` / `rememberLastName`), read by `useBuyerName` |
| `rachett_history_browse` / `rachett_history_nearby` | What they opened on each page: `{ productId, name, price, imageUrl, sellerId, sellerSlug, businessName, at }`, newest first, **one row per product** (re-opening moves it up, never repeats it), ≤60 each and dropped past 62 days. **Device-local and per-page on purpose** — Browse's list answers "what was I shopping for", Nearby's answers "what is around me", so they are never merged — and it is not an account feature: nothing is written to Firestore. The strip of the last 6 sits directly above each page's search bar; "See all" opens the intervals. The Browse list is also shown on the **seller's Dashboard** above the stats — a seller's own home is `/dashboard`, not `/browse`, so that is where they find it — and a row there opens the product's shop, which is where a tap on a Browse card already goes. Clicking a row re-reads the product first, and drops the row if it no longer exists | `history.ts` / `useViewHistory.ts` (UI: `ViewHistory.tsx`) |
| `rachett_analytics_anon_id` | **Device id for analytics** — an opaque `anon_…` string, so a signed-out visitor can still be followed through a funnel. No personal data. | `analytics/identity.ts` |
| `rachett_analytics_session` (session) | Session id + timestamps; rotates after 30 minutes of silence | `analytics/identity.ts` |
| `rachett_analytics_first_touch` | The channel + landing URL of the very first visit on this device, written once | `analytics/identity.ts` |
| `rachett_analytics_queue` | Unsent events (≤200) waiting for the network; cleared as soon as they're sent | `analytics/client.ts` |
| `rachett_analytics_off` | `'1'` = this visitor opted out of analytics; every writer checks it | `analytics/client.ts` |
| `rachett_welcomed` (session) | Greeting shown flag | `Dashboard.tsx:64` |
| `rachett_skip_next_order_alert` (session) | Seller self-order test flag | `orderAlerts.ts:1` |

---

## 7. Third parties that receive data

| Processor | What it gets | Live? |
|---|---|---|
| **Cloudinary** | Shop photos/logos (cropped square ≤512px JPEG), product photos, chat photos (compressed ≤1024px JPEG) + uploader IP | ✅ `uploadImage.ts`, `StoreLogoPicker.tsx` (Setup Store + Edit Store), `BulkUpload.tsx:73-84` |
| **Yoola** (the sender the phone-verification flow uses now) | Phone numbers + OTP SMS text | ✅ `api/_lib/sms.js:87`, sent by `api/otp/send.js` |
| **Nominatim / OpenStreetMap** | Seller's typed area text **and** GPS coordinates; buyer area lookup | ✅ `place.ts:30` |
| **Resend** | Seller's `recoveryEmail` + 6-digit code | ✅ `functions/index.js` |
| **Google / Facebook / Apple** | OAuth identity (name, email, photo) | ✅ |
| **Formspree** | Feedback text, name, contact, page URL, user email | ⚠️ only if `VITE_FORMSPREE_ID` is set |
| **Flutterwave** | *Nothing* — `paymentService.ts` is **dead code** (no file imports it). **Decision (15 Sep 2026): leave it untouched until payments have been tested.** | ❌ |
| **FCM / push** | *Nothing* — no messaging SDK anywhere; `notifications.ts` is UI copy only | ❌ |

> **Note on setup uploads.** A shop photo is uploaded the moment it is picked — which is
> *before* the shop exists — so a setup that is abandoned can leave one unreferenced file in
> Cloudinary. That file is public, linked from nowhere and carries no name (only the uploader
> IP, on Cloudinary's side); uploading after creation instead would mean losing the photo on
> a reload, which is worse for the seller.

---

## 8. What we do NOT collect

- Payment instruments, card/mobile-money details, payment statuses (no provider is wired).
- Push notification tokens.
- Buyer GPS coordinates in the database (device-only) — orders carry a free-text `deliveryArea`.
- Dwell time, scroll depth, "not interested" signals, session recording, heatmaps.
  (Product **impressions** *are* recorded now — see §13 — against a device-level
  anonymous id, never against a name.)
- Anything about a person we don't need: no ad-network identifiers, no IP logged
  by us, no third-party analytics or pixels anywhere in `index.html`.
- **No birthday, no exact age, no marital status, and no other fact about a person's body or life stage.** Age is a *group* (`18-24`, `25-34`, …), gender is one of four answers, and **"prefer not to say" is available on both** — asked once, at sign-up or on the store setup screen (§3.1). That is what a recommendation needs, and it is all we keep.
- Ratings/reviews (see gap 1 below).
- **National IDs, passports, selfies or any other identity document.** Capture was removed on 15 Sep 2026 — SetupStore and EditStore now show a "COMING SOON" note where the upload used to be, so nothing is asked for and nothing is stored. It comes back only when there is a way to actually review it.

---

## 9. Data-quality gaps to fix before training

1. **No reviews/ratings exist.** `avgRating` / `reviewCount` are read in `useSellerStats` but nothing ever writes a review. The lightweight signal that *does* exist is the **♥ like** (`products.likeCount`, `useProductLikes.ts`): one vote per account, universal, and after a delivery the buyer is asked "did you love it?" **yes / no** on the order bubble. So there is now a preference signal — but still no stars, no text, and no way to know *why* someone loved or did not love a product.
2. **`price` and `quantity` are strings** everywhere; there is no `currency` field (UGX appears only in UI copy). Must be normalised before any pricing model.
3. **`userId: 'guest'`** collapsed every unauthenticated visitor into one entity in the **legacy** event documents. Events written from 16 Sep 2026 onward (`schemaVersion: 2`) carry a `sessionId`, a device `anonymousId`, the app version, language, timezone, screen size and the landing channel — so guests are now followable through a funnel. Old documents still can't be separated, and the report shows that split under DATA HEALTH.
4. **Click-level only.** `product_viewed` fires on tap (not on render); the only richer interaction signal is the double-tap survey.
5. **Search is captured only on Enter, only in Browse** — no zero-result or misspelling tracking, nothing from Nearby or Store.
6. **Orders lack buyer identity for signed-in buyers** (no email/phone), and `deliveryArea` is free text, never geocoded.
7. **Two chat systems** (§3.5) → dedupe before training.
8. **Mixed timestamps:** `serverTimestamp()` (authoritative) vs `new Date()` (client clock).
9. **Seller verification is paused:** National ID capture is switched off and the ✓ badge the wizard used to promise is now labelled "coming soon"; badges are still recomputed client-side rather than stored, and their timestamps are never written.
10. **No data-deletion flow:** the only `deleteDoc` calls are bag items (`useBag.ts:210, 241`) — there is no account/data-erasure path.
11. **Age & gender are collected but barely used yet.** Every signed-in account (and every phone, for a guest) is asked for an age band and a gender (`demographics.ts`, `_demographics_check.cjs`) — the recommender's two inputs — but **nothing reads them during a recommendation yet**. The seam is `recommendationAudience()`, and the empty bag deliberately still says "Bought near you" / "Being bought right now", because products carry no audience field and an order carries no buyer segment. Saying "people like you bought…" honestly needs one more thing: an `audience` on the product (seller-side, in the product form) or a segment written beside the order — until then the answer is stored and shown back on `/profile`, and not spent.

---

## 10. Privacy rules for AI training (non-negotiable)

1. **Identity documents are off the table.** We no longer collect National IDs at all (see §11/§8). If capture returns with a real review path, ID images must never enter a training corpus, embedding store or prompt. The exporter strips `idDocumentPath` from every row as a second line of defence.
2. **Phone numbers and emails are PII.** Export with `--pii=drop` (the default) or `--pii=hash`; only use `--pii=keep` for local debugging that never leaves your machine.
3. **Uids are pseudonymous but linkable** — they stay in exports so a user's history can be grouped; keep exports private (they are git-ignored).
4. **Consent:** review `/terms` against "we use your data to train AI" before shipping a model trained on live user data. Today the terms describe the service, not training.
5. **Retention:** agree a retention window for `events` and chat content, and honour deletion requests — which needs gap 10 solved first.
6. **Access:** `events` and `feedback` are client-unreadable (`read: false`) and `recoveries` is fully closed. Everything else is readable by the intended party at minimum; `sellers` and `products` are world-readable by design (public storefronts).

---

## 11. Conversation privacy — hardened, deploy pending

**Was:** `allow read, create, update: if request.auth != null` — meaning **any signed-in user could read and write any seller↔buyer thread** and its messages. Chat is the most sensitive content we hold.

**Now (written in `firestore.rules`, ready to ship):**

| Operation | Who is allowed |
|---|---|
| Read a thread | Only the two people on it — caller's uid must equal its `sellerId` or `buyerId`. A `get` of a *missing* thread is allowed (`resource == null`) so the client can ask "does this exist yet?" before creating it — a missing document returns no data either way. |
| Create a thread | Only if the caller puts themselves on it |
| Update a thread | Only if they are on the **stored** thread **and** stay on it — nobody can hand a thread to someone else or edit themselves out |
| Read messages | Participation is read from the parent thread with `get()`, never trusted from the message being written |
| Create a message | Only inside your own thread, and only as yourself (`senderId == request.auth.uid`) |
| Update a message | Only by the **other** person — that is exactly what read receipts do |
| Delete | Never, for threads and messages |

This covers every read/write path in the client: `useConversation`, `useBuyerConversations`, `useSellerConversations`, `createBuyerOrder.createOrderConversation`, `markConversationRead` and `sellerLive`'s two queries (`where('sellerId'|'buyerId' == uid)` — provable from the rule, so the lists keep working).

**To ship it:**

```bash
firebase login --reauth      # ← the local CLI token expired
npm run deploy:rules
```

**Status 15 Sep 2026: written and reviewed, NOT deployed.** `npm run deploy:rules` failed with `401 — invalid authentication credentials` (local CLI login expired, no service-account key on this machine), and the Firestore emulator can't run here because Java isn't installed. After deploying, smoke-test: open Inbox as a buyer and as a seller (threads, messages, read ticks), send a message both ways, place an order (which creates a thread), and confirm a second account **cannot** read a thread it isn't in.

```js
match /conversations/{conversationId} {
  allow read, create, update: if request.auth != null;   // firestore.rules:101-108
```

**Any signed-in user can read and write any seller↔buyer thread**, including its messages. A tighter rule would check participation:

```js
allow read: if request.auth != null
  && (request.auth.uid == resource.data.sellerId || request.auth.uid == resource.data.buyerId);
allow create: if request.auth != null
  && (request.auth.uid == request.resource.data.sellerId || request.auth.uid == request.resource.data.buyerId);
allow update: if request.auth != null
  && (request.auth.uid == resource.data.sellerId || request.auth.uid == resource.data.buyerId);
```

Deploy with `npm run deploy:rules`. Worth doing before the closed beta — chat content is the most sensitive user content we hold.

---

## 12. Exporting for ML

`functions/export-training-data.js` dumps the training-shaped data to JSONL.

```bash
cd functions && npm install        # once — installs firebase-admin

# the ML core (default targets): events, orders, products, messages, conversations
node export-training-data.js --out=../training-data

# just the event lake since 1 Jan, with hashed phone numbers
node export-training-data.js --only=events --since=2026-01-01 --pii=hash

# count rows without writing anything
node export-training-data.js --dry-run
```

Credentials: point `GOOGLE_APPLICATION_CREDENTIALS` at a service-account JSON, or run `firebase login` first so application-default credentials are used. Project id comes from `GCLOUD_PROJECT` (defaults to `socialbridge-93ee1`, matching `functions/backfill-locations.js`).

| Flag | Default | Meaning |
|---|---|---|
| `--out=DIR` | `training-data` | Output directory (created if missing) |
| `--only=a,b,c` | `events,orders,products,messages,conversations` | Which targets to export (`sellers` and `feedback` are also available) |
| `--since=YYYY-MM-DD` | none | Keep rows created on/after this date (filtered inside the script — no Firestore index needed) |
| `--limit=N` | `0` (all) | Max rows per target |
| `--pii=drop\|hash\|keep` | `drop` | Phone/email/name handling; `hash` = SHA-256 hex |
| `--dry-run` | off | Count rows only, write nothing |

Every row carries `_id` (document id) and `_path` (full document path) so it can be traced back and joined — `_path` is also what separates the two chat systems (`sellers/*/messages` vs `conversations/*/messages`). Timestamps are normalised to ISO-8601 strings and `GeoPoint`s to `{ lat, lng }`. Delete the output directory when you are done; exports are git-ignored.

### Maintenance scripts (`functions/`)

| Script | What it does | Run |
|---|---|---|
| `export-training-data.js` | Exports the ML datasets above as JSONL | `npm run export:training` |
| `backfill-locations.js` | Geocodes stores that only typed an area, so Nearby can sort them | `cd functions && node backfill-locations.js --write` |
| `backfill-slugs.js` | **Finds stores missing a shop link — the cause of `/store/undefined` dead ends** — and fills the gaps; reports duplicate links (renames them only with `--fix-duplicates`) | `cd functions && node backfill-slugs.js --write` |
| `feedback-report.js` | Reads back what people said **they didn't like** — by kind, by role, by which screen they were on, and whether it came from the after-use ask or the form. `feedback/` is client-unreadable, so this is the only way to read it | `npm run feedback:report` |

### Indexes (needed by the catalog feed and the buyer's orders list)

`firestore.indexes.json` holds two **collection-group indexes**:

| Index | What it makes possible |
|---|---|
| `products.createdAt` (DESC) | The Browse feed (`useProductFeed.ts`) — pages the whole catalog in one query |
| `orders.buyerUid` (ASC) + `orders.createdAt` (DESC) | The buyer's own orders list (`useBuyerOrders.ts`) — every order they placed, newest first, across all shops |

Deploy them once:

```bash
npm run deploy:indexes      # firebase deploy --only firestore:indexes
```

Until the **products** index is deployed, Browse catches the query error and falls back to the old per-store reads (a batch of 10 stores a page), so the page still works — the console prints the reminder.

The **orders** index has **no fallback**: without it the buyer's orders page shows a clear "one setting is still switched off" notice with a **Try again** button instead of an empty list, because an empty list would look like "you have never ordered anything" — a lie. Build takes a few minutes after the first deploy.

---

## 13. Event tracking (journey analytics)

The `events` collection is rachett's event lake. It is **write-only to clients**
(`firestore.rules:68-71` — anyone may create, nobody may read), so it can only be
read through the report script or the console.

**Two shapes live in it side by side:**

| Shape | Written | Carries |
|---|---|---|
| Legacy single event | before 16 Sep 2026 | `event`, `userId` (`'guest'` or a uid), `sourcePlatform`, `data{}`, `createdAt` |
| Batch (`schemaVersion: 2`) | from 16 Sep 2026 | up to 25 events, plus `sessionId`, `anonymousId`, `userId`, `role`, `appVersion`, `firstTouch{source,referrer,landing,at}`, `platform{ua,lang,tz,screen,standalone}`, `clientAt`, `sentAt`, `expireAt` |

**What changed for privacy, in both directions:**

- **Better:** no message text, names, phone numbers, emails or addresses are ever
  put in an event — only ids, counts, categories, money strings and flags. The
  taxonomy (`src/analytics/taxonomy.ts`) *drops* any property an event isn't
  allowed to carry, so the schema can't drift.
- **More:** guests are no longer an indistinguishable `'guest'` blob — they have a
  device-level `anonymousId`, a 30-minute `sessionId`, a browser user-agent,
  language, timezone and screen size. That is what makes funnels possible, and it
  is deliberately **device-scoped, not personal**.
- **Off by choice:** `localStorage.rachett_analytics_off = '1'` (`setAnalyticsOptOut`)
  stops every writer; nothing is queued or sent. There is no UI toggle yet.
- **Bounded:** the offline queue holds at most 200 events; batches are ≤25 events
  or 900 KB. `expireAt` is written 400 days out, and nothing is deleted until you
  set a TTL policy on that field (see ANALYTICS.md → Retention).

**Where the detail lives:** `ANALYTICS.md` — the full event taxonomy, what each
property means, which events are wired today, and how to run
`npm run analytics:report`.

**Not collected, ever (unchanged):** identity documents, payment instruments,
message text in events, buyer GPS in the database, push tokens, and any
third-party analytics or tracking pixel.





