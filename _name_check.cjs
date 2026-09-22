/**
 * Dev-only harness for the buyer-name rules (`src/buyerName.ts`).
 *
 *   npx tsc --ignoreConfig src/buyerName.ts src/reviewUtils.ts --outDir _dsbuild --module commonjs --target es2020 --skipLibCheck
 *   Move-Item -Force _dsbuild/buyerName.js _dsbuild/buyerName.cjs
 *   Move-Item -Force _dsbuild/reviewUtils.js _dsbuild/reviewUtils.cjs
 *   node _name_check.cjs
 *
 * Why this exists: this decides what a seller calls the person asking for a delivery, and what a
 * stranger reads above a public comment. Get it wrong and a buyer is either nameless ("Buyer"), or
 * published under a name they never agreed to. Neither shows up in a build log.
 */
const assert = require('assert')
const path = require('path')
const {
  NAME_MAX,
  checkoutPrefill,
  cleanBuyerName,
  emptyNameState,
  hasConfirmedName,
  nameLabel,
  needsNameAsk,
  publicName,
  suggestName,
} = require(path.join(__dirname, '_dsbuild', 'buyerName.cjs'))

let checks = 0
const check = (name, fn) => { fn(); checks++; console.log('  ok  ' + name) }

// -- what we suggest -------------------------------------------------------------------------

check('a Google name is offered back in its short form', () => {
  assert.deepStrictEqual(suggestName({ displayName: 'Aisha Nabukeera' }), { name: 'Aisha N.', source: 'google' })
  assert.deepStrictEqual(suggestName({ displayName: 'john paul otim' }), { name: 'John O.', source: 'google' })
  assert.deepStrictEqual(suggestName({ displayName: 'Aisha' }), { name: 'Aisha', source: 'google' })
})

check('with only an email, the address is the clue', () => {
  assert.deepStrictEqual(suggestName({ email: 'aisha.nabukeera@gmail.com' }), { name: 'Aisha', source: 'email' })
  assert.deepStrictEqual(suggestName({ email: 'j_mwangi99@yahoo.com' }), { name: 'Mwangi', source: 'email' })
  assert.deepStrictEqual(suggestName({ email: 'grace-achieng@outlook.com' }), { name: 'Grace', source: 'email' })
})

check('a phone-only buyer is asked, never guessed at', () => {
  assert.deepStrictEqual(suggestName({}), { name: '', source: '' })
  assert.deepStrictEqual(suggestName({ displayName: '', email: '' }), { name: '', source: '' })
  assert.deepStrictEqual(suggestName({ email: '256771234567@phone.local' }), { name: '', source: '' })
})

check('a junk account name falls through to the email, or to asking', () => {
  assert.deepStrictEqual(suggestName({ displayName: '\u{1F600}', email: 'aisha@x.com' }), { name: 'Aisha', source: 'email' })
  assert.deepStrictEqual(suggestName({ displayName: '\u{1F600}', email: '' }), { name: '', source: '' })
})

// -- what a name is allowed to be ------------------------------------------------------------

check('names are tidied, not mangled', () => {
  assert.strictEqual(cleanBuyerName('  Aisha   Nabukeera  '), 'Aisha Nabukeera')
  assert.strictEqual(cleanBuyerName('Aisha\nNabukeera'), 'Aisha Nabukeera')
  assert.strictEqual(cleanBuyerName('Aisha\u0007'), 'Aisha')
  assert.strictEqual(cleanBuyerName('AISHA NABUKEERA'), 'Aisha Nabukeera')
  assert.strictEqual(cleanBuyerName('McDonald Otim'), 'McDonald Otim')
  assert.strictEqual(cleanBuyerName('aisha'), 'aisha')
  assert.strictEqual(cleanBuyerName('\u05D0\u05D5\u05E4\u05E0\u05D4'), '\u05D0\u05D5\u05E4\u05E0\u05D4')
})

check('a name is not a link, a handle or a phone number', () => {
  assert.strictEqual(cleanBuyerName('aisha@x.com'), '')
  assert.strictEqual(cleanBuyerName('www.shop.com'), '')
  assert.strictEqual(cleanBuyerName('https://spam.example'), '')
  assert.strictEqual(cleanBuyerName('call +256771234567'), '')
})

check('junk is refused, and never quietly trimmed', () => {
  assert.strictEqual(cleanBuyerName(''), '')
  assert.strictEqual(cleanBuyerName('   '), '')
  assert.strictEqual(cleanBuyerName('A'), '')
  assert.strictEqual(cleanBuyerName('12345'), '')
  assert.strictEqual(cleanBuyerName('\u{1F600}\u{1F600}'), '')
  assert.strictEqual(cleanBuyerName('x'.repeat(NAME_MAX + 1)), '')
  assert.strictEqual(cleanBuyerName('x'.repeat(NAME_MAX)).length, NAME_MAX)
  assert.strictEqual(cleanBuyerName(undefined), '')
  assert.strictEqual(cleanBuyerName(42), '')
})


// -- how they are shown ----------------------------------------------------------------------

check('the public form is short, and never a full name', () => {
  assert.strictEqual(publicName('Aisha Nabukeera'), 'Aisha N.')
  assert.strictEqual(publicName('Aisha'), 'Aisha')
  assert.strictEqual(publicName(''), 'Verified buyer')
  assert.strictEqual(publicName(undefined), 'Verified buyer')
})

check('"Buyer" can never come out of the labeller', () => {
  for (const input of ['', undefined, null, 42, '\u{1F600}', '   ', 'A']) {
    const label = nameLabel(input)
    assert.notStrictEqual(label, 'Buyer', JSON.stringify(input))
    assert.strictEqual(label, 'Verified buyer')
  }
  assert.strictEqual(nameLabel('Aisha Nabukeera'), 'Aisha N.')
})

// -- asking once, ever -----------------------------------------------------------------------

check('we ask once, and only once', () => {
  assert.strictEqual(needsNameAsk(null), true)
  assert.strictEqual(needsNameAsk(emptyNameState()), true)
  assert.strictEqual(needsNameAsk({ ...emptyNameState(), skipped: true }), false)
  assert.strictEqual(needsNameAsk({ ...emptyNameState(), name: 'Aisha', confirmedAt: 123 }), false)
})

check('a "confirmed" name that is blank does not count as answered', () => {
  assert.strictEqual(hasConfirmedName({ confirmedAt: 123, name: '' }), false)
  assert.strictEqual(hasConfirmedName({ confirmedAt: 123, name: 'Aisha' }), true)
  assert.strictEqual(hasConfirmedName(null), false)
})

// -- checkout --------------------------------------------------------------------------------

check('checkout is pre-filled with what they confirmed, else with the suggestion', () => {
  assert.strictEqual(checkoutPrefill({ name: 'Aisha', confirmedAt: 9 }, { displayName: 'Aisha Nabukeera' }).name, 'Aisha')
  assert.strictEqual(checkoutPrefill(emptyNameState(), { displayName: 'Aisha Nabukeera' }).name, 'Aisha N.')
  assert.strictEqual(checkoutPrefill(null, { email: 'mwangi@x.com' }).name, 'Mwangi')
  assert.strictEqual(checkoutPrefill(null, {}).name, '')
})

console.log(`\n${checks} checks passed \u2014 buyer names: suggestions, tidying, labels and asking once.\n`)
