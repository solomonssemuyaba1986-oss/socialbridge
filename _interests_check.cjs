/**
 * Dev-only harness for the buyer interests rules (`src/interests.ts`).
 *
 *   npx tsc --ignoreConfig src/interests.ts --outDir _dsbuild --module commonjs --target es2020 --skipLibCheck
 *   node _interests_check.cjs
 *
 * Why this exists: interests aim what a buyer is shown, and the stored shape has to survive a
 * category rename, a guest signing in, and somebody tapping Skip. A wrong limit quietly drops a
 * choice; a wrong timestamp asks the same question forever; an invalid name becomes a phantom
 * shelf no seller can match. None of that shows up in a build log.
 */
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const {
  INTEREST_OPTIONS,
  MAX_INTERESTS,
  answeredInterests,
  deviceInterestsToState,
  emptyInterests,
  interestsCountLabel,
  interestsFrom,
  interestsPatch,
  interestsSummary,
  needsInterestsAsk,
  parseDeviceInterests,
  readInterests,
  serializeDeviceInterests,
  toggleInterest,
} = require(path.join(__dirname, '_dsbuild', 'interests.js'))
const { CATEGORIES } = require(path.join(__dirname, '_dsbuild', 'categories.js'))

let checks = 0
const check = (name, fn) => { fn(); checks++; console.log('  ok  ' + name) }
const at = 1_700_000_000_000

// -- the shelves we offer ----------------------------------------------------------------------

check('every interest is a real category, and every category is offered', () => {
  const categories = Object.keys(CATEGORIES)
  assert.deepStrictEqual(INTEREST_OPTIONS.map(o => o.value), categories)
  assert.ok(INTEREST_OPTIONS.every(o => o.label === o.value && o.emoji.length > 0))
  assert.strictEqual(MAX_INTERESTS, 7)
})

check('the limit is seven, enforced without losing what was already picked', () => {
  const seven = INTEREST_OPTIONS.slice(0, 7).map(o => o.value)
  assert.deepStrictEqual(readInterests(seven), seven)
  assert.strictEqual(toggleInterest(seven, INTEREST_OPTIONS[7].value).length, 7)
  assert.deepStrictEqual(toggleInterest(seven, INTEREST_OPTIONS[7].value), seven, 'an eighth changes nothing')
  // An eighth inside the stored array is truncated, never an error.
  assert.strictEqual(readInterests(INTEREST_OPTIONS.slice(0, 9).map(o => o.value)).length, 7)
  // Deselecting makes room again.
  const six = toggleInterest(seven, seven[0])
  assert.strictEqual(six.length, 6)
  assert.strictEqual(toggleInterest(six, INTEREST_OPTIONS[7].value).length, 7)
})

check('unknown, duplicated and renamed values become canonical shelves', () => {
  assert.deepStrictEqual(readInterests(['Fashion']), ['Fashion & Clothing'])
  assert.deepStrictEqual(readInterests(['Pet Supplies']), ['Pets & Pet Supplies'])
  assert.deepStrictEqual(readInterests(['fashion & clothing', 'Fashion & Clothing']), ['Fashion & Clothing'])
  assert.deepStrictEqual(readInterests(['', '  ', 'Nope', 42, null, {}, []]), [])
  assert.deepStrictEqual(readInterests('Fashion & Clothing'), [])
  // Catalogue order, not the order a form happened to submit.
  assert.deepStrictEqual(
    readInterests(['Perfume', 'Fashion & Clothing']),
    ['Fashion & Clothing', 'Perfume'],
  )
})

// -- what an answer is -------------------------------------------------------------------------

check('a missing document is unanswered, never an empty preference', () => {
  for (const doc of [null, undefined, {}, 'nonsense', 0]) {
    assert.deepStrictEqual(interestsFrom(doc), emptyInterests())
    assert.strictEqual(needsInterestsAsk(interestsFrom(doc)), true)
    assert.strictEqual(answeredInterests(interestsFrom(doc)), false)
  }
})

check('a real answer reads back with its timestamp, source and skip state', () => {
  const state = interestsFrom({
    interests: ['Fashion & Clothing', 'Beauty & Cosmetics'],
    interestsAskedAt: at - 5000,
    interestsAt: at,
    interestsSkipped: false,
    interestsSource: 'onboarding',
    displayName: 'Aisha N.', // somebody else's field is ignored
  })
  assert.deepStrictEqual(state, {
    interests: ['Fashion & Clothing', 'Beauty & Cosmetics'],
    askedAt: at - 5000,
    answeredAt: at,
    skipped: false,
    source: 'onboarding',
  })
  assert.strictEqual(answeredInterests(state), true)
  assert.strictEqual(needsInterestsAsk(state), false)
})

check('skip is an answer, and an empty list without a timestamp is not', () => {
  const skipped = interestsFrom({ interests: [], interestsAt: at, interestsSkipped: true, interestsSource: 'onboarding' })
  assert.deepStrictEqual(skipped.interests, [])
  assert.strictEqual(skipped.skipped, true)
  assert.strictEqual(answeredInterests(skipped), true)
  assert.strictEqual(needsInterestsAsk(skipped), false)

  const emptyNoTime = interestsFrom({ interests: [], interestsSkipped: true })
  assert.strictEqual(answeredInterests(emptyNoTime), false)
  // A stale skip flag beside actual picks is not a skip.
  const stale = interestsFrom({ interests: ['Perfume'], interestsAt: at, interestsSkipped: true })
  assert.strictEqual(stale.interests.length, 1)
  assert.strictEqual(stale.skipped, false)
})

check('the write shape round-trips through the read shape', () => {
  const state = {
    interests: ['Perfume', 'Home & Living'],
    askedAt: at - 1000,
    answeredAt: at,
    skipped: false,
    source: 'profile',
  }
  assert.deepStrictEqual(interestsFrom(interestsPatch(state)), state)
})

check('the counter and summary say the truth in words', () => {
  assert.strictEqual(interestsCountLabel(0), '0 of 7 picked')
  assert.strictEqual(interestsCountLabel(3), '3 of 7 picked')
  assert.strictEqual(interestsCountLabel(99), '7 of 7 picked')
  assert.strictEqual(interestsSummary({ ...emptyInterests(), interests: ['Perfume'], answeredAt: at }), 'You picked Perfume.')
  assert.ok(/skipped/i.test(interestsSummary({ ...emptyInterests(), answeredAt: at, skipped: true })))
  assert.ok(/No interests picked yet/i.test(interestsSummary(emptyInterests())))
})

// -- the phone copy, before there is an account -------------------------------------------------

check('a device record round-trips, and junk or a half answer is forgotten', () => {
  const rec = { interests: ['Perfume', 'Fashion & Clothing'], skipped: false, at }
  const parsed = parseDeviceInterests(serializeDeviceInterests(rec))
  assert.deepStrictEqual(parsed, { interests: ['Fashion & Clothing', 'Perfume'], skipped: false, at })
  assert.strictEqual(parseDeviceInterests(''), null)
  assert.strictEqual(parseDeviceInterests('{'), null)
  assert.strictEqual(parseDeviceInterests(JSON.stringify({ interests: [], at })), null, 'empty + no skip is not an answer')
  assert.strictEqual(parseDeviceInterests(JSON.stringify({ interests: ['Nope'], at })), null)
  // A skip has to survive, otherwise a guest who skipped is asked again after signing in.
  assert.deepStrictEqual(
    parseDeviceInterests(serializeDeviceInterests({ interests: [], skipped: true, at })),
    { interests: [], skipped: true, at },
  )
})

check('a device answer becomes the same account-shaped state', () => {
  const rec = { interests: ['Perfume'], skipped: false, at }
  const state = deviceInterestsToState(rec)
  assert.deepStrictEqual(state.interests, ['Perfume'])
  assert.strictEqual(state.answeredAt, at)
  assert.strictEqual(state.askedAt, at)
  assert.strictEqual(state.source, 'device-adopted')
  assert.deepStrictEqual(deviceInterestsToState(null), emptyInterests())
})

// -- the wiring ---------------------------------------------------------------------------------

const src = file => fs.readFileSync(path.join(__dirname, 'src', file), 'utf8')

check('buyer onboarding asks first, only for a buyer, and can be skipped', () => {
  const onboarding = src('Onboarding.tsx')
  assert.ok(/step === 'interests'/.test(onboarding), 'the interests step is missing')
  assert.ok(/<InterestPicker[\s\S]*?surface="onboarding"/.test(onboarding), 'onboarding must use the shared picker')
  assert.ok(/getRole\(\) === 'buyer'/.test(onboarding), 'interests must belong to the buyer card only')
  assert.ok(/onDone=\{afterInterests\}/.test(onboarding), 'the answer must move onboarding on')
  assert.ok(/Pick up to \{MAX_INTERESTS\}/.test(onboarding), 'the page must state the limit')
})

check('the picker caps at seven and keeps Skip visible', () => {
  const picker = src('InterestPicker.tsx')
  assert.ok(/MAX_INTERESTS/.test(picker), 'the picker must read the shared limit')
  assert.ok(/allowSkip/.test(picker) && /Skip/.test(picker), 'Skip must exist')
  assert.ok(/aria-pressed=\{selected\}/.test(picker), 'selection must be announced, not colour-only')
  assert.ok(/disabled=\{blocked\}/.test(picker), 'an eighth choice must be refused in the UI')
  assert.ok((picker.match(/>\s*Skip\s*</g) || []).length >= 1, 'the top Skip button must be visible')
})

check('the account and device paths both record the answer, with no gate', () => {
  const hook = src('useInterests.ts')
  assert.ok(/users\/|doc\(db, 'users'/.test(hook), 'account write path missing')
  assert.ok(/writeDeviceInterests/.test(hook), 'device path missing')
  assert.ok(/interestsPatch\(next\)/.test(hook), 'the write shape must come from the pure module')
  assert.ok(/trackEvent\('interests_prompt_shown'/.test(hook))
  assert.ok((hook.match(/trackEvent\('interests_saved'/g) || []).length === 2, 'both paths must record the same event')
  const app = src('App.tsx')
  assert.ok(!/InterestsGate|InterestsAsk/.test(app), 'interests are optional — nothing may gate on them')
  assert.ok(/<InterestsAdoption \/>/.test(app), 'the silent adoption mount is missing — a guest signing in later would strand their choices')
})

check('the profile can read them back and change them', () => {
  const profile = src('ProfilePage.tsx')
  assert.ok(/useInterests\(\)/.test(profile))
  assert.ok(/interestsSummary\(myInterests\.state\)/.test(profile))
  assert.ok(/<InterestPicker[\s\S]*?surface="profile"/.test(profile))
  assert.ok(/What we keep, and where/.test(profile) && /<Where what="Interests"/.test(profile), 'the privacy card must name interests')
})

check('the training exporter projects profiles, never copies them', () => {
  const exporter = fs.readFileSync(path.join(__dirname, 'functions', 'export-training-data.js'), 'utf8')
  assert.ok(/profiles: \{ label: 'buyer profiles[^']*', ref: \(\) => db\.collection\('users'\) \}/.test(exporter))
  const block = exporter.match(/const PROFILE_FIELDS = \[([\s\S]*?)\]/)
  assert.ok(block, 'PROFILE_FIELDS is missing')
  assert.ok(/'interests'/.test(block[1]) && /'ageBand'/.test(block[1]) && /'gender'/.test(block[1]))
  for (const forbidden of ['displayName', 'email', 'paymentPhone', 'drafts', 'quickReplies', 'phoneNumber']) {
    assert.ok(!new RegExp(`'${forbidden}'`).test(block[1]), `${forbidden} must never be exported`)
  }
  assert.ok(/if \(target === 'profiles'\)/.test(exporter), 'profiles must take the projection branch')
})

check('the event lake accepts both new events with category-only props', () => {
  const taxonomy = src('analytics/taxonomy.ts')
  assert.ok(/interests_prompt_shown: \['surface'\]/.test(taxonomy))
  assert.ok(/interests_saved: \['count', 'categories', 'skipped', 'changed', 'surface'\]/.test(taxonomy))
  const analytics = fs.readFileSync(path.join(__dirname, 'ANALYTICS.md'), 'utf8')
  assert.ok(/interests_prompt_shown/.test(analytics) && /interests_saved/.test(analytics))
})

console.log(`\n${checks} checks passed — buyer interests: known shelves, seven at most, skip as an answer, device adoption, and the wiring.`)

