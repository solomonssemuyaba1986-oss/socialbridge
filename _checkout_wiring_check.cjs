/**
 * Dev-only harness for the checkout's wiring. It reads source, because the mistake this guards
 * against is one no type checker catches — passing the human `RT-XXXXXX` where pawaPay needs the
 * Firestore document id, creating an order the seller can see before it is paid, or rendering a
 * bag total with no way to pay it.
 *
 *   node _checkout_wiring_check.cjs
 */
const assert = require('assert')
const fs = require('fs')
const path = require('path')

const read = file => fs.readFileSync(path.join(__dirname, file), 'utf8')
let checks = 0
const check = (name, fn) => { fn(); checks++; console.log('  ok  ' + name) }

const SURFACES = [
  'src/BrowsePage.tsx',
  'src/ProductActions.tsx',
  'src/StorePage.tsx',
  'src/ConversationPanel.tsx',
  'src/BagCheckoutSheet.tsx',
]

check('every purchase surface creates a hidden draft before it can pay', () => {
  for (const file of SURFACES) {
    const src = read(file)
    assert.ok(src.includes('createCheckoutOrder('), `${file} must create a checkout draft`)
    assert.ok(!src.includes('createOrderConversation('), `${file} must not tell the seller before payment`)
    assert.ok(!src.includes('incrementProductOrderCount('), `${file} must leave the counter to the server`)
  }
  const creator = read('src/createBuyerOrder.ts')
  assert.ok(creator.includes("checkoutState: 'paying'"), 'the draft state is missing')
  assert.ok(creator.includes('read: true'), 'the draft must be hidden from the seller badge')
})

check('the chat pays with the order document id, not the receipt reference', () => {
  const src = read('src/ConversationPanel.tsx')
  assert.ok(src.includes('setOrderDocIdForPay(orderDocRef.id)'), 'the document id is never captured')
  assert.ok(src.includes('orderDocId={orderDocIdForPay}'), 'PawapayCheckout is not given the document id')
  assert.ok(!/orderDocId=\{orderRef\}/.test(src), 'the human RT- reference must not be used as a document id')
  assert.ok(src.includes('Buy &amp; pay now'), 'the buyer has no in-chat pay button')
})

check('the bag total has a pay button and the same document-id rule', () => {
  const bag = read('src/BagPage.tsx')
  assert.ok(bag.includes('BagCheckoutSheet'), 'the bag has no grouped checkout sheet')
  assert.ok(bag.includes('onPaidLines={handlePaidLines}'), 'paid lines never leave the bag')
  assert.ok(bag.includes('bagCheckoutLabel(checkoutSummary)'), 'the total has no honest pay label')
  assert.ok(bag.includes('groupBagForCheckout('), 'the bag total is not grouped by shop')

  const sheet = read('src/BagCheckoutSheet.tsx')
  assert.ok(sheet.includes('orderDocId={draft.orderDocId}'), 'the bag payment is not given the document id')
  assert.ok(sheet.includes('onStageChange={setPayStage}'), 'closing the sheet could stop watching a live prompt')
  assert.ok(sheet.includes('items={draft.lines}'), 'the payment screen does not show the combined shop order')
})

check('an out-of-stock listing offers a real request, and the bubble can complete the purchase', () => {
  assert.ok(read('src/ProductCard.tsx').includes('🔔 Notify me if back'))
  assert.ok(read('src/BrowsePage.tsx').includes('🔔 Notify me if back'))
  assert.ok(read('src/StorePage.tsx').includes('🔔 Notify me if back'))
  assert.ok(read('src/ProductSheet.tsx').includes('🔔 Notify me when it is back'))
  assert.ok(read('src/ConversationPanel.tsx').includes('⚡ Buy now'))
  assert.ok(read('src/BrowsePage.tsx').includes('Please notify me when'))
  assert.ok(read('src/StorePage.tsx').includes('Please notify me when'))
})

check('the publisher is the server, and a draft is published exactly once', () => {
  const fn = read('functions/index.js')
  assert.ok(fn.includes('publishDraftOrder'), 'the server publish path is missing')
  assert.ok(fn.includes("checkoutState: 'published'"), 'publishing never changes the state')
  assert.ok(fn.includes('publishedAt'), 'publishing has no idempotency stamp')
  assert.ok(fn.includes('exports.publishCashOrder'), 'there is no pay-on-delivery publish path')
  assert.ok(fn.includes('cleanupAbandonedCheckouts'), 'abandoned drafts are never cleaned up')
  assert.ok(fn.includes('.paymentMethods'), 'the rail check does not read the seller’s real payment settings')
  assert.ok(!fn.includes('paymentPrefs'), 'the unused paymentPrefs field is still being read')
  const rules = read('firestore.rules')
  assert.ok(rules.includes("request.resource.data.checkoutState == 'paying'"), 'a browser can create a visible order')
  assert.ok(rules.includes("resource.data.checkoutState != 'paying'"), 'a seller can touch an unpaid draft')
})

console.log(`\n  ${checks} checkout-wiring checks passed\n`)
