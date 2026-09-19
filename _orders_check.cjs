/**
 * Dev-only harness for the buyer's orders list (`src/buyerOrderUtils.ts`).
 *
 *   npx tsc --ignoreConfig src/buyerOrderUtils.ts --outDir _dsbuild --module commonjs --target es2020 --skipLibCheck
 *   Move-Item -Force _dsbuild/buyerOrderUtils.js _dsbuild/buyerOrderUtils.cjs
 *   node _orders_check.cjs
 *
 * Pins the two things a buyer actually reads — the status sentence and the price — plus the
 * index that makes the list possible at all (without it the page can only show a notice).
 */
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const {
  buyerStatusLabel,
  countNewOrders,
  isActiveBuyerOrder,
  isOrderNew,
  matchesBuyerFilter,
  orderAge,
  orderChangedMs,
  orderTotal,
  splitBuyerOrders,
  wasUpdatedAfterPlacing,
} = require(path.join(__dirname, '_dsbuild', 'buyerOrderUtils.cjs'))

let checks = 0
const check = (name, fn) => { fn(); checks++; console.log('  ok  ' + name) }

check('every stored status becomes a sentence a buyer understands', () => {
  assert.strictEqual(buyerStatusLabel('pending').text, 'Waiting for the seller')
  assert.strictEqual(buyerStatusLabel('paid').text, 'Waiting for the seller')
  assert.strictEqual(buyerStatusLabel('awaiting_payment').text, 'Waiting for the seller')
  assert.strictEqual(buyerStatusLabel(undefined).text, 'Waiting for the seller')
  assert.strictEqual(buyerStatusLabel('fulfilled').text, 'Delivered')
  assert.strictEqual(buyerStatusLabel('out_of_stock').text, 'Not available')
  assert.strictEqual(buyerStatusLabel('needs_details').text, 'The seller needs details')
  assert.strictEqual(buyerStatusLabel('cancelled').text, 'Cancelled')
  // A status we have never heard of must not say "undefined" to a person.
  assert.strictEqual(buyerStatusLabel('something_new').text, 'Waiting for the seller')
})

check('the tone matches the news (delivered is green, refused is red)', () => {
  assert.strictEqual(buyerStatusLabel('fulfilled').tone, 'green')
  assert.strictEqual(buyerStatusLabel('out_of_stock').tone, 'red')
  assert.strictEqual(buyerStatusLabel('pending').tone, 'amber')
  assert.strictEqual(buyerStatusLabel('cancelled').tone, 'grey')
})

check('"still coming" means anything not delivered and not cancelled', () => {
  assert.strictEqual(isActiveBuyerOrder('pending'), true)
  assert.strictEqual(isActiveBuyerOrder('needs_details'), true)
  assert.strictEqual(isActiveBuyerOrder('out_of_stock'), true)
  assert.strictEqual(isActiveBuyerOrder(undefined), true)
  assert.strictEqual(isActiveBuyerOrder('fulfilled'), false)
  assert.strictEqual(isActiveBuyerOrder('cancelled'), false)
})

check('the split keeps every order exactly once', () => {
  const orders = [
    { id: '1', status: 'pending' },
    { id: '2', status: 'fulfilled' },
    { id: '3', status: 'needs_details' },
    { id: '4', status: 'cancelled' },
  ]
  const { active, past } = splitBuyerOrders(orders)
  assert.deepStrictEqual(active.map(o => o.id), ['1', '3'])
  assert.deepStrictEqual(past.map(o => o.id), ['2', '4'])
  assert.strictEqual(active.length + past.length, orders.length)
})

check('the filter chips agree with the split', () => {
  assert.strictEqual(matchesBuyerFilter('anything', 'all'), true)
  assert.strictEqual(matchesBuyerFilter('pending', 'active'), true)
  assert.strictEqual(matchesBuyerFilter('fulfilled', 'active'), false)
  assert.strictEqual(matchesBuyerFilter('fulfilled', 'delivered'), true)
  assert.strictEqual(matchesBuyerFilter('pending', 'delivered'), false)
})

check('prices are strings in the database, and survive the trip', () => {
  assert.strictEqual(orderTotal('45000', 2), 90000)
  assert.strictEqual(orderTotal('45,000', '2'), 90000)
  assert.strictEqual(orderTotal('45000', 1), 45000)
  // A missing quantity is one item, never zero.
  assert.strictEqual(orderTotal('45000', undefined), 45000)
  assert.strictEqual(orderTotal('45000', 0), 45000)
  // Junk never becomes NaN on a card.
  assert.strictEqual(orderTotal(undefined, undefined), 0)
  assert.strictEqual(orderTotal('free', 3), 0)
})

check('ages read like a person wrote them', () => {
  const now = 1_700_000_000_000
  assert.strictEqual(orderAge(now, now), 'just now')
  assert.strictEqual(orderAge(now - 12 * 60000, now), '12m ago')
  assert.strictEqual(orderAge(now - 90 * 60000, now), '2h ago')
  assert.strictEqual(orderAge(now - 25 * 3600000, now), 'yesterday')
  assert.strictEqual(orderAge(now - 3 * 24 * 3600000, now), '3 days ago')
  assert.strictEqual(orderAge(now - 35 * 24 * 3600000, now), 'last month')
  assert.strictEqual(orderAge(now - 95 * 24 * 3600000, now), '3 months ago')
  // An order with no date shows no age at all — never "NaN ago".
  assert.strictEqual(orderAge(undefined, now), '')
  assert.strictEqual(orderAge(0, now), '')
})

check('the moment an order changed falls back to when it was placed', () => {
  assert.strictEqual(orderChangedMs({ createdAt: 1000 }), 1000)
  assert.strictEqual(orderChangedMs({ createdAt: 1000, updatedAt: 2000 }), 2000)
  assert.strictEqual(orderChangedMs({}), 0)
})

check('a brand-new order was PLACED, not "updated"', () => {
  assert.strictEqual(wasUpdatedAfterPlacing({ createdAt: 1000, updatedAt: 1000 }), false)
  assert.strictEqual(wasUpdatedAfterPlacing({ createdAt: 1000 }), false)
  // The seller confirming an hour later is a real update.
  assert.strictEqual(wasUpdatedAfterPlacing({ createdAt: 1000, updatedAt: 1000 + 60 * 60000 }), true)
  // Within the tolerance (the write's own second) it is still just "placed".
  assert.strictEqual(wasUpdatedAfterPlacing({ createdAt: 1000, updatedAt: 1010 }), false)
})

check('"new since you last looked" needs a recorded visit first', () => {
  const changed = { createdAt: 1000, updatedAt: 5000 }
  // Never looked before (seenAt 0): nothing is called new — no dot on every row.
  assert.strictEqual(isOrderNew(changed, 0), false)
  assert.strictEqual(isOrderNew(changed, 4000), true)
  assert.strictEqual(isOrderNew(changed, 6000), false)
  assert.strictEqual(countNewOrders([changed, { createdAt: 7000, updatedAt: 7000 }], 6000), 1)
  assert.strictEqual(countNewOrders([changed], 9000), 0)
})

check('the orders index exists, or the page can only ever show a notice', () => {
  const indexes = JSON.parse(fs.readFileSync(path.join(__dirname, 'firestore.indexes.json'), 'utf8')).indexes
  const orders = indexes.find(i => i.collectionGroup === 'orders')
  assert.ok(orders, 'the orders collection-group index is missing')
  assert.strictEqual(orders.queryScope, 'COLLECTION_GROUP')
  const byField = Object.fromEntries(orders.fields.map(f => [f.fieldPath, f.order]))
  assert.strictEqual(byField.buyerUid, 'ASCENDING')
  assert.strictEqual(byField.createdAt, 'DESCENDING')
})

console.log('\n' + checks + ' order checks passed')
