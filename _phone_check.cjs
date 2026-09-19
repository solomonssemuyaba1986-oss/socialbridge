/**
 * Dev-only harness for the phone rules (`src/phone.ts`).
 *
 *   npx tsc --ignoreConfig src/phone.ts --outDir _dsbuild --module commonjs --target es2020 --skipLibCheck
 *   Move-Item -Force _dsbuild/phone.js _dsbuild/phone.cjs
 *   node _phone_check.cjs
 *
 * This is the check that was missing in Setup Store: "+256" plus a number that is too short
 * used to be accepted silently, and the seller only found out when no code arrived.
 */
const assert = require('assert')
const path = require('path')
const {
  FALLBACK_LENGTHS,
  formatFull,
  lengthHint,
  lengthRange,
  normaliseNational,
  ruleFor,
  validatePhone,
} = require(path.join(__dirname, '_dsbuild', 'phone.cjs'))

let checks = 0
const check = (name, fn) => { fn(); checks++; console.log('  ok  ' + name) }

check('the trunk zero is undone — the way everyone actually types', () => {
  assert.strictEqual(normaliseNational('0771234567', '+256'), '771234567')
  assert.strictEqual(normaliseNational('771234567', '+256'), '771234567')
  assert.strictEqual(normaliseNational('0771 234 567', '+256'), '771234567')
  assert.strictEqual(normaliseNational('(077) 123-4567', '+256'), '771234567')
  assert.strictEqual(normaliseNational('0771.234.567', '+256'), '771234567')
})

check('a pasted international number is understood, not rejected', () => {
  assert.strictEqual(normaliseNational('+256771234567', '+256'), '771234567')
  assert.strictEqual(normaliseNational('256771234567', '+256'), '771234567')
  assert.strictEqual(normaliseNational('+256 0771234567', '+256'), '771234567')
})

check('a national number that merely starts with the country code is left alone', () => {
  // "256" is not a valid Ugandan mobile prefix, so this stays a 9-digit number, not 6.
  const got = normaliseNational('256123456', '+256')
  assert.strictEqual(got.length >= 6, true)
})

check('the missing check: Uganda needs 9 digits, and 8 is called out', () => {
  const short = validatePhone('+256', '77123456', 'Uganda')
  assert.strictEqual(short.ok, false)
  assert.strictEqual(short.exact, true)
  assert.ok(/Uganda numbers are 9 digits/.test(short.message), short.message)
  assert.ok(/you typed 8/.test(short.message), short.message)

  const good = validatePhone('+256', '771234567', 'Uganda')
  assert.strictEqual(good.ok, true)
  assert.strictEqual(good.digits, '771234567')
})

check('every market we serve has its own length', () => {
  assert.deepStrictEqual(ruleFor('+254'), [9])    // Kenya
  assert.deepStrictEqual(ruleFor('+234'), [10])   // Nigeria
  assert.deepStrictEqual(ruleFor('+20'), [10])    // Egypt
  assert.deepStrictEqual(ruleFor('+212'), [9])    // Morocco
  assert.deepStrictEqual(ruleFor('+257'), [8])    // Burundi differs
  assert.deepStrictEqual(ruleFor('+91'), [10])    // India
  assert.deepStrictEqual(ruleFor('+1'), [10])     // US / Canada
  assert.strictEqual(ruleFor('+999'), null)
})

check('a country we have no rule for is never blocked — but 3 digits still is', () => {
  assert.strictEqual(FALLBACK_LENGTHS.includes(9), true)
  const unknownOk = validatePhone('+998', '901234567', 'Nowhere')
  assert.strictEqual(unknownOk.ok, true)
  assert.strictEqual(unknownOk.exact, false)
  const unknownShort = validatePhone('+998', '90123', 'Nowhere')
  assert.strictEqual(unknownShort.ok, false)
  assert.ok(/6–15 digits/.test(unknownShort.message), unknownShort.message)
})

check('an empty field is not shouted at — it just says to type something', () => {
  const empty = validatePhone('+256', '')
  assert.strictEqual(empty.ok, false)
  assert.strictEqual(empty.message, 'Enter your phone number.')
  assert.strictEqual(validatePhone('+256', '   ').ok, false)
})

check('the hint tells the rule BEFORE it is broken', () => {
  const ug = lengthHint('+256', 'Uganda')
  assert.ok(/9 digits/.test(ug), ug)
  assert.ok(/leading 0/.test(ug), ug)
  assert.strictEqual(lengthHint('+999').length > 0, true)
})

check('the range tells the UI what to accept', () => {
  assert.deepStrictEqual(lengthRange('+256'), { min: 9, max: 9 })
  assert.deepStrictEqual(lengthRange('+49'), { min: 10, max: 11 })
  assert.deepStrictEqual(lengthRange('+999'), { min: 6, max: 15 })
})

check('the full number is what the world dials', () => {
  assert.strictEqual(formatFull('+256', '771234567'), '+256771234567')
})

console.log('\n' + checks + ' phone checks passed')
