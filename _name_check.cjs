/**
 * Dev-only harness for the buyer-name rules (`src/buyerName.ts`).
 *
 *   npx tsc --ignoreConfig src/buyerName.ts src/reviewUtils.ts --outDir _dsbuild --module commonjs --target es2020 --skipLibCheck
 *   Copy-Item -Force _dsbuild/buyerName.js _dsbuild/buyerName.cjs
 *   Copy-Item -Force _dsbuild/reviewUtils.js _dsbuild/reviewUtils.cjs
 *   node _name_check.cjs
 *
 * Copy, not move: the compiled `buyerName.cjs` still asks for `./reviewUtils` with no extension, and
 * Node only resolves that to `reviewUtils.js` — renaming the helper away is what makes this harness
 * fail to load ("Cannot find module './reviewUtils'") before a single check has run.
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
  deviceNameToState,
  emptyNameState,
  hasConfirmedName,
  nameLabel,
  needsNameAsk,
  parseDeviceName,
  publicName,
  serializeDeviceName,
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

// -- the name a phone keeps before there is an account -------------------------------------------
//
// `rachett_last_name` (the memory that fills a checkout box on first paint) is *not* here: it is
// localStorage-only by design, a convenience rather than a stored identity. What is here is the
// record the ask itself lives in, because that one decides whether we ask again.

check('a device record is stored clean, and reads back exactly as saved', () => {
  const saved = serializeDeviceName({ name: '  Aisha   N.  ', skipped: false, at: 1700000000000 })
  assert.deepStrictEqual(parseDeviceName(saved), { name: 'Aisha N.', skipped: false, at: 1700000000000 })
  // Written then re-written: the stored form is already settled, so saving it again changes nothing.
  assert.deepStrictEqual(parseDeviceName(serializeDeviceName(parseDeviceName(saved))), parseDeviceName(saved))
})

check('a name we would refuse to show is never kept on the phone', () => {
  const saved = serializeDeviceName({ name: 'aisha@x.com', skipped: false, at: 1700000000000 })
  assert.strictEqual(JSON.parse(saved).name, '')
  // Nothing worth keeping and nothing said: the ask stays open rather than closing on junk.
  assert.strictEqual(parseDeviceName(saved), null)
  assert.strictEqual(needsNameAsk(deviceNameToState(parseDeviceName(saved))), true)
})

check('a device name becomes the same state an account name would be', () => {
  const state = deviceNameToState(parseDeviceName(serializeDeviceName({ name: 'Aisha', skipped: false, at: 1700000000000 })))
  assert.deepStrictEqual(state, {
    name: 'Aisha', source: 'self', askedAt: 1700000000000, confirmedAt: 1700000000000, skipped: false,
  })
  // ...which is what makes checkout arrive already filled in.
  assert.deepStrictEqual(checkoutPrefill(state, {}), { name: 'Aisha', source: 'self' })
  assert.strictEqual(deviceNameToState(null).name, '')
})

check('"Later" is remembered, so the same ask does not come back tomorrow', () => {
  const rec = parseDeviceName(serializeDeviceName({ name: '', skipped: true, at: 1700000000000 }))
  assert.deepStrictEqual(rec, { name: '', skipped: true, at: 1700000000000 })
  const state = deviceNameToState(rec)
  assert.strictEqual(needsNameAsk(state), false)
  // But Later is not a name: a seller still never sees one.
  assert.strictEqual(hasConfirmedName(state), false)
})

check('junk in device storage is forgotten, never shown', () => {
  const junk = [
    '', '   ', 'not json', '5', '"Aisha"', 'null', 'true', '[]', '{}',
    '{"name":"aisha@x.com"}', '{"name":"A"}', '{"skipped":"yes"}',
  ]
  for (const raw of junk) assert.strictEqual(parseDeviceName(raw), null, JSON.stringify(raw))
  assert.strictEqual(parseDeviceName(undefined), null)
  assert.strictEqual(parseDeviceName(42), null)
})

check('a record with no usable clock is stamped, never left at zero', () => {
  const rec = parseDeviceName('{"name":"Aisha","at":"nonsense"}')
  assert.strictEqual(rec.name, 'Aisha')
  assert.ok(rec.at > 0, 'a record with no clock still has a time')
  assert.ok(JSON.parse(serializeDeviceName({ name: 'Aisha', skipped: false, at: 0 })).at > 0)
  assert.ok(JSON.parse(serializeDeviceName({ name: 'Aisha', skipped: false, at: -5 })).at > 0)
})

console.log(`\n${checks} checks passed \u2014 buyer names: suggestions, tidying, labels, asking once, and the phone that remembers.\n`)
