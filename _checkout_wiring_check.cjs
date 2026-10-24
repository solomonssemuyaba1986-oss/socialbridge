/**
 * Dev-only harness for the two new ways money can leave a page: **inside the chat** and **from the
 * bag's total**. It reads source, because the mistake these guard against is a wiring mistake no
 * type checker catches — passing the human `RT-XXXXXX` reference where pawaPay needs the Firestore
 * document id, or rendering a total with no way to pay it.
 *
 *   node _checkout_wiring_check.cjs
 */
const assert = require('assert')
const fs = require('fs')
const path = require('path')

const read = file => fs.readFileSync(path.join(__dirname, file), 'utf8')
let checks = 0
const check = (name, fn) => { fn(); checks++; console.log('  ok  ' + name) }

check('the chat pays with the order document id, not the receipt reference', () => {
  const src = read('src/ConversationPanel.tsx')
  assert.ok(src.includes('setOrderDocIdForPay(orderDocRef.id)'), 'the document id is never captured')
  assert.ok(src.includes('orderDocId={orderDocIdForPay}'), 'PawapayCheckout is not given the document id')
  assert.ok(!/orderDocId=\{orderRef\}/.test(src), 'the human RT- reference must not be used as a document id')
  assert.ok(src.includes('Buy &amp; pay now'), 'the buyer has no in-chat pay button')
})

check('the bag total has a pay button and the same document-id rule', () => {
  const src = read('src/BagPage.tsx')
  assert.ok(src.includes('⚡ Pay now — UGX'), 'the total block has no pay button')
  assert.ok(src.includes('setOrderDocId(orderDocRef.id)'), 'the bag never captures the order document id')
  assert.ok(src.includes('orderDocId={orderDocId}'), 'the bag checkout is not given the document id')
  assert.ok(src.includes('onStageChange={setPayStage}'), 'closing the bag sheet could stop watching a live prompt')
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

console.log(`\n  ${checks} checkout-wiring checks passed\n`)
