/**
 * Dev-only harness for `src/bagCheckout.ts` and the persisted Hold-on state in `src/useBag.ts`.
 *
 *   npx tsc --ignoreConfig src/bagCheckout.ts --outDir _dsbuild --module commonjs --target es2020 --skipLibCheck
 *   Move-Item -Force _dsbuild/bagCheckout.js _dsbuild/bagCheckout.cjs
 *   node _bag_hold_check.cjs
 */
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const bag = require(path.join(__dirname, '_dsbuild', 'bagCheckout.cjs'))

let checks = 0
const check = (name, fn) => { fn(); checks++; console.log('  ok  ' + name) }

const items = [
  { productId: 'a', productName: 'Shirt', productPrice: '20,000', imageUrl: '', sellerId: 'shop-1', businessName: 'Shop One', quantity: 2, addedAt: 1 },
  { productId: 'b', productName: 'Shoes', productPrice: '50,000', imageUrl: '', sellerId: 'shop-1', businessName: 'Shop One', quantity: 1, addedAt: 2 },
  { productId: 'c', productName: 'Cap', productPrice: '15,000', imageUrl: '', sellerId: 'shop-2', businessName: 'Shop Two', quantity: 1, addedAt: 3 },
  { productId: 'd', productName: 'Held bag', productPrice: '30,000', imageUrl: '', sellerId: 'shop-2', businessName: 'Shop Two', quantity: 1, addedAt: 4, heldAt: 99 },
  { productId: 'e', productName: 'Gone', productPrice: '10,000', imageUrl: '', sellerId: 'shop-1', businessName: 'Shop One', quantity: 1, addedAt: 5 },
]

check('one payment per shop, and each shop’s total is the sum of its lines', () => {
  const summary = bag.groupBagForCheckout(items, { unavailable: { e: true } })
  assert.strictEqual(summary.shopCount, 2)
  assert.strictEqual(summary.groups[0].sellerId, 'shop-1')
  assert.strictEqual(summary.groups[0].total, 90000)
  assert.strictEqual(summary.groups[0].itemCount, 3)
  assert.strictEqual(summary.groups[1].total, 15000)
  assert.strictEqual(summary.readyTotal, 105000)
  assert.strictEqual(summary.readyCount, 4)
})

check('a held line is in the bag but never in a payment', () => {
  const summary = bag.groupBagForCheckout(items, { unavailable: { e: true } })
  assert.strictEqual(summary.heldCount, 1)
  assert.strictEqual(summary.heldTotal, 30000)
  assert.strictEqual(summary.unavailableCount, 1)
  assert.strictEqual(summary.groups.some(group => group.lines.some(line => line.productId === 'd')), false)
})

check('Buy Now on a held line can still include it, explicitly', () => {
  const summary = bag.groupBagForCheckout([items[3]], { includeHeld: true })
  assert.strictEqual(summary.heldCount, 0)
  assert.strictEqual(summary.readyTotal, 30000)
  assert.strictEqual(summary.groups[0].lines[0].held, true)
})

check('the label never promises one payment for several shops', () => {
  const one = bag.bagCheckoutLabel(bag.groupBagForCheckout([items[0]]))
  assert.strictEqual(one, '⚡ Pay & send order · UGX 40,000')
  const two = bag.bagCheckoutLabel(bag.groupBagForCheckout(items.slice(0, 3)))
  assert.ok(two.includes('Pay & send orders'))
  assert.ok(two.includes('UGX 105,000'))
  assert.strictEqual(bag.bagCheckoutLabel(bag.groupBagForCheckout([])), 'Nothing ready to pay')
})

check('Hold on is persisted on the bag line, not just in this render', () => {
  const source = fs.readFileSync(path.join(__dirname, 'src', 'useBag.ts'), 'utf8')
  assert.ok(source.includes('heldAt?: number'), 'the bag item has no held state')
  assert.ok(source.includes('setBagHold'), 'there is no hold writer')
  assert.ok(source.includes('holdBagItem'), 'there is no Hold on action')
  assert.ok(source.includes('resumeBagItem'), 'there is no Resume action')
  assert.ok(/updateDoc\(doc\(db, 'users', uid, 'bag', productId\), \{ heldAt \}\)/.test(source), 'hold is not written to Firestore')
})

console.log(`\n${checks} bag-hold checks passed`)
