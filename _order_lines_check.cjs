/**
 * Dev-only harness for `src/orderLines.ts` and `functions/orderDraft.js` — the shared reading of an
 * order, and the server's decision about which orders a seller can see.
 *
 *   npx tsc --ignoreConfig src/orderLines.ts --outDir _dsbuild --module commonjs --target es2020 --skipLibCheck
 *   Move-Item -Force _dsbuild/orderLines.js _dsbuild/orderLines.cjs
 *   node _order_lines_check.cjs
 */
const assert = require('assert')
const path = require('path')
const lines = require(path.join(__dirname, '_dsbuild', 'orderLines.cjs'))
const draft = require(path.join(__dirname, 'functions', 'orderDraft.js'))

let checks = 0
const check = (name, fn) => { fn(); checks++; console.log('  ok  ' + name) }

check('a legacy single-product order reads as one line', () => {
  const one = lines.orderLinesOf({ productId: 'p1', productName: 'Shirt', productPrice: '20,000', quantity: '2' })
  assert.strictEqual(one.length, 1)
  assert.strictEqual(one[0].quantity, 2)
  assert.strictEqual(lines.orderLinesTotal(one), 40000)
})

check('a combined shop order keeps productPrice × quantity equal to its lines', () => {
  const combined = lines.combineOrderLines([
    { productId: 'p1', productName: 'Shirt', productPrice: '20,000', quantity: 2 },
    { productId: 'p2', productName: 'Shoes', productPrice: '50,000', quantity: 1 },
  ])
  assert.strictEqual(combined.productPrice, '90000')
  assert.strictEqual(combined.quantity, '1')
  assert.strictEqual(combined.productName, 'Shirt + 1 more')
  assert.strictEqual(lines.orderLinesTotal(combined.items), 90000)
  assert.strictEqual(lines.orderLineWords(combined.items), '2 × Shirt · 1 × Shoes')
})

check('the server sees the same lines and the same sum', () => {
  const order = {
    items: [
      { productName: 'Shirt', productPrice: '20,000', quantity: 2, color: 'Black' },
      { productName: 'Shoes', productPrice: '50,000', quantity: 1, size: '42' },
    ],
  }
  const serverLines = draft.itemsOf(order)
  assert.strictEqual(serverLines.length, 2)
  assert.strictEqual(draft.lineWords(serverLines), '2 × Shirt · 1 × Shoes')
  assert.strictEqual(draft.variantWords(serverLines[0]), 'Black')
  assert.ok(draft.orderBubbleText(order, 'RT-ABC123').includes('3 items'))
})

check('a paying draft is invisible; published and legacy orders are visible', () => {
  assert.strictEqual(lines.isPublishedOrder({ checkoutState: 'paying' }), false)
  assert.strictEqual(lines.isPublishedOrder({ checkoutState: 'abandoned' }), false)
  assert.strictEqual(lines.isPublishedOrder({ checkoutState: 'published' }), true)
  assert.strictEqual(lines.isPublishedOrder({}), true)
  assert.strictEqual(draft.isPublishedOrder({ checkoutState: 'paying' }), false)
  assert.strictEqual(draft.isPublishedOrder({ checkoutState: 'published' }), true)
})

console.log(`\n${checks} order-line checks passed`)
