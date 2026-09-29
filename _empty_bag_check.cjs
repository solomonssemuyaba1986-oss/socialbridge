/**
 * Dev-only harness for the empty bag's fallback plan (`src/emptyBag.ts`).
 *
 *   npx tsc --ignoreConfig src/emptyBag.ts --outDir _dsbuild --module commonjs --target es2020 --skipLibCheck
 *   Move-Item -Force _dsbuild/emptyBag.js _dsbuild/emptyBag.cjs
 *   node _empty_bag_check.cjs
 *
 * Pins what an empty bag is allowed to say: their own trail comes first, suggestions are only things
 * that can actually be bought and opened, nothing they already looked at is served back to them, a
 * distance we cannot honestly compute is never used, a narrow area never empties the shelf, and the
 * one sentence on the screen has to be true about the person reading it.
 */
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const {
  EMPTY_BAG_RECENT_LIMIT,
  EMPTY_BAG_SUGGESTION_LIMIT,
  BAG_NEAR_REACH_KM,
  RECENT_RAIL_TITLE,
  BOUGHT_TITLE,
  BOUGHT_NEAR_TITLE,
  movedCount,
  bagHref,
  firstPhoto,
  mergeRecent,
  bagSuggestions,
  emptyBagRails,
  emptyBagBlurb,
  boughtWords,
  wantsFallbackShelf,
} = require(path.join(__dirname, '_dsbuild', 'emptyBag.cjs'))

let checks = 0
const check = (name, fn) => { fn(); checks++; console.log('  ok  ' + name) }

const row = (over = {}) => ({
  id: 'p1',
  name: 'A dress',
  price: '40000',
  sellerSlug: 'amina',
  businessName: 'Amina Fabrics',
  ...over,
})
const entry = (over = {}) => ({
  productId: 'p1', name: 'A dress', price: '40000', imageUrl: '', sellerId: 's1',
  sellerSlug: 'amina', businessName: 'Amina Fabrics', at: 1000, ...over,
})

check('movement is the market\'s own sum: an order counts double, a sale once', () => {
  assert.strictEqual(movedCount({ orderCount: 3, salesCount: 4 }), 10)
  assert.strictEqual(movedCount({ salesCount: 4 }), 4)
  assert.strictEqual(movedCount({}), 0)
  assert.strictEqual(movedCount(null), 0)
  assert.strictEqual(movedCount({ orderCount: 'lots', salesCount: -5 }), 0, 'junk is not a sale')
})

check('a suggestion always has a door: the deep link StorePage already understands', () => {
  assert.strictEqual(bagHref(row()), '/store/amina?productId=p1')
  assert.strictEqual(bagHref({ id: 'p1', sellerSlug: 'amina shop' }), '/store/amina%20shop?productId=p1')
  assert.strictEqual(bagHref({ id: 'p1' }, 'fallback'), '/store/fallback?productId=p1')
  assert.strictEqual(bagHref(row(), 'ignored'), '/store/amina?productId=p1', 'the product wins its own shop')
  assert.strictEqual(bagHref({ sellerSlug: 'amina' }), '', 'no id means no door')
  assert.strictEqual(bagHref({ id: 'p1' }), '', 'no shop means no door')
  assert.strictEqual(bagHref(null), '')
})

check('a photo is the first one that exists, and a missing one is not an error', () => {
  assert.strictEqual(firstPhoto({ imageUrl: 'one.jpg', images: ['two.jpg'] }), 'one.jpg')
  assert.strictEqual(firstPhoto({ images: ['', 'two.jpg'] }), 'two.jpg')
  assert.strictEqual(firstPhoto({ images: 'two.jpg' }), '', 'a string is not a list of photos')
  assert.strictEqual(firstPhoto({}), '')
  assert.strictEqual(firstPhoto(undefined), '')
})

check('their own trail is merged across surfaces, newest look wins, nothing repeats', () => {
  const browse = [entry({ productId: 'a', at: 5 }), entry({ productId: 'b', at: 9 })]
  const nearby = [entry({ productId: 'a', at: 40, name: 'A dress (seen again)' }), entry({ productId: 'c', at: 20 })]
  const merged = mergeRecent([browse, nearby])
  assert.deepStrictEqual(merged.map(e => e.productId), ['a', 'c', 'b'])
  assert.strictEqual(merged[0].name, 'A dress (seen again)', 'the most recent look is the one shown')
  assert.deepStrictEqual(mergeRecent([null, undefined, []]), [], 'no surfaces, no rows')
  assert.deepStrictEqual(mergeRecent([[entry({ productId: '' })]]), [], 'a row with no product is not a row')
})

check('the recent rail is one small rail, and it obeys its own limit', () => {
  const many = Array.from({ length: 20 }, (_, i) => entry({ productId: 'p' + i, at: i }))
  assert.strictEqual(mergeRecent([many]).length, EMPTY_BAG_RECENT_LIMIT)
  assert.deepStrictEqual(mergeRecent([many], 2).map(e => e.productId), ['p19', 'p18'])
  assert.deepStrictEqual(mergeRecent([many], 0), [])
  assert.deepStrictEqual(mergeRecent([many], -3), [], 'a nonsense limit shows nothing, never everything')
})

check('suggestions leave out what cannot be bought, and what cannot be opened', () => {
  const list = [
    row({ id: 'sold-out', outOfStock: true }),
    row({ id: 'no-shop', sellerSlug: undefined }),
    row({ id: 'fine' }),
    null,
    undefined,
  ]
  assert.deepStrictEqual(bagSuggestions(list).map(s => s.product.id), ['fine'])
})

check('every suggestion carries its own id, so the rail and the tap agree on what it is', () => {
  const out = bagSuggestions([row({ id: 'p9' }), row({ id: 42 })])
  assert.deepStrictEqual(out.map(s => s.id), ['p9', '42'], 'an id is text, whichever way the row stored it')
  out.forEach(s => {
    assert.ok(s.id && s.href.includes(s.id), `${s.id} must be the id its own door is built from`)
  })
  assert.deepStrictEqual(bagSuggestions([row({ id: '   ' })]), [], 'whitespace is not an id')
})

check('a row that does not carry its shop is still offered, using the page\'s shop directory', () => {
  const bare = row({ id: 'bare', sellerId: 's1', sellerSlug: undefined, businessName: undefined })
  const storeOf = id => (id === 's1' ? { slug: 'amina', businessName: 'Amina Fabrics' } : undefined)

  // Without the directory a row with no slug has no door at all — which is why the page passes one.
  assert.deepStrictEqual(bagSuggestions([bare]), [])
  const [only] = bagSuggestions([bare], { storeOf })
  assert.strictEqual(only.href, '/store/amina?productId=bare')
  assert.strictEqual(only.businessName, 'Amina Fabrics')

  // A row that does carry its own shop keeps it: the document in hand beats the directory.
  const [mine] = bagSuggestions([row({ id: 'own', sellerId: 's1' })], { storeOf: () => ({ slug: 'someone-else', businessName: 'Wrong Shop' }) })
  assert.strictEqual(mine.href, '/store/amina?productId=own')
  assert.strictEqual(mine.businessName, 'Amina Fabrics')

  // A shop the directory has never heard of is still unopenable, so it is still not offered.
  assert.deepStrictEqual(bagSuggestions([row({ id: 'x', sellerId: 's9', sellerSlug: undefined })], { storeOf }), [])
  // And a row whose sellerId is junk is not allowed to borrow anybody's shop.
  assert.deepStrictEqual(bagSuggestions([row({ id: 'y', sellerId: undefined, sellerSlug: undefined })], { storeOf: () => ({ slug: 'amina' }) }), [])
})

check('nothing they already looked at is served back to them', () => {
  const list = [row({ id: 'seen' }), row({ id: 'fresh' })]
  assert.deepStrictEqual(bagSuggestions(list, { seen: ['seen'] }).map(s => s.product.id), ['fresh'])
  assert.deepStrictEqual(bagSuggestions(list, { seen: new Set(['seen', 'fresh']) }), [])
})

check('the shelf is ranked by what actually moves, and it says how much', () => {
  const list = [
    row({ id: 'slow', orderCount: 0, salesCount: 2 }),
    row({ id: 'fast', orderCount: 5, salesCount: 1 }),
    row({ id: 'dead' }),
  ]
  const out = bagSuggestions(list)
  assert.deepStrictEqual(out.map(s => s.product.id), ['fast', 'slow', 'dead'])
  assert.strictEqual(out[0].bought, 11)
  assert.strictEqual(out[0].name, 'A dress')
  assert.strictEqual(out[0].price, '40000')
  assert.strictEqual(out[0].businessName, 'Amina Fabrics')
  assert.strictEqual(out[0].href, '/store/amina?productId=fast')
  assert.strictEqual(out[0].why, BOUGHT_TITLE)
})

check('the shelf is short, and a nonsense limit is not an excuse to show everything', () => {
  const list = Array.from({ length: 30 }, (_, i) => row({ id: 'p' + i, salesCount: i }))
  assert.strictEqual(bagSuggestions(list).length, EMPTY_BAG_SUGGESTION_LIMIT)
  assert.strictEqual(bagSuggestions(list, { limit: 2 }).length, 2)
  assert.deepStrictEqual(bagSuggestions(list, { limit: 0 }), [])
  assert.deepStrictEqual(bagSuggestions(list, { limit: -1 }), [])
})

check('a known shop within reach gets the shelf, and it says so', () => {
  const list = [
    row({ id: 'near', sellerId: 'near', salesCount: 1 }),
    row({ id: 'far', sellerId: 'far', salesCount: 9 }),
  ]
  const distanceOf = p => (p.sellerId === 'near' ? 4 : 35)
  const out = bagSuggestions(list, { distanceOf })
  assert.deepStrictEqual(out.map(s => s.product.id), ['near'], 'only what is actually within reach')
  assert.strictEqual(out[0].why, BOUGHT_NEAR_TITLE)
  assert.ok(BAG_NEAR_REACH_KM >= 25, 'a delivery radius that cannot reach a neighbouring town is not useful')
})

check('a narrow area never empties the shelf — we widen out rather than show nothing', () => {
  const list = [row({ id: 'far', sellerId: 'far', salesCount: 9 })]
  const out = bagSuggestions(list, { distanceOf: () => 400 })
  assert.deepStrictEqual(out.map(s => s.product.id), ['far'], 'something honest beats an empty rail')
  assert.strictEqual(out[0].why, BOUGHT_TITLE, 'and it does not claim to be nearby')
})

check('a shop we cannot place is not called near, and is not called far either', () => {
  const list = [row({ id: 'unplaced', sellerId: 'no-pin', salesCount: 3 })]
  const out = bagSuggestions(list, { distanceOf: () => null })
  assert.deepStrictEqual(out.map(s => s.product.id), ['unplaced'])
  assert.strictEqual(out[0].why, BOUGHT_TITLE)
  assert.strictEqual(bagSuggestions(null).length, 0, 'no feed, no shelf')
})

check('the rails read in one order — their own trail, then ours', () => {
  const both = emptyBagRails({ recentCount: 3, suggestionCount: 4 })
  assert.deepStrictEqual(both.map(r => r.kind), ['recent', 'bought'])
  assert.strictEqual(both[0].title, RECENT_RAIL_TITLE)
  assert.strictEqual(both[0].blurb, 'Opened on this phone — tap to look again.', 'history lives on the phone')
  assert.deepStrictEqual(emptyBagRails({ recentCount: 3, suggestionCount: 0 }).map(r => r.kind), ['recent'])
  assert.deepStrictEqual(emptyBagRails({ recentCount: 0, suggestionCount: 4 }).map(r => r.kind), ['bought'])
  assert.deepStrictEqual(emptyBagRails({ recentCount: 0, suggestionCount: 0 }), [], 'no shelf is ever labelled empty')
  assert.strictEqual(emptyBagRails({ recentCount: 2, suggestionCount: 2, near: true })[1].title, BOUGHT_NEAR_TITLE)
})

check('the one sentence on the screen is true about the person reading it', () => {
  const plain = 'Browse stores and tap the bag on any product to save it here.'
  assert.strictEqual(emptyBagBlurb({ recentCount: 0, suggestionCount: 0 }), plain)
  assert.ok(emptyBagBlurb({ recentCount: 2, suggestionCount: 0 }).includes('what you were looking at'))
  assert.ok(emptyBagBlurb({ recentCount: 0, suggestionCount: 2 }).includes('buying right now'))
  assert.ok(emptyBagBlurb({ recentCount: 0, suggestionCount: 2, near: true }).includes('near you'))
  const both = emptyBagBlurb({ recentCount: 1, suggestionCount: 1 })
  assert.ok(both.includes('where you left off') && both.includes('moving right now'))
  assert.ok(!emptyBagBlurb({ recentCount: 0, suggestionCount: 5 }).includes('left off'), 'never claims a trail they do not have')
  assert.ok(!emptyBagBlurb({ recentCount: 0, suggestionCount: 0 }).includes('right now'))
})

check('a bought count is said plainly, and never as a boast when there is nothing to boast about', () => {
  assert.strictEqual(boughtWords(0), '')
  assert.strictEqual(boughtWords(1), '✓ 1 bought')
  assert.strictEqual(boughtWords(12), '✓ 12 bought')
  assert.strictEqual(boughtWords(1200), '✓ 999+ bought')
  assert.strictEqual(boughtWords(-4), '')
  assert.strictEqual(boughtWords(Number.NaN), '')
})

check('an empty bag only pays for a shelf when their own trail is too short to fill one', () => {
  assert.strictEqual(wantsFallbackShelf(0), true)
  assert.strictEqual(wantsFallbackShelf(EMPTY_BAG_RECENT_LIMIT - 1), true)
  assert.strictEqual(wantsFallbackShelf(EMPTY_BAG_RECENT_LIMIT), false, 'a full trail is enough on its own')
  assert.strictEqual(wantsFallbackShelf(99), false)
  assert.strictEqual(wantsFallbackShelf(-1), true)
  assert.strictEqual(wantsFallbackShelf(Number.NaN), true, 'an unknown count asks for the shelf, never skips it')
})

check('this module stays pure: it can be pinned with no app around it', () => {
  const emitted = fs.readFileSync(path.join(__dirname, '_dsbuild', 'emptyBag.cjs'), 'utf8')
  assert.ok(!/\brequire\(/.test(emitted), 'no runtime imports — the checks must never need React or Firestore')
})

console.log(`\n${checks} empty-bag checks passed`)
