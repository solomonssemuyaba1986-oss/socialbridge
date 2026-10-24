/**
 * Dev-only harness for `src/paymentPhone.ts` — the one place a buyer's number is normalised and
 * compared before money is asked for.
 *
 *   npx tsc --ignoreConfig src/paymentPhone.ts --outDir _dsbuild --module commonjs --target es2020 --skipLibCheck
 *   Move-Item -Force _dsbuild/paymentPhone.js _dsbuild/paymentPhone.cjs
 *   node _payment_phone_check.cjs
 */
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const phone = require(path.join(__dirname, '_dsbuild', 'paymentPhone.cjs'))

let checks = 0
const check = (name, fn) => { fn(); checks++; console.log('  ok  ' + name) }

check('the same wallet is the same number however it is typed', () => {
  assert.strictEqual(phone.normalizePhone('0771 234 567'), '256771234567')
  assert.strictEqual(phone.normalizePhone('+256 771 234 567'), '256771234567')
  assert.strictEqual(phone.normalizePhone('256771234567'), '256771234567')
  assert.strictEqual(phone.normalizePhone('771234567'), '256771234567')
  assert.strictEqual(phone.normalizePhone('0752 000 111', '+254'), '254752000111')
  assert.strictEqual(phone.normalizePhone(''), '')
})

check('two numbers only match on their normalised form', () => {
  assert.strictEqual(phone.phonesMatch('0771 234 567', '+256771234567'), true)
  assert.strictEqual(phone.phonesMatch('0771 234 567', '0771 234 568'), false)
  assert.strictEqual(phone.phonesMatch('', ''), false)
})

check('a verified number is named as verified; a typed one is not', () => {
  const verified = phone.comparePaymentPhone('0771 234 567', '+256771234567', '')
  assert.strictEqual(verified.valid, true)
  assert.strictEqual(verified.matchesVerified, true)
  assert.strictEqual(verified.matchesSaved, false)

  const changed = phone.comparePaymentPhone('0752 000 111', '+256771234567', '+256771234567')
  assert.strictEqual(changed.matchesVerified, false)
  assert.strictEqual(changed.changedFromVerified, true)
  assert.strictEqual(changed.changedFromSaved, true)
  assert.ok(phone.paymentPhoneHint(changed).includes('not your verified'))
})

check('the saved number is shown masked, never whole', () => {
  const masked = phone.maskPhone('+256771234567')
  assert.ok(masked.startsWith('+256771'))
  assert.ok(masked.endsWith('567'))
  assert.ok(masked.includes('*'))
  assert.ok(!masked.includes('234'))
  assert.strictEqual(phone.displayPhone('0771234567'), '+256 771 234 567')
})

check('junk in device storage is forgotten, not passed on', () => {
  assert.strictEqual(phone.parseDevicePaymentPhone('not json'), null)
  assert.strictEqual(phone.parseDevicePaymentPhone(JSON.stringify({ phone: '12' })), null)
  const good = phone.serializeDevicePaymentPhone('0771234567', 1234)
  assert.deepStrictEqual(phone.parseDevicePaymentPhone(good), { phone: '256771234567', at: 1234 })
})

check('the number is saved only after pawaPay accepted the prompt', () => {
  const sheet = fs.readFileSync(path.join(__dirname, 'src', 'PawapayCheckout.tsx'), 'utf8')
  const start = sheet.indexOf('startPawapayDeposit(')
  const remember = sheet.indexOf('remember(check.number)', start)
  assert.ok(start > 0, 'the payment screen never starts a deposit')
  assert.ok(remember > start, 'remember() must run after the deposit call, not while typing')
  const hook = fs.readFileSync(path.join(__dirname, 'src', 'usePaymentPhone.ts'), 'utf8')
  assert.ok(hook.includes('paymentPhone: normalized'), 'the account copy is never written')
  assert.ok(hook.includes('localStorage'), 'the device copy is never written')
})

console.log(`\n${checks} payment-phone checks passed`)
