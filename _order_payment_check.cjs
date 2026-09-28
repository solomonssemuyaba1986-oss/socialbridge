/**
 * Dev-only harness for the money an order carries (`src/orderPayment.ts`).
 *
 *   npx tsc --ignoreConfig src/orderPayment.ts --outDir _dsbuild --module commonjs --target es2020 --skipLibCheck
 *   Move-Item -Force _dsbuild/orderPayment.js _dsbuild/orderPayment.cjs   # package.json is "type": "module"
 *   node _order_payment_check.cjs
 *
 * This exists because of one bug, seen from the seller's side: both payment flows write what
 * happened to the money onto the order, and the seller's screen read none of it — so a buyer who had
 * really paid still saw the word "Pending". The rules below are the ones that were wrong: what
 * "paid" means, that a payment on its way is not a payment that arrived, and that a rail id must
 * never reach a person.
 */
const assert = require('assert')
const path = require('path')

const {
  orderPaymentState,
  methodWords,
  paymentMoney,
  paymentWhen,
  paymentSummary,
  paymentBadge,
  paidCount,
} = require(path.join(__dirname, '_dsbuild', 'orderPayment.cjs'))

let checks = 0
const check = (name, fn) => { fn(); checks++; console.log('  ok  ' + name) }

/** What a settled MTN deposit leaves on an order (`functions/index.js:749-763`). */
const settled = (extra) => ({
  status: 'paid',
  paymentStatus: 'completed',
  paymentMethod: 'MTN_MOMO_UGA',
  paymentAmount: 45000,
  paymentCurrency: 'UGX',
  paidAt: { toDate: () => new Date('2026-02-14T14:14:00Z') },
  ...extra,
})

check('a settled deposit is paid, and a paid order is never "Pending"', () => {
  assert.strictEqual(orderPaymentState(settled()), 'paid')
  assert.strictEqual(orderPaymentState(settled({ status: 'fulfilled' })), 'paid')
  // The server's word alone is enough: the order status is not always patched in the same write.
  assert.strictEqual(orderPaymentState({ paymentStatus: 'completed' }), 'paid')
  const badge = paymentBadge(settled())
  assert.strictEqual(badge.tone, 'paid')
  assert.ok(badge.text.toLowerCase().includes('paid'), badge.text)
  assert.strictEqual(badge.text.includes('_'), false, badge.text)
})

check('a payment on its way is not a payment that arrived', () => {
  const onItsWay = {
    status: 'awaiting_payment',
    paymentStatus: 'initiated',
    paymentAmount: 45000,
    paymentCurrency: 'UGX',
  }
  assert.strictEqual(orderPaymentState(onItsWay), 'waiting')
  assert.strictEqual(paymentSummary(onItsWay), '', 'no money is claimed before it lands')
  assert.strictEqual(paymentBadge(onItsWay).tone, 'waiting')
  // pawaPay's own words for UNKNOWN_ERROR: "check the status before considering it failed".
  assert.strictEqual(orderPaymentState({ status: 'pending', paymentStatus: 'unknown' }), 'waiting')
  assert.strictEqual(orderPaymentState({ status: 'pending', paymentStatus: 'pending' }), 'waiting')
  // An order nobody has tried to pay has nothing to say about money at all.
  assert.strictEqual(orderPaymentState({ status: 'pending' }), 'none')
  assert.strictEqual(paymentBadge({ status: 'pending' }), null)
  assert.strictEqual(orderPaymentState(null), 'none')
  assert.strictEqual(orderPaymentState(undefined), 'none')
  assert.strictEqual(orderPaymentState({}), 'none')
})

check('a rail id becomes words, and is never printed raw', () => {
  assert.strictEqual(methodWords('MTN_MOMO_UGA'), 'MTN MoMo')
  assert.strictEqual(methodWords('mtn_momo_uga'), 'MTN MoMo')
  assert.strictEqual(methodWords('AIRTEL_OAPI_UGA'), 'Airtel Money')
  assert.strictEqual(methodWords('Pesapal'), 'Pesapal')
  assert.strictEqual(methodWords('VISA'), 'Card')
  // One we do not recognise says nothing rather than putting an id in front of a person.
  assert.strictEqual(methodWords('SOMETHING_NEW_GHA'), '')
  assert.strictEqual(methodWords(''), '')
  assert.strictEqual(methodWords(undefined), '')
  for (const rail of ['MTN_MOMO_UGA', 'AIRTEL_OAPI_UGA', 'SOMETHING_NEW_GHA', '']) {
    assert.strictEqual(methodWords(rail).includes('_'), false, rail + ' leaked its id')
  }
})

check('the line a seller reads is money, a rail and a time — or nothing', () => {
  const line = paymentSummary(settled())
  assert.ok(line.startsWith('Paid UGX 45,000'), line)
  assert.ok(line.includes('MTN MoMo'), line)
  assert.ok(line.includes(' · '), 'the parts stay apart, so the line is readable')
  // An amount we do not have is never rendered as undefined or NaN.
  const noAmount = paymentSummary(settled({ paymentAmount: undefined, paymentCurrency: undefined }))
  assert.strictEqual(noAmount.includes('undefined'), false, noAmount)
  assert.strictEqual(noAmount.includes('NaN'), false, noAmount)
  assert.ok(noAmount.startsWith('Paid'), noAmount)
  // The currency comes off the order, not out of the air.
  assert.ok(paymentMoney({ paymentAmount: 1000, paymentCurrency: 'KES' }).startsWith('KES '))
  assert.strictEqual(paymentMoney({ paymentAmount: 45000 }), 'UGX 45,000')
  assert.strictEqual(paymentMoney({ paymentAmount: 0 }), '')
  assert.strictEqual(paymentMoney({ paymentAmount: 'free' }), '')
  assert.strictEqual(paymentMoney(null), '')
  // A missing or unreadable timestamp is silence, never "Invalid Date".
  assert.strictEqual(paymentWhen({}), '')
  assert.strictEqual(paymentWhen({ paidAt: { toDate: () => new Date('nonsense') } }), '')
  assert.strictEqual(paymentWhen({ paidAt: 'yesterday' }), '')
  assert.ok(paymentWhen(settled()).length > 0)
})

check('the number a seller actually wants is how many are already paid', () => {
  const orders = [
    settled(),
    { status: 'pending' },
    { status: 'awaiting_payment', paymentStatus: 'initiated' },
    settled({ status: 'fulfilled' }),
  ]
  assert.strictEqual(paidCount(orders), 2)
  assert.strictEqual(paidCount([]), 0)
  assert.strictEqual(paidCount(null), 0)
  assert.strictEqual(paidCount([null, undefined, {}]), 0)
})

check('a payment that failed says so, and never claims an amount', () => {
  assert.strictEqual(orderPaymentState({ status: 'pending', paymentStatus: 'failed' }), 'failed')
  assert.strictEqual(orderPaymentState({ status: 'pending', paymentStatus: 'rejected' }), 'failed')
  assert.strictEqual(paymentBadge({ status: 'pending', paymentStatus: 'failed' }).tone, 'failed')
  assert.strictEqual(paymentSummary({ status: 'pending', paymentStatus: 'failed' }), '')
  // The server's newest word wins over the order's older status — the two are written together.
  assert.strictEqual(orderPaymentState({ status: 'paid', paymentStatus: 'failed' }), 'failed')
})

console.log('\n' + checks + ' order-payment checks passed')
