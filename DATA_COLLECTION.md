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
**Deliberately NOT collected:** National IDs and other identity documents (capture is switched off — "coming soon"), payment data (the Flutterwave wrapper is dead code), push tokens (no FCM), buyer GPS coordinates (device-only by design).

---

## 1. Where data physically lives

| Store | Contents |
|---|---|
| **Firebase Auth** | Seller + buyer + anonymous accounts |
| **Firestore** | `sellers/{uid}` (+ `products`, `orders`, `messages`, `visits`, `stats`) · `users/{uid}` (+ `bag`) · `conversations/{id}` (+ `messages`) · `events` · `bagCounts/{productId}` (+ `baggers`) · `feedback` · `recoveries` |
| **Firebase Storage** | Nothing new: National ID capture is switched off ("coming soon"), so no new files are written. IDs uploaded before this change are still at `sellers/{uid}/private/national-id.{ext}` — readable **only** by that seller (`storage.rules:11-14`). |
| **Cloudinary** | Store logos, product photos, chat photos |
| **OTP server** (`server/index.js`) | Phone numbers + OTP codes — **RAM only**, deleted on expiry (2 min) or restart |
| **Device (localStorage/sessionStorage)** | Drafts, bag, buyer area, remembered user, guest verification |
| **Third parties** | Cloudinary, Africastalking, Resend, Formspree*, Nominatim/OSM, Google/Facebook/Apple |

\* Formspree only receives anything if `VITE_FORMSPREE_ID` is set.

---

## 2. SELLER data

### 2.1 Account (Firebase Auth)

`uid`, `email` **or** `phoneNumber` (E.164, e.g. `+256771234567`), `displayName`, `photoURL`, `providerId` (`google.com` / `facebook.com` / `apple.com` / `phone`), `emailVerified`, `creationTime`, `lastSignInTime`. Firebase also keeps its own IP/timestamp logs server-side.

### 2.2 `sellers/{uid}` — field dictionary

Written by `SetupStore.tsx:426-450` (create), `EditStore.tsx:234-258` (edit), `Dashboard.tsx:78-82, 153-158` (recovery email + location backfill), `RecoveryModal.tsx:127-130` (phone recovery).

| Field | Type / example | Notes / source |
|---|---|---|
| `businessName` | string `"Aisha Fabrics"` | required at setup |
| `bio` | string ≤500 | "What do you sell?" — sanitised |
| `slug` | string `"aisha-fabrics"` | the store link; **never changes on rename** |
| `aliases` | string[] (≤8) | previous business names, for search recall (EditStore.tsx:250-251) |
| `whatsapp` | string `"+256771234567"` | contact/payout number — **PII** |
| `phoneVerified` | boolean | true only via phone auth or OTP recovery |
| `email` | string | store contact email — **PII** |
| `recoveryEmail` | string | account-recovery anchor — **PII** |
| `recoveryEmailVerified` | boolean | |
| `recoveryEmailPromptCount` | number | how many times we nagged |
| `recoveryEmailLastPrompted` | Date | |
| `nationality` | string `"Uganda"` | |
| `location` | string `"Kampala, Nakawa"` | free text, normalised by geocoding |
| `geo` | `{ lat: number, lng: number }` | store coordinates |
| `place` | `{ city, area, region, country }` | structured area (place.ts:20-25) |
| `geoSource` | `'gps' \| 'area'` | real pin vs approximate town |
| `showWhatsapp` | boolean | number public? (always `false` today) |
| `instagram`, `tiktok` | string | `@` stripped |
| `logoUrl` | string (Cloudinary) | falls back to the provider photoURL at creation |
| `idDocumentPath` | string | **Legacy — no longer written.** National ID capture is off (see §11); older stores may still carry a path. Always stripped from exports. |
| `idStatus` | `'pending'` | **Legacy — no longer written.** Was always `'pending'` with nothing to advance it. |
| `createdAt` | Date | store age (drives the "Active Seller" badge) |
| *read but never written* | `verifiedSeller`, `realSellerBadgeEarnedAt`, `realSellerBadgeGraceUntil`, `activeSellerBadgeEarnedAt`, `activeSellerBadgeGraceUntil` | `useSellerStats.ts:198-208` — badges are recomputed client-side, never persisted |

### 2.3 Subcollections under `sellers/{uid}/`

**`products/{id}`** — `name`, `price` *(string)*, `description`, `imageUrl`, `images[]`, `colors[]`, `sizes[]`, `stock`, `published`, `outOfStock`, `category`, `subCategory`, `orderCount`, `salesCount`, `createdAt`, `updatedAt`.
⚠️ Inconsistently populated: `category`/`subCategory` only from `ProductsPage` + `StorePage` quick-add (`StorePage.tsx:570-572`); `images[]`/`colors`/`sizes`/`stock` only from `ProductsPage` (`ProductsPage.tsx:174-186`); `BulkUpload.tsx:98-104` writes just `name`, `price`, `description: ''`, `imageUrl`, `createdAt`.

**`orders/{id}`** — see §3.4.

**`messages/{id}`** — the **legacy** channel (signed-in buyers now use `conversations/*`; the guest writer was removed on 16 Sep 2026): `senderName`, `senderUid` (legacy `guest_+256…` values may exist), `senderPhone` (**PII**, legacy), `productName`, `productPrice`, `productId`, `quantity`, `deliveryArea`, `text`, `sourcePlatform`, `verified`, `read`, `createdAt` (`createBuyerOrder.ts:128-142`).

**`visits/{id}`** — `{ sourcePlatform, createdAt }` only. **No uid** → anonymous traffic counter (`StorePage.tsx:428-432`).

**`stats/main`** — read-only legacy (`useSellerStats.ts:212`); no writer exists.

### 2.4 Seller files

| File | Where | Who can read |
|---|---|---|
| National ID | **Not collected any more** — capture is switched off in SetupStore and EditStore until there is a way to review it. Older files may remain in Firebase Storage at `sellers/{uid}/private/national-id.{ext}`, readable only by that seller (`storage.rules:11-14`). | — |
| Logo, product photos, chat photos | Cloudinary | Public URLs |

---

## 3. BUYER data

### 3.1 Signed-in buyer
- **`users/{uid}`** — `displayName`, `email`, `lastSeen`, `signupAt` (`StorePage.tsx:708-713`), `role` (`'buyer' | 'seller'` — the onboarding choice, mirrored from the device so a buyer is never asked who they are again; `role.ts`) and `quickReplies[]` (≤20 replies, ≤200 chars each — the buyer's own canned messages; `useQuickReplies.ts:6-8, 62`).
- **`users/{uid}/bag/{productId}`** — a frozen snapshot of purchase intent: `productId`, `productName`, `productPrice`, `imageUrl`, `images[]`, `sellerSlug`, `sellerId`, `businessName`, `addedAt` (ms), `quantity` (`useBag.ts:7-18, 195`).

### 3.2 Anonymous buyer
Created by guest checkout so the order/chats behave like a signed-in buyer's (`ProductActions.tsx:163`). Their uid is a normal Firebase uid but `isAnonymous` is true, so the app treats them as a guest for UI purposes (`App.tsx:60-63`).

### 3.3 Guest buyer (no account at all)

A guest can browse, search, view stores, use Nearby and keep a **local** bag (`rachett_bag` on their device, merged into their account when they sign in). **They cannot message or buy** — those sheets show a sign-in prompt (`SignInPrompt.tsx`) and return them to the same action afterwards (`signInGate.ts`).

Because of that, these no longer happen:

- ❌ No `senderUid: "guest_+256…"` messages — the guest OTP flow was removed and `useGuestOTP.ts` deleted (16 Sep 2026).
- ❌ No `sendGuestOrderRequest` fallback, and no anonymous (`signInAnonymously`) buyer accounts.
- ⚠️ **Legacy data may still contain them** — older `sellers/{uid}/messages` rows written by guests, plus `localStorage.rachett_verified_guest` on old devices. Treat `guest_*` uids as historical; nothing writes them any more.

### 3.4 Order document (`sellers/{sellerId}/orders/{id}`)

`buyerName`, `buyerUid`, `buyerPhone` *(guests only — PII)*, `verified`, `productName`, `productPrice` *(string)*, `productId`, `quantity` *(string)*, `deliveryArea` *(free text)*, `status` (`pending` → `paid` / `awaiting_payment` → `fulfilled` / `out_of_stock` / `needs_details`), `read`, `sourcePlatform`, `orderId` (`RT-XXXXXX`), `createdAt` (`createBuyerOrder.ts:5-34`; `useSellerOrders.ts:6+`).
Payment fields are declared but **never written**: `paymentMethod`, `transactionId`, `flwRef`, `paymentStatus`.

### 3.5 Conversations and messages

`conversations/{sellerId_buyerId}` — `sellerId`, `buyerId`, `sellerName`, `buyerName`, `lastMessage`, `lastMessageAt`, `lastMessageBy`, `lastMessageStatus` (`sent` / `seen` = **read receipts**), `unreadBySeller`, `unreadByBuyer`, `unreadBySellerCount`, `unreadByBuyerCount` (`useConversation.ts:52-79`).

`conversations/{id}/messages/{id}` — `senderId`, `text`, `imageUrl`, `type` (`text` / `image` / `product` / `order`), `productId`, `productName`, `productPrice`, `productImage`, `orderId`, `quantity`, `status`, `createdAt` (`useConversation.ts:81-96, 162-172`).

⚠️ **Two chat systems coexist**: `sellers/{uid}/messages` (legacy/guest) and `conversations/*` (one thread per seller↔buyer pair). Any training pipeline must dedupe/merge them.

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
| `bagCounts/{productId}` | `{ count, baggedCount }` | `useBag.ts:41-70` |
| `bagCounts/{productId}/baggers/{uid}` | `{ at }` — one marker per user (distinct-people counting) | same |
| `products.orderCount` | number — bumped on every order placed | `createBuyerOrder.ts:152-153` |
| `products.salesCount` | number — bumped on fulfilment | `OrderHistory.tsx:62` |
| `sellers/{uid}/visits/*` | per-visit channel | `StorePage.tsx:428` |
| `feedback/{id}` | `role` (seller/buyer), `category`, `message`, `name`, `contact`, `page` (full URL), `submittedAt`, `userEmail`, `uid`, `createdAt` | `FeedbackPage.tsx:32-64` |
| `recoveries/{id}` | `email`, `codeHash` (SHA-256), `expiresAt`, `verified`, `attempts`, `createdAt` — client access denied | `functions/index.js:27-107`, `firestore.rules:89-91` |

---

## 6. Device-local only (never in the database)

| Key | Contents | Source |
|---|---|---|
| `rachett_setup_draft` | Half-finished store form (name, link, bio, country, location, phone, step) | `SetupStore.tsx:29` |
| `rachett_bag` | Bag items (full product snapshot) | `useBag.ts:20` |
| `rachett_buyer_area` | `{ lat, lng, place, label, source }` — **buyer's area, deliberately device-only** | `place.ts:165-175` |
| `rachett_verified_guest` | **Legacy** — written by the removed guest OTP flow; old devices may still hold it, nothing reads or writes it now | — |
| `rachett_last_user` | Last signed-in identity for "Continue as": displayName, **email**, photoURL, uid, providerId | `userMemory.ts:3-28` |
| `rachett_quick_replies_guest` | Guest quick replies | `useQuickReplies.ts:6` |
| `rachett_role` | The buyer/seller choice made on the onboarding screen — stops us asking twice (`role.ts`) | `role.ts` |
| `rachett_nearby_sort` | The Nearby quick control the buyer prefers (`closest` / `newest` / `popular`) — remembered so the page opens the way they like it (`NearbyPage.tsx`) | `NearbyPage.tsx` |
| `rachett_pending_action` (session) | The Buy/Message a guest was blocked on, so signing in returns them to it; expires after 15 min (`signInGate.ts`) | `signInGate.ts` |
| `rachett_draft_*` | Unsent message drafts per thread/product | `useDraft.ts:3` |
| `rachett_recent_searches_{uid}` | Last N searches | `BrowsePage.tsx:362-390` |
| `rachett_welcomed` (session) | Greeting shown flag | `Dashboard.tsx:64` |
| `rachett_skip_next_order_alert` (session) | Seller self-order test flag | `orderAlerts.ts:1` |

---

## 7. Third parties that receive data

| Processor | What it gets | Live? |
|---|---|---|
| **Cloudinary** | Logos, product photos, chat photos (compressed ≤1024px JPEG) + uploader IP | ✅ `uploadImage.ts`, `EditStore.tsx:201-208`, `BulkUpload.tsx:73-84` |
| **Africastalking** | Phone numbers + OTP SMS text | ✅ `server/index.js:83-87` |
| **Nominatim / OpenStreetMap** | Seller's typed area text **and** GPS coordinates; buyer area lookup | ✅ `place.ts:30` |
| **Resend** | Seller's `recoveryEmail` + 6-digit code | ✅ `functions/index.js` |
| **Google / Facebook / Apple** | OAuth identity (name, email, photo) | ✅ |
| **Formspree** | Feedback text, name, contact, page URL, user email | ⚠️ only if `VITE_FORMSPREE_ID` is set |
| **Flutterwave** | *Nothing* — `paymentService.ts` is **dead code** (no file imports it). **Decision (15 Sep 2026): leave it untouched until payments have been tested.** | ❌ |
| **FCM / push** | *Nothing* — no messaging SDK anywhere; `notifications.ts` is UI copy only | ❌ |

---

## 8. What we do NOT collect

- Payment instruments, card/mobile-money details, payment statuses (no provider is wired).
- Push notification tokens.
- Buyer GPS coordinates in the database (device-only) — orders carry a free-text `deliveryArea`.
- Impressions, dwell time, scroll depth, "not interested" signals.
- Ratings/reviews (see gap 1 below).
- **National IDs, passports, selfies or any other identity document.** Capture was removed on 15 Sep 2026 — SetupStore and EditStore now show a "COMING SOON" note where the upload used to be, so nothing is asked for and nothing is stored. It comes back only when there is a way to actually review it.

---

## 9. Data-quality gaps to fix before training

1. **No reviews/ratings exist.** `avgRating` / `reviewCount` are read in `useSellerStats` but nothing ever writes a review → no preference signal, no trust signal.
2. **`price` and `quantity` are strings** everywhere; there is no `currency` field (UGX appears only in UI copy). Must be normalised before any pricing model.
3. **`userId: 'guest'`** collapses every unauthenticated visitor into one entity, and events carry **no sessionId, device, locale or app version** → no cross-session funnels for guests.
4. **Click-level only.** `product_viewed` fires on tap (not on render); the only richer interaction signal is the double-tap survey.
5. **Search is captured only on Enter, only in Browse** — no zero-result or misspelling tracking, nothing from Nearby or Store.
6. **Orders lack buyer identity for signed-in buyers** (no email/phone), and `deliveryArea` is free text, never geocoded.
7. **Two chat systems** (§3.5) → dedupe before training.
8. **Mixed timestamps:** `serverTimestamp()` (authoritative) vs `new Date()` (client clock).
9. **Seller verification is paused:** National ID capture is switched off and the ✓ badge the wizard used to promise is now labelled "coming soon"; badges are still recomputed client-side rather than stored, and their timestamps are never written.
10. **No data-deletion flow:** the only `deleteDoc` calls are bag items (`useBag.ts:210, 241`) — there is no account/data-erasure path.

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

### Indexes (needed by the Browse catalog feed)

`firestore.indexes.json` holds one **collection-group index on `products.createdAt` (DESC)** — the feed in `useProductFeed.ts` uses it to page the whole catalog in one query. Deploy it once:

```bash
npm run deploy:indexes      # firebase deploy --only firestore:indexes
```

Until it's deployed, Browse catches the query error and falls back to the old per-store reads (a batch of 10 stores a page), so the page still works — the console prints the reminder. Build takes a few minutes after the first deploy.




