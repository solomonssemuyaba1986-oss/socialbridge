/**
 * Dev-only harness for the "New seller" badge — the three-day window and the three pages that show it.
 *
 *   npx tsc --ignoreConfig src/sellerAge.ts src/productCardUtils.ts --outDir _dsbuild --module commonjs --target es2020 --skipLibCheck
 *   Move-Item -Force _dsbuild/sellerAge.js _dsbuild/sellerAge.cjs
 *   node _sellerage_check.cjs
 *
 * The badge is a claim about a real shop, so the rule is pinned at both edges (a shop opened
 * 2 d 23 h ago is new; exactly 3 d is not) and for every way a date can be missing or wrong.
 * The wiring checks are just as important: a badge that appears on your own listing, or that
 * only one of Browse's two grids draws, is a bug no build log would mention.
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
const BUILD = path.join(ROOT, '_dsbuild', 'sellerAge.cjs')
const DEP = path.join(ROOT, '_dsbuild', 'productCardUtils.js')
if (!fs.existsSync(BUILD) || !fs.existsSync(DEP)) {
  console.error('\n  Build the pure modules first:\n')
  console.error('    npx tsc --ignoreConfig src/sellerAge.ts src/productCardUtils.ts --outDir _dsbuild --module commonjs --target es2020 --skipLibCheck')
  console.error('    Move-Item -Force _dsbuild/sellerAge.js _dsbuild/sellerAge.cjs')
  console.error('    node _sellerage_check.cjs\n')
  process.exit(1)
}

const { NEW_SELLER_DAYS, NEW_SELLER_LABEL, isNewSeller } = require(BUILD)

const NOW = Date.UTC(2026, 9, 17, 12, 0, 0)
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

// -- the rule -------------------------------------------------------------------------------

check('a shop is "new" for three days exactly', () => {
  assert.strictEqual(NEW_SELLER_DAYS, 3)
  assert.strictEqual(isNewSeller(NOW, NOW), true)
  assert.strictEqual(isNewSeller(NOW - 2 * DAY - 23 * HOUR, NOW), true)
  assert.strictEqual(isNewSeller(NOW - 3 * DAY + 1, NOW), true)
  assert.strictEqual(isNewSeller(NOW - 3 * DAY, NOW), false)
  assert.strictEqual(isNewSeller(NOW - 3 * DAY - 1, NOW), false)
  assert.strictEqual(isNewSeller(NOW - 365 * DAY, NOW), false)
})

check('a future date is a bad clock, never a new shop', () => {
  assert.strictEqual(isNewSeller(NOW + 1, NOW), false)
  assert.strictEqual(isNewSeller(NOW + DAY, NOW), false)
  assert.strictEqual(isNewSeller(NOW + 60 * DAY, NOW), false)
})

check('missing or junk dates are not evidence', () => {
  for (const value of [undefined, null, '', {}, [], 'yesterday', NaN, Infinity, 0]) {
    assert.strictEqual(isNewSeller(value, NOW), false, 'for ' + String(value))
  }
})

check('every date shape the app writes is understood', () => {
  assert.strictEqual(isNewSeller(new Date(NOW - DAY), NOW), true)
  assert.strictEqual(isNewSeller(NOW - DAY, NOW), true)
  assert.strictEqual(isNewSeller({ toMillis: () => NOW - DAY }, NOW), true)
})

// -- the label has one definition -----------------------------------------------------------

check('the badge text is defined once and uppercased, never typed into a page', () => {
  assert.strictEqual(NEW_SELLER_LABEL, 'New seller')
  for (const file of ['src/ProductCard.tsx', 'src/BrowsePage.tsx', 'src/StorePage.tsx']) {
    const src = read(file)
    assert.ok(!src.includes('NEW SELLER'), file + ' hard-codes the badge text')
    assert.ok(src.includes('NEW_SELLER_LABEL'), file + ' does not use the shared label')
    assert.ok(src.includes("textTransform: 'uppercase'"), file + ' does not uppercase the label')
  }
})

// -- the three surfaces ---------------------------------------------------------------------

check('Browse stamps the shop opening date onto every card', () => {
  const src = read('src/BrowsePage.tsx')
  assert.match(src, /sellerCreatedAt: info\?\.createdAt/)
  // Both grids — the popular row and the main feed — carry the badge, and never for your shop.
  assert.strictEqual((src.match(/!isMyListing\(p\) && isNewSeller\(p\.sellerCreatedAt\)/g) || []).length, 2)
  // "Mine" is the uid as well as the slug, so a legacy row cannot be called new.
  assert.match(src, /const isMyListing = \(p: Product\) =>\s*Boolean\(\(mySlug && p\.sellerSlug === mySlug\) \|\| \(userId && p\.sellerId === userId\)\)/)
})

check('Nearby badges a card from the seller doc, never your own', () => {
  const nearby = read('src/NearbyPage.tsx')
  assert.match(nearby, /newSeller=\{isNewSeller\(seller\?\.createdAt\)\}/)
  assert.match(nearby, /isMine=\{p\.sellerId === userId\}/)
  const card = read('src/ProductCard.tsx')
  assert.match(card, /\{newSeller && !isMine && \(/)
})

check("the storefront badge stays off the owner's own shop", () => {
  const src = read('src/StorePage.tsx')
  assert.match(src, /newSeller=\{isNewSeller\(seller\.createdAt\)\}/)
  assert.match(src, /\{newSeller && !isOwner && \(/)
})

check('the badge rests on the shared date reader', () => {
  const src = read('src/sellerAge.ts')
  assert.match(src, /import \{ toMillis \} from '\.\/productCardUtils'/)
  assert.match(src, /const openedAt = toMillis\(createdAt\)/)
  assert.ok(src.includes('return age >= 0 && age < NEW_SELLER_DAYS * 24 * 60 * 60 * 1000'))
})

check('the product count is read before orders, so a buyer can still earn the badge a view', () => {
  const src = read('src/useSellerStats.ts')
  const productsAt = src.indexOf("collection(db, 'sellers', sid, 'products')")
  const ordersAt = src.indexOf("collection(db, 'sellers', sid, 'orders')")
  assert.ok(productsAt > 0 && ordersAt > 0)
  assert.ok(productsAt < ordersAt, 'the public product read must not sit behind the private order read')
  assert.ok(src.includes("could not read the public products"), 'the two reads need separate failures')
})

check('trust badges are visible to buyers, in the thread, and to the seller themselves', () => {
  for (const file of ['src/ProductSheet.tsx', 'src/ConversationPanel.tsx', 'src/Dashboard.tsx', 'src/StorePage.tsx']) {
    assert.ok(read(file).includes('SellerTrustBadges'), `${file} does not render the seller badges`)
  }
  const component = read('src/SellerTrustBadges.tsx')
  assert.ok(component.includes('Real Seller') && component.includes('Reliable Seller'))
  assert.ok(component.includes('showEmpty'), 'the seller must be able to see the absence and work toward it')
})

check('DATA_COLLECTION says where the badge comes from', () => {
  const doc = read('DATA_COLLECTION.md')
  assert.match(doc, /"New seller"\*\* badge/)
  assert.ok(doc.includes('under 3 days old, and never on your own products'))
})

console.log(`\n  ${checks} new-seller checks passed\n`)

