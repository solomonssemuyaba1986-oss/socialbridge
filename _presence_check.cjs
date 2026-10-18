/**
 * Dev-only harness for seller presence — the words a buyer reads in a chat header, and the
 * wiring that feeds them.
 *
 *   npx tsc --ignoreConfig src/presenceUtils.ts --outDir _dsbuild --module commonjs --target es2020 --skipLibCheck
 *   Move-Item -Force _dsbuild/presenceUtils.js _dsbuild/presenceUtils.cjs
 *   node _presence_check.cjs
 *
 * `src/presenceUtils.ts` is the rule (what a timestamp is allowed to say); `src/presence.ts` is
 * the wiring (the seller's heartbeat and the buyer's listener); `src/ConversationPanel.tsx` is
 * where it is shown. A wrong label here is a lie about a real person — "Active now" when nobody
 * is there, or "Last seen" for a shop that never wrote the field — so the boundaries (5 min,
 * 1 h, 7 d, future clocks) are pinned exactly, and the wiring is checked to still match.
 */
const assert = require('assert')
const fs = require('fs')
const path = require('path')

let checks = 0
const check = (name, fn) => {
  try {
    fn()
  } catch (err) {
    console.error(`FAIL  ${name}`)
    err.message = `${name}\n    ${err.message}`
    throw err
  }
  checks++
  console.log('  ok  ' + name)
}

const ROOT = __dirname
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8')
const BUILD = path.join(ROOT, '_dsbuild', 'presenceUtils.cjs')
const DEP = path.join(ROOT, '_dsbuild', 'productCardUtils.js')
if (!fs.existsSync(BUILD) || !fs.existsSync(DEP)) {
  console.error('\n  Build the pure module first (productCardUtils is its one dependency):\n')
  console.error('    npx tsc --ignoreConfig src/presenceUtils.ts --outDir _dsbuild --module commonjs --target es2020 --skipLibCheck')
  console.error('    Move-Item -Force _dsbuild/presenceUtils.js _dsbuild/presenceUtils.cjs')
  console.error('    node _presence_check.cjs\n')
  process.exit(1)
}

const { ACTIVE_WINDOW_MS, presenceOf } = require(BUILD)

const NOW = Date.UTC(2026, 9, 17, 12, 0, 0)
const MIN = 60 * 1000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

// -- what a timestamp is allowed to say -----------------------------------------------------

check('a shop that never wrote a lastSeen says nothing at all', () => {
  for (const value of [undefined, null, '', {}, [], 'yesterday', NaN, Infinity]) {
    assert.deepStrictEqual(
      presenceOf(value, NOW),
      { known: false, online: false, label: '', lastSeenMs: null },
      'for ' + String(value),
    )
  }
})

check('five minutes is the whole difference between "now" and "5 min ago"', () => {
  assert.deepStrictEqual(
    presenceOf(NOW, NOW),
    { known: true, online: true, label: 'Active now', lastSeenMs: NOW },
  )
  assert.strictEqual(presenceOf(NOW - (ACTIVE_WINDOW_MS - 1), NOW).online, true)
  const edge = presenceOf(NOW - ACTIVE_WINDOW_MS, NOW)
  assert.strictEqual(edge.online, false)
  assert.strictEqual(edge.label, 'Active 5 min ago')
})

check('the label counts up, and floors rather than overstates the gap', () => {
  assert.strictEqual(presenceOf(NOW - 12 * MIN, NOW).label, 'Active 12 min ago')
  assert.strictEqual(presenceOf(NOW - 59 * MIN, NOW).label, 'Active 59 min ago')
  assert.strictEqual(presenceOf(NOW - 60 * MIN, NOW).label, 'Active 1h ago')
  // 1 h 59 m is still "1h", never "2h"
  assert.strictEqual(presenceOf(NOW - 119 * MIN, NOW).label, 'Active 1h ago')
  assert.strictEqual(presenceOf(NOW - 23 * HOUR - 59 * MIN, NOW).label, 'Active 23h ago')
  assert.strictEqual(presenceOf(NOW - 24 * HOUR, NOW).label, 'Active 1d ago')
  assert.strictEqual(presenceOf(NOW - 3 * DAY, NOW).label, 'Active 3d ago')
  // 6 d 23 h has not crossed the week, and never reads as "7d"
  assert.strictEqual(presenceOf(NOW - 6 * DAY - 23 * HOUR, NOW).label, 'Active 6d ago')
})

check('a week away is "Last seen", not "Active"', () => {
  assert.strictEqual(presenceOf(NOW - 7 * DAY + 1, NOW).label, 'Active 6d ago')
  assert.strictEqual(presenceOf(NOW - 7 * DAY, NOW).label, 'Last seen 7d ago')
  assert.strictEqual(presenceOf(NOW - 30 * DAY, NOW).label, 'Last seen 30d ago')
  assert.strictEqual(presenceOf(NOW - 7 * DAY, NOW).online, false)
})

check('a future timestamp is not evidence that someone is here', () => {
  assert.deepStrictEqual(
    presenceOf(NOW + 25 * HOUR, NOW),
    { known: false, online: false, label: '', lastSeenMs: null },
  )
  // A minute of disagreement between two clocks is tolerated — still "now".
  assert.strictEqual(presenceOf(NOW + MIN, NOW).online, true)
})

check('every date shape the app writes can be read', () => {
  assert.strictEqual(presenceOf(new Date(NOW - 12 * MIN), NOW).label, 'Active 12 min ago')
  assert.strictEqual(presenceOf(NOW - 12 * MIN, NOW).label, 'Active 12 min ago')
  assert.strictEqual(presenceOf({ toMillis: () => NOW - 12 * MIN }, NOW).label, 'Active 12 min ago')
  assert.strictEqual(presenceOf(NOW - 12 * MIN, NOW).lastSeenMs, NOW - 12 * MIN)
})


// -- the wiring: one writer, one reader, one source of words --------------------------------

check('the heartbeat writes only lastSeen, merge-only', () => {
  const src = read('src/presence.ts')
  assert.match(src, /setDoc\(doc\(db, 'sellers', uid\), \{ lastSeen: serverTimestamp\(\) \}, \{ merge: true \}\)/)
  assert.ok(!src.includes("'Active now'"), 'the words must live in presenceUtils.ts, not be duplicated')
  assert.ok(src.includes("export { ACTIVE_WINDOW_MS, presenceOf, type Presence } from './presenceUtils'"))
})

check('a hidden tab stops saying "still here"', () => {
  const src = read('src/presence.ts')
  assert.match(src, /if \(!uid \|\| !enabled\) return/)
  assert.match(src, /document\.visibilityState === 'visible'/)
  assert.match(src, /addEventListener\('visibilitychange', onVisibility\)/)
  assert.match(src, /removeEventListener\('visibilitychange', onVisibility\)/)
  assert.match(src, /window\.clearInterval\(id\)/)
  assert.match(src, /snap => setSeen\(\{ sellerId, ms: toMillis\(snap\.data\(\)\?\.lastSeen\) \?\? null \}\)/)
  // Switching threads can never show the previous shop's timestamp: the value is keyed by shop.
  assert.match(src, /seen\?\.sellerId === sellerId/)
})

check("the seller's app is what beats, and only for a seller", () => {
  const live = read('src/sellerLive.tsx')
  assert.match(live, /useSellerHeartbeat[\s\S]{0,80}from '\.\/presence'/)
  assert.match(live, /useSellerHeartbeat\(uid, isSeller\)/)
  assert.ok(!read('src/ConversationPanel.tsx').includes('useSellerHeartbeat'))
})

check("the buyer sees presence only in someone else's thread", () => {
  const src = read('src/ConversationPanel.tsx')
  assert.match(src, /useSellerPresence\(sellerId, !meIsSeller\)/)
  assert.match(src, /\{!meIsSeller && sellerPresence\.known && \(/)
  assert.match(src, /\{sellerPresence\.label\}/)
  // Known only: a shop that never wrote lastSeen draws no badge rather than "offline".
  assert.ok(src.includes('sellerPresence.known'))
  assert.match(src, /\{nameLabel\(meIsSeller \? buyerName : sellerName\)\}/)
})

check('the rules let a seller write lastSeen and let anyone read it', () => {
  const rules = read('firestore.rules')
  const start = rules.indexOf('match /sellers/{sellerId}')
  const end = rules.indexOf('match /products/{productId}')
  assert.ok(start >= 0 && end > start, 'sellers block not found')
  const block = rules.slice(start, end)
  assert.match(block, /allow read: if true;/)
  assert.match(block, /allow update: if request\.auth\.uid == sellerId/)
  // It is an ordinary owner-writable field — never a server-only one like ratingAvg.
  assert.ok(!block.includes('lastSeen'), 'lastSeen must not be in the refused list')
})

check('DATA_COLLECTION names the field and its limits', () => {
  const doc = read('DATA_COLLECTION.md')
  assert.match(doc, /\| `lastSeen` \| Timestamp/)
  assert.ok(doc.includes('no phone number, no location and no history'))
  assert.ok(doc.includes('A hidden tab stops writing'))
})

console.log(`\n  ${checks} presence checks passed\n`)

