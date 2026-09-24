/**
 * Dev-only harness for the Pesapal wiring — everything that can be proved without a key.
 *
 *   npx tsc --ignoreConfig src/pesapalUtils.ts --outDir _dsbuild --module commonjs --target es2020 --skipLibCheck
 *   Move-Item -Force _dsbuild/pesapalUtils.js _dsbuild/pesapalUtils.cjs   # package.json is "type": "module"
 *   node _pesapal_check.cjs
 *
 * `functions/pesapal.js` and `functions/orderAmount.js` are CommonJS already, so they are required
 * straight from here. What this pins down is the money: the reference Pesapal will accept, the
 * amount it gets asked for, the payloads an IPN may arrive in, and what each status code means.
 * The client keeps its own copy of two of those rules (a page must be able to format a total and
 * judge a link without talking to Firebase), and the checks below assert the two copies agree.
 */
const assert = require('assert')
const path = require('path')

const pesapal = require(path.join(__dirname, 'functions', 'pesapal.js'))
const orderAmount = require(path.join(__dirname, 'functions', 'orderAmount.js'))
const client = require(path.join(__dirname, '_dsbuild', 'pesapalUtils.cjs'))

let checks = 0
const check = (name, fn) => { fn(); checks++; console.log('  ok  ' + name) }
const laterChecks = []
const acheck = (name, fn) => laterChecks.push({ name, fn })

check('a reference Pesapal accepts, and the ones it refuses', () => {
  assert.strictEqual(pesapal.isMerchantReference('RT-M7XK4Q-9F3A'), true)
  assert.strictEqual(pesapal.isMerchantReference('order-1_a.b:c'), true)
  assert.strictEqual(pesapal.isMerchantReference(' '), false)
  assert.strictEqual(pesapal.isMerchantReference(''), false)
  assert.strictEqual(pesapal.isMerchantReference(null), false)
  assert.strictEqual(pesapal.isMerchantReference(42), false)
  assert.strictEqual(pesapal.isMerchantReference('RT 123'), false)
  for (const bad of ['@', '#', '$', '%', '&', '/', '\\', '?', '=']) {
    assert.strictEqual(pesapal.isMerchantReference(`RT${bad}1`), false, `"${bad}" must be refused`)
  }
  assert.strictEqual(pesapal.isMerchantReference('A'.repeat(50)), true)
  assert.strictEqual(pesapal.isMerchantReference('A'.repeat(51)), false)
})

check('a messy reference is cleaned rather than sent as-is', () => {
  assert.strictEqual(pesapal.toMerchantReference('order @ 5/2'), 'order-5-2')
  assert.strictEqual(pesapal.toMerchantReference('  RT-1  '), 'RT-1')
  assert.strictEqual(pesapal.toMerchantReference('A'.repeat(80)).length, 50)
  assert.strictEqual(pesapal.toMerchantReference(null), '')
  assert.strictEqual(pesapal.isMerchantReference(pesapal.toMerchantReference('order @ 5/2')), true)
})

check('every payment attempt gets its own reference, and it is always valid', () => {
  const seen = new Set()
  for (let i = 0; i < 200; i++) {
    const reference = pesapal.buildPaymentReference()
    assert.ok(reference.startsWith('RT-'), reference)
    assert.ok(pesapal.isMerchantReference(reference), reference)
    seen.add(reference)
  }
  assert.strictEqual(seen.size, 200)
})

check('UGX is whole shillings — never a float with tails', () => {
  assert.strictEqual(pesapal.toPesapalAmount(45000, 'UGX'), 45000)
  assert.strictEqual(pesapal.toPesapalAmount(45000.00000000001, 'UGX'), 45000)
  assert.strictEqual(pesapal.toPesapalAmount(45.4, 'UGX'), 45)
  assert.strictEqual(pesapal.toPesapalAmount(45000, 'ugx'), 45000)
  assert.strictEqual(pesapal.toPesapalAmount('45000', 'UGX'), 45000)
  assert.strictEqual(pesapal.toPesapalAmount(45000.5, 'USD'), 45000.5)
  assert.strictEqual(pesapal.toPesapalAmount(45.999, 'USD'), 46)
  assert.strictEqual(pesapal.toPesapalAmount(0, 'UGX'), null)
  assert.strictEqual(pesapal.toPesapalAmount(-5, 'UGX'), null)
  assert.strictEqual(pesapal.toPesapalAmount('not a price', 'UGX'), null)
  assert.strictEqual(pesapal.toPesapalAmount(undefined, 'UGX'), null)
})

check('the amount charged comes from the order document, not from a browser', () => {
  assert.deepStrictEqual(
    orderAmount.orderTotal({ productPrice: '45,000 UGX', quantity: '2' }),
    { unit: 45000, quantity: 2, total: 90000 }
  )
  assert.deepStrictEqual(
    orderAmount.orderTotal({ productPrice: '45000', quantity: '1' }),
    { unit: 45000, quantity: 1, total: 45000 }
  )
  assert.deepStrictEqual(
    orderAmount.orderTotal({ productPrice: 45000, quantity: 3 }),
    { unit: 45000, quantity: 3, total: 135000 }
  )
  // quantity is a string in the document; the details sheet caps it, so this must too
  assert.strictEqual(orderAmount.orderTotal({ productPrice: '1000', quantity: '0' }).quantity, 1)
  assert.strictEqual(orderAmount.orderTotal({ productPrice: '1000', quantity: '400' }).quantity, 99)
  assert.strictEqual(orderAmount.orderTotal({ productPrice: '1000' }).quantity, 1)
  assert.strictEqual(orderAmount.orderTotal({ productPrice: '1000', quantity: '' }).total, 1000)
})

check('an order with a price we cannot read is refused, never guessed at', () => {
  assert.strictEqual(orderAmount.orderTotal({ productPrice: 'free', quantity: '1' }), null)
  assert.strictEqual(orderAmount.orderTotal({ productPrice: '0', quantity: '1' }), null)
  // The app's own `parsePrice` drops anything that is not a digit or a dot, so "-500" reads as 500.
  // Mirrored on purpose, and pinned here so the two readings can never drift apart.
  assert.strictEqual(orderAmount.parseOrderPrice('-500'), 500)
  assert.strictEqual(orderAmount.orderTotal({ productPrice: '-500', quantity: '1' }).total, 500)
  assert.strictEqual(orderAmount.orderTotal({}), null)
  assert.strictEqual(orderAmount.orderTotal(null), null)
  assert.strictEqual(orderAmount.parseOrderPrice('UGX 45,000'), 45000)
  assert.strictEqual(orderAmount.parseOrderPrice('  '), null)
})

check('an IPN is read in both shapes Pesapal may send it in', () => {
  assert.deepStrictEqual(
    pesapal.parseIpnParams({
      OrderTrackingId: 'abc-1',
      OrderMerchantReference: 'RT-1',
      OrderNotificationType: 'IPNCHANGE',
    }),
    { orderTrackingId: 'abc-1', merchantReference: 'RT-1', notificationType: 'IPNCHANGE' }
  )
  assert.deepStrictEqual(
    pesapal.parseIpnParams({
      OrderNotificationType: 'IPNCHANGE',
      OrderTrackingId: 'abc-2',
      OrderMerchantReference: 'RT-2',
    }),
    { orderTrackingId: 'abc-2', merchantReference: 'RT-2', notificationType: 'IPNCHANGE' }
  )
  assert.deepStrictEqual(
    pesapal.parseIpnParams({ orderTrackingId: ' abc-3 ', orderMerchantReference: ' RT-3 ' }),
    { orderTrackingId: 'abc-3', merchantReference: 'RT-3', notificationType: 'IPNCHANGE' }
  )
  assert.throws(() => pesapal.parseIpnParams({ OrderMerchantReference: 'RT-1' }), /OrderTrackingId/)
  assert.throws(() => pesapal.parseIpnParams({ OrderTrackingId: 'abc' }), /OrderMerchantReference/)
  assert.throws(() => pesapal.parseIpnParams(null), /OrderTrackingId/)
})

check('every status code Pesapal documents means what we think it means', () => {
  assert.deepStrictEqual(
    pesapal.mapPesapalStatus({ status_code: 1, payment_status_description: 'Completed' }),
    { status: 'completed', orderStatus: 'paid', paid: true, code: 1, description: 'Completed' }
  )
  assert.strictEqual(pesapal.mapPesapalStatus({ status_code: 0 }).status, 'invalid')
  assert.strictEqual(pesapal.mapPesapalStatus({ status_code: 2 }).status, 'failed')
  assert.strictEqual(pesapal.mapPesapalStatus({ status_code: 3 }).status, 'reversed')
  assert.strictEqual(pesapal.mapPesapalStatus({ status_code: '1' }).paid, true)
  assert.strictEqual(pesapal.mapPesapalStatus({ status_code: 99 }).paid, false)
  assert.strictEqual(pesapal.mapPesapalStatus({ status_code: 99 }).status, 'unknown')
  assert.strictEqual(pesapal.mapPesapalStatus({}).paid, false)
  assert.strictEqual(pesapal.mapPesapalStatus(null).paid, false)
  // prose that *says* completed, with no code, is not a payment
  assert.strictEqual(pesapal.mapPesapalStatus({ payment_status_description: 'Completed' }).paid, false)
})

check('a completed payment for the wrong amount is not this order being paid', () => {
  assert.strictEqual(
    pesapal.amountMatches({ amount: 45000, currency: 'UGX' }, { amount: 45000, currency: 'UGX' }),
    true
  )
  assert.strictEqual(
    pesapal.amountMatches({ amount: 45000, currency: 'UGX' }, { amount: '45000', currency: 'ugx' }),
    true
  )
  assert.strictEqual(
    pesapal.amountMatches({ amount: 45000, currency: 'UGX' }, { amount: 4500, currency: 'UGX' }),
    false
  )
  assert.strictEqual(
    pesapal.amountMatches({ amount: 45000, currency: 'UGX' }, { amount: 45000, currency: 'KES' }),
    false
  )
  assert.strictEqual(
    pesapal.amountMatches({ amount: 45000, currency: 'UGX' }, { amount: 45000 }),
    false
  )
  assert.strictEqual(
    pesapal.amountMatches({ amount: 45000 }, { amount: 45000, currency: 'UGX' }),
    false
  )
  assert.strictEqual(pesapal.amountMatches(null, null), false)
})

check('the IPN reply is the exact JSON Pesapal documents', () => {
  assert.strictEqual(
    pesapal.ipnResponse({ orderTrackingId: 'd0fa69d6', merchantReference: 'RT-1', ok: true }),
    '{"orderNotificationType":"IPNCHANGE","orderTrackingId":"d0fa69d6","orderMerchantReference":"RT-1","status":200}'
  )
  assert.strictEqual(
    pesapal.ipnResponse({ orderTrackingId: 'd0fa69d6', merchantReference: 'RT-1', ok: false }),
    '{"orderNotificationType":"IPNCHANGE","orderTrackingId":"d0fa69d6","orderMerchantReference":"RT-1","status":500}'
  )
  // even an IPN we could not read answers with all four keys — never a bare body
  assert.strictEqual(
    pesapal.ipnResponse({ ok: false }),
    '{"orderNotificationType":"IPNCHANGE","orderTrackingId":"","orderMerchantReference":"","status":500}'
  )
})

check("Pesapal's own wording is what a person ends up reading", () => {
  assert.strictEqual(pesapal.describePesapalError({ error: { message: 'Invalid credentials' } }), 'Invalid credentials')
  assert.strictEqual(pesapal.describePesapalError({ error: { description: 'Amount too small' } }), 'Amount too small')
  assert.strictEqual(pesapal.describePesapalError({ message: 'Request processed' }), 'Request processed')
  assert.ok(pesapal.describePesapalError(null).includes('Pesapal'))
  assert.ok(pesapal.describePesapalError({ error: { message: '   ' } }).includes('Pesapal'))
})

check('live is the default — the sandbox is a deliberate choice', () => {
  assert.strictEqual(pesapal.baseUrl('live'), 'https://pay.pesapal.com/v3')
  assert.strictEqual(pesapal.baseUrl('sandbox'), 'https://cybqa.pesapal.com/pesapalv3')
  assert.strictEqual(pesapal.baseUrl(), 'https://pay.pesapal.com/v3')
  assert.strictEqual(pesapal.baseUrl('anything-else'), 'https://pay.pesapal.com/v3')
})

check('the keys are only ever checked, never printed', () => {
  assert.strictEqual(pesapal.isConfigured({ consumerKey: 'k', consumerSecret: 's' }), true)
  assert.strictEqual(pesapal.isConfigured({ consumerKey: 'k' }), false)
  assert.strictEqual(pesapal.isConfigured({ consumerKey: '', consumerSecret: '' }), false)
  assert.strictEqual(pesapal.isConfigured(null), false)
})

check('the page and the server refuse exactly the same references', () => {
  const candidates = [
    'RT-1', 'order_1.a:b', '', ' ', 'RT 1', 'A@B', 'A#B', 'A/B', 'A\\B', 'A?B', 'A=B',
    'A'.repeat(50), 'A'.repeat(51), null, undefined, 42,
  ]
  for (const value of candidates) {
    assert.strictEqual(
      client.isMerchantReference(value),
      pesapal.isMerchantReference(value),
      `the page and the server disagree about ${JSON.stringify(value)}`
    )
  }
  assert.strictEqual(client.toMerchantReference('order @ 5/2'), pesapal.toMerchantReference('order @ 5/2'))
})

check('the page and the server charge exactly the same amount', () => {
  const cases = [
    [45000, 'UGX'], [45000.00000000001, 'UGX'], [45.4, 'UGX'], [45.999, 'USD'],
    [45000.5, 'USD'], [0, 'UGX'], [-1, 'UGX'], ['45000', 'UGX'], [undefined, 'UGX'],
    [45000, undefined], [45000, 'ugx'], ['not a price', 'UGX'],
  ]
  for (const [amount, currency] of cases) {
    assert.strictEqual(
      client.toPesapalAmount(amount, currency),
      pesapal.toPesapalAmount(amount, currency),
      `the page and the server disagree about ${amount} ${currency}`
    )
  }
  assert.strictEqual(client.formatPesapalAmount(45000, 'UGX'), '45,000')
  assert.strictEqual(client.formatPesapalAmount(0, 'UGX'), '')
  assert.strictEqual(client.formatPesapalAmount('nonsense', 'UGX'), '')
})

check('a payment link is only followed when it really is Pesapal', () => {
  assert.strictEqual(client.isPesapalRedirectUrl('https://pay.pesapal.com/v3/checkout/abc'), true)
  assert.strictEqual(
    client.isPesapalRedirectUrl('https://cybqa.pesapal.com/pesapaliframe/Index/?OrderTrackingId=1'),
    true
  )
  assert.strictEqual(client.isPesapalRedirectUrl('https://pesapal.com/pay'), true)
  assert.strictEqual(client.isPesapalRedirectUrl('http://pay.pesapal.com/v3'), false)
  assert.strictEqual(client.isPesapalRedirectUrl('https://pesapal.com.evil.example/pay'), false)
  assert.strictEqual(client.isPesapalRedirectUrl('https://evil.example/pesapal.com'), false)
  assert.strictEqual(client.isPesapalRedirectUrl('javascript:alert(1)'), false)
  assert.strictEqual(client.isPesapalRedirectUrl(''), false)
  assert.strictEqual(client.isPesapalRedirectUrl(null), false)
  assert.strictEqual(client.isPesapalRedirectUrl(undefined), false)
})

check('a payment method reads like a payment method', () => {
  assert.strictEqual(client.paymentMethodLabel('MTN'), 'MTN MoMo')
  assert.strictEqual(client.paymentMethodLabel('MPESA'), 'M-Pesa')
  assert.strictEqual(client.paymentMethodLabel('Visa'), 'Card')
  assert.strictEqual(client.paymentMethodLabel('Mastercard'), 'Card')
  assert.strictEqual(client.paymentMethodLabel('Airtel Money'), 'Airtel Money')
  assert.strictEqual(client.paymentMethodLabel('TIGO'), 'Tigo Pesa')
  assert.strictEqual(client.paymentMethodLabel(''), 'Pesapal')
  assert.strictEqual(client.paymentMethodLabel(null), 'Pesapal')
  assert.strictEqual(client.paymentMethodLabel('Some New Method'), 'Some New Method')
})

check('no status ever reaches a buyer as a code or a jargon word', () => {
  const statuses = ['initiated', 'completed', 'failed', 'invalid', 'reversed', 'review', 'unknown',
    'none', 'COMPLETED', undefined, null, 'what']
  for (const status of statuses) {
    const label = client.pesapalStatusLabel(status)
    assert.ok(label.length > 0, `no words for ${status}`)
    assert.strictEqual(label.includes('_'), false, label)
    assert.strictEqual(label.includes('description'), false, label)
  }
  assert.strictEqual(client.pesapalStatusLabel('completed'), 'Paid')
  assert.strictEqual(client.pesapalStatusLabel('failed'), 'Payment failed')
  assert.strictEqual(client.pesapalStatusLabel(undefined), 'No payment yet')
})

check('the URL a buyer returns on identifies the payment and claims nothing else', () => {
  const returned = client.paymentReturnFromQuery({
    OrderTrackingId: 'b945e4af',
    OrderMerchantReference: 'RT-1',
    OrderNotificationType: 'CALLBACKURL',
  })
  assert.strictEqual(returned.orderTrackingId, 'b945e4af')
  assert.strictEqual(returned.reference, 'RT-1')
  assert.strictEqual(returned.cancelled, false)
  assert.strictEqual(client.paymentReturnFromQuery({ OrderTrackingId: ['abc'] }).orderTrackingId, 'abc')
  assert.strictEqual(client.paymentReturnFromQuery({ cancelled: '1' }).cancelled, true)
  assert.strictEqual(client.paymentReturnFromQuery({}).orderTrackingId, '')
  assert.strictEqual(client.paymentReturnFromQuery(null).reference, '')

  // Even a URL that *claims* success proves nothing: there is no payment status in here at all.
  const lying = client.paymentReturnFromQuery({ OrderTrackingId: 'abc', status: 'completed' })
  assert.strictEqual('paid' in lying, false)
  assert.deepStrictEqual(Object.keys(lying).sort(), ['cancelled', 'orderTrackingId', 'reference'])
})

check('until the keys are set, everyone is told the same thing', () => {
  assert.strictEqual(client.PAYMENT_NOT_CONFIGURED_MESSAGE, 'Payment is not configured yet. Contact support.')
  const notSet = { code: 'functions/failed-precondition', message: 'Payment is not configured yet. Contact support.' }
  assert.strictEqual(client.isPaymentNotConfiguredError(notSet), true)
  assert.strictEqual(client.isPaymentNotConfiguredError({ ...notSet, code: 'failed-precondition' }), true)
  assert.strictEqual(
    client.isPaymentNotConfiguredError({ code: 'failed-precondition', message: 'This order is already paid.' }),
    false
  )
  assert.strictEqual(client.isPaymentNotConfiguredError({ code: 'internal' }), false)
  assert.strictEqual(client.isPaymentNotConfiguredError(null), false)

  assert.strictEqual(client.paymentErrorMessage(notSet), client.PAYMENT_NOT_CONFIGURED_MESSAGE)
  assert.strictEqual(
    client.paymentErrorMessage({ code: 'functions/unauthenticated', message: 'Firebase: Sign in.' }),
    'Sign in to pay for this order.'
  )
  assert.strictEqual(
    client.paymentErrorMessage({ code: 'functions/not-found', message: 'Firebase: nope.' }),
    'We could not find that order.'
  )
  assert.strictEqual(
    client.paymentErrorMessage({ code: 'functions/failed-precondition', message: 'This order is already paid.' }),
    'This order is already paid.'
  )
  assert.strictEqual(client.paymentErrorMessage({ message: 'Firebase: internal error' }), 'internal error')
  assert.ok(client.paymentErrorMessage(null).length > 0)
  assert.strictEqual(client.paymentErrorMessage({ message: 'Firebase: internal error' }).startsWith('Firebase'), false)
})

check('UGX is what this market pays in, and it is found from the country', () => {
  assert.strictEqual(client.DEFAULT_PESAPAL_CURRENCY, 'UGX')
  assert.deepStrictEqual(client.currencyFromCountry('UG'), { code: 'UGX', symbol: 'USh' })
  assert.deepStrictEqual(client.currencyFromCountry('ug'), { code: 'UGX', symbol: 'USh' })
  assert.deepStrictEqual(client.currencyFromCountry('KE'), { code: 'KES', symbol: 'KSh' })
  assert.strictEqual(client.currencyFromCountry('XX'), null)
  assert.strictEqual(client.pesapalBaseUrl('live'), 'https://pay.pesapal.com/v3')
  assert.strictEqual(client.pesapalBaseUrl('sandbox'), 'https://cybqa.pesapal.com/pesapalv3')
  assert.strictEqual(client.pesapalBaseUrl(), 'https://pay.pesapal.com/v3')
})

acheck('no keys means no request is ever made', async () => {
  await assert.rejects(pesapal.getToken({}), /not configured/)
  await assert.rejects(pesapal.getToken(null), /not configured/)
})

acheck('a payment is refused before anything is sent to Pesapal', async () => {
  const creds = { consumerKey: 'k', consumerSecret: 's', env: 'live' }
  await assert.rejects(pesapal.submitOrder({ ...creds, id: 'bad id', amount: 100 }), /reference/)
  await assert.rejects(
    pesapal.submitOrder({ ...creds, id: 'RT-1', amount: 0, currency: 'UGX' }),
    /no amount/
  )
  await assert.rejects(
    pesapal.submitOrder({ ...creds, id: 'RT-1', amount: 100, currency: '' }),
    /no currency/
  )
  await assert.rejects(
    pesapal.submitOrder({ ...creds, id: 'RT-1', amount: 100, currency: 'UGX' }),
    /no return link/
  )
  await assert.rejects(
    pesapal.submitOrder({ ...creds, id: 'RT-1', amount: 100, currency: 'UGX', callbackUrl: 'https://x.test/pay' }),
    /not finished being set up/
  )
  await assert.rejects(pesapal.getTransactionStatus({ ...creds, orderTrackingId: '' }), /tracking id/)
  await assert.rejects(pesapal.registerIpn({ ...creds, url: 'http://insecure.test/ipn' }), /https/)
})

;(async () => {
  for (const { name, fn } of laterChecks) {
    await fn()
    checks++
    console.log('  ok  ' + name)
  }
  console.log('\n' + checks + ' pesapal checks passed')
})().catch((err) => {
  console.error('\n  FAILED: ' + ((err && err.message) || err))
  process.exitCode = 1
})
