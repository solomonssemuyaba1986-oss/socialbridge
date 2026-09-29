/**
 * Dev-only harness for the age & gender rules (`src/demographics.ts`).
 *
 *   npx tsc --ignoreConfig src/demographics.ts --outDir _dsbuild --module commonjs --target es2020 --skipLibCheck
 *   Move-Item -Force _dsbuild/demographics.js _dsbuild/demographics.cjs
 *   node _demographics_check.cjs
 *
 * Why this exists: these two answers decide what every person is shown, and they are the only facts
 * rachett holds about somebody's body. Get the storage shape wrong and yesterday's answers stop
 * being read; get "answered" wrong and either the ask comes back forever or half an answer is spent
 * as if it were whole; get the recommendation seam wrong and a person who said "prefer not to say"
 * is quietly targeted anyway. None of that shows up in a build log.
 */
const assert = require('assert')
const path = require('path')
const {
  AGE_OPTIONS,
  GENDER_OPTIONS,
  ageWords,
  answeredDemographics,
  askPrompt,
  demographicsFrom,
  demographicsPatch,
  demographicsSummary,
  demographicsWords,
  deviceDemographicsToState,
  emptyDemographics,
  genderWords,
  missingQuestions,
  needsDemographicsAsk,
  parseDeviceDemographics,
  readAgeAnswer,
  readGenderAnswer,
  recommendationAudience,
  serializeDeviceDemographics,
} = require(path.join(__dirname, '_dsbuild', 'demographics.cjs'))

let checks = 0
const check = (name, fn) => { fn(); checks++; console.log('  ok  ' + name) }
const at = 1_700_000_000_000

// -- what counts as an answer ------------------------------------------------------------------

check('every option we offer reads back as the answer we store', () => {
  for (const option of AGE_OPTIONS) assert.strictEqual(readAgeAnswer(option.value), option.value)
  for (const option of GENDER_OPTIONS) assert.strictEqual(readGenderAnswer(option.value), option.value)
  // The value is the code and the label is what a person reads. They are allowed to differ.
  assert.strictEqual(ageWords('55+'), '55 and over')
  assert.strictEqual(genderWords('female'), 'Woman')
  assert.strictEqual(ageWords('undisclosed'), 'Prefer not to say')
  assert.strictEqual(genderWords('undisclosed'), 'Prefer not to say')
})

check('stored codes are plain ASCII, so nothing depends on how a keyboard renders them', () => {
  for (const option of [...AGE_OPTIONS, ...GENDER_OPTIONS]) {
    assert.ok(/^[a-z0-9+-]+$/.test(option.value), `not a plain code: ${option.value}`)
    assert.ok(option.label.trim().length > 0, `unlabelled option: ${option.value}`)
  }
})

check('"prefer not to say" is offered on both questions — required must not mean forced', () => {
  assert.ok(AGE_OPTIONS.some(option => option.value === 'undisclosed'))
  assert.ok(GENDER_OPTIONS.some(option => option.value === 'undisclosed'))
  // Youngest first, and the honest option for a young person exists rather than being guessed at.
  assert.deepStrictEqual(AGE_OPTIONS.map(o => o.value), ['under-18', '18-24', '25-34', '35-44', '45-54', '55+', 'undisclosed'])
  assert.deepStrictEqual(GENDER_OPTIONS.map(o => o.value), ['female', 'male', 'other', 'undisclosed'])
})

check('junk and half-codes are not answers', () => {
  for (const raw of ['', '  ', 'woman', 'WOMAN', 'male-ish', '25', '18-25', 'f', 'other!', 'unknown', null, undefined, 42, {}, []]) {
    assert.strictEqual(readAgeAnswer(raw), '', `age accepted: ${JSON.stringify(raw)}`)
    assert.strictEqual(readGenderAnswer(raw), '', `gender accepted: ${JSON.stringify(raw)}`)
  }
  // Case and stray spaces on a real code are tolerated: a stored value is not a typing test.
  assert.strictEqual(readAgeAnswer('  25-34 '), '25-34')
  assert.strictEqual(readGenderAnswer(' Female '), 'female')
})

// -- reading a document ------------------------------------------------------------------------

check('a missing document reads as unanswered, never as a default person', () => {
  for (const doc of [null, undefined, '', 0, {}, 'nonsense']) {
    assert.deepStrictEqual(demographicsFrom(doc), emptyDemographics())
    assert.strictEqual(demographicsFrom(doc).ageBand, '')
    assert.strictEqual(needsDemographicsAsk(demographicsFrom(doc)), true)
  }
})

check('a stored answer reads back exactly, timestamps and source included', () => {
  const state = demographicsFrom({
    ageBand: '25-34',
    gender: 'female',
    demographicsAskedAt: at - 5000,
    demographicsAt: at,
    demographicsSource: 'onboarding',
    displayName: 'Aisha N.', // somebody else's field on the same document is ignored
  })
  assert.deepStrictEqual(state, { ageBand: '25-34', gender: 'female', askedAt: at - 5000, answeredAt: at, source: 'onboarding' })
  assert.strictEqual(answeredDemographics(state), true)
  assert.strictEqual(needsDemographicsAsk(state), false)
  assert.deepStrictEqual(missingQuestions(state), [])
})

check('a value we did not write is not read as if we had', () => {
  const state = demographicsFrom({ ageBand: 'twenty-something', gender: 'yes', demographicsAt: at })
  assert.strictEqual(state.ageBand, '')
  assert.strictEqual(state.gender, '')
  assert.strictEqual(answeredDemographics(state), false, 'a made-up value must not count as an answer')
})

check('both questions, or the ask is still owed', () => {
  const halfAge = { ageBand: '25-34', gender: '', askedAt: at, answeredAt: at, source: 'gate' }
  const halfGender = { ageBand: '', gender: 'male', askedAt: at, answeredAt: at, source: 'gate' }
  assert.strictEqual(answeredDemographics(halfAge), false)
  assert.deepStrictEqual(missingQuestions(halfAge), ['gender'])
  assert.strictEqual(answeredDemographics(halfGender), false)
  assert.deepStrictEqual(missingQuestions(halfGender), ['age'])
  // No clock, no answer: an answer with no time on it cannot stop the ask.
  assert.strictEqual(answeredDemographics({ ageBand: '25-34', gender: 'male', answeredAt: 0 }), false)
  assert.strictEqual(answeredDemographics(null), false)
})

// -- what we say back --------------------------------------------------------------------------

check('what we hold is said in the words the person chose', () => {
  assert.strictEqual(demographicsWords({ ageBand: '45-54', gender: 'male' }), '45-54, Man')
  assert.strictEqual(demographicsWords({ ageBand: 'undisclosed', gender: 'undisclosed' }), 'Prefer not to say, Prefer not to say')
  assert.strictEqual(demographicsWords({ ageBand: '18-24' }), '18-24')
  assert.strictEqual(demographicsWords(null), '')
})

check('the profile line is honest in all three states, and never promises "people like you"', () => {
  const answered = demographicsSummary({ ageBand: '25-34', gender: 'female', answeredAt: at })
  assert.ok(answered.startsWith('25-34, Woman'), answered)
  assert.ok(answered.includes('your account'), answered)
  assert.ok(demographicsSummary({ ageBand: '25-34', gender: '', answeredAt: 0 }).includes('still missing'))
  assert.ok(demographicsSummary(emptyDemographics()).includes('Not answered yet'))
  for (const line of [answered, demographicsSummary(emptyDemographics()), demographicsSummary({})]) {
    assert.ok(!/people like you|similar people|others like/i.test(line), `a claim we cannot make: ${line}`)
  }
})

check('a half answer says exactly which half is missing', () => {
  assert.strictEqual(askPrompt({ ageBand: '', gender: '' }), 'Pick your age group and how you identify to carry on.')
  assert.strictEqual(askPrompt({ ageBand: '25-34', gender: '' }), 'Pick how you identify to carry on.')
  assert.strictEqual(askPrompt({ ageBand: '', gender: 'male' }), 'Pick your age group to carry on.')
  assert.strictEqual(askPrompt({ ageBand: '25-34', gender: 'male' }), '')
})

// -- the stored shape --------------------------------------------------------------------------

check('the patch carries the five documented fields and nothing else', () => {
  const patch = demographicsPatch({ ageBand: '35-44', gender: 'other', askedAt: at - 10, answeredAt: at, source: 'profile' })
  assert.deepStrictEqual(Object.keys(patch).sort(), [
    'ageBand', 'demographicsAskedAt', 'demographicsAt', 'demographicsSource', 'gender',
  ])
  assert.deepStrictEqual(patch, {
    ageBand: '35-44',
    gender: 'other',
    demographicsAskedAt: at - 10,
    demographicsAt: at,
    demographicsSource: 'profile',
  })
  // No birthday, no exact age, ever: a band is what the recommender uses and all we need to hold.
  assert.ok(!('birthday' in patch) && !('age' in patch) && !('dateOfBirth' in patch))
})

check('what we write is what we read — the round trip cannot drift', () => {
  const state = { ageBand: '18-24', gender: 'female', askedAt: at - 1, answeredAt: at, source: 'setup' }
  assert.deepStrictEqual(demographicsFrom(demographicsPatch(state)), state)
})

check('a patch with no clock on it is stored as zero, not as however long ago the epoch was', () => {
  const patch = demographicsPatch({ ageBand: '55+', gender: 'male', askedAt: 0, answeredAt: 0, source: '' })
  assert.strictEqual(patch.demographicsAt, 0)
  assert.strictEqual(patch.demographicsAskedAt, 0)
})

// -- the recommendation seam -------------------------------------------------------------------

check('an audience is handed over only when there is one', () => {
  assert.deepStrictEqual(
    recommendationAudience({ ageBand: '25-34', gender: 'female' }),
    { ageBand: '25-34', gender: 'female' },
  )
  // "Prefer not to say" is an answer we keep — but it is not something to aim at.
  assert.strictEqual(recommendationAudience({ ageBand: 'undisclosed', gender: 'female' }), null)
  assert.strictEqual(recommendationAudience({ ageBand: '25-34', gender: 'undisclosed' }), null)
  // Half an answer is not an audience either: the caller must fall back to what it can honestly say.
  assert.strictEqual(recommendationAudience({ ageBand: '25-34', gender: '' }), null)
  assert.strictEqual(recommendationAudience({}), null)
  assert.strictEqual(recommendationAudience(null), null)
})

// -- the phone that remembers ------------------------------------------------------------------

check('the device copy survives a round trip, and stays whole', () => {
  const rec = parseDeviceDemographics(serializeDeviceDemographics({ ageBand: '18-24', gender: 'other', at }))
  assert.deepStrictEqual(rec, { ageBand: '18-24', gender: 'other', at })
  const state = deviceDemographicsToState(rec)
  assert.strictEqual(state.source, 'device-adopted')
  assert.strictEqual(answeredDemographics(state), true)
  assert.strictEqual(state.answeredAt, at)
})

check('junk in device storage is forgotten, never half-read', () => {
  const junk = [
    '', '   ', 'not json', '5', '"male"', 'null', 'true', '[]', '{}',
    '{"ageBand":"25-34"}',                        // half an answer
    '{"gender":"female"}',                        // the other half
    '{"ageBand":"25-34","gender":""}',
    '{"ageBand":"twenty-ish","gender":"female"}', // a value we did not write
    '{"ageBand":"25-34","gender":"WOMAN"}',
  ]
  for (const raw of junk) assert.strictEqual(parseDeviceDemographics(raw), null, JSON.stringify(raw))
  assert.strictEqual(parseDeviceDemographics(undefined), null)
  assert.strictEqual(parseDeviceDemographics(42), null)
  assert.strictEqual(deviceDemographicsToState(null).ageBand, '')
  assert.strictEqual(needsDemographicsAsk(deviceDemographicsToState(null)), true)
})

check('a device record with no usable clock is stamped, never left at zero', () => {
  const rec = parseDeviceDemographics('{"ageBand":"25-34","gender":"male","at":"nonsense"}')
  assert.strictEqual(rec.ageBand, '25-34')
  assert.ok(rec.at > 0, 'a record with no clock still has a time')
  assert.ok(JSON.parse(serializeDeviceDemographics({ ageBand: '25-34', gender: 'male', at: 0 })).at > 0)
  assert.ok(JSON.parse(serializeDeviceDemographics({ ageBand: '25-34', gender: 'male', at: -5 })).at > 0)
})

// -- wired in, or it is only a module ---------------------------------------------------------
// Source-level checks, the same way `_responsive_check.cjs` reads the app: a rule nobody renders
// is worth nothing, and the two ways this feature fails quietly are a surface that forgot to ask
// and an ask that can be dismissed.

const fs = require('fs')
const src = file => fs.readFileSync(path.join(__dirname, 'src', file), 'utf8')

check('every door asks — onboarding, store setup, profile, and the one-time gate', () => {
  const onboarding = src('Onboarding.tsx')
  assert.ok(/step === 'about'/.test(onboarding), 'the onboarding step is missing')
  assert.ok(/surface="onboarding"/.test(onboarding))

  const setup = src('SetupStore.tsx')
  assert.ok(/id="setup-field-demographics"/.test(setup), 'no anchor for "still needed" to jump to')
  assert.ok(/surface="setup"/.test(setup))
  assert.ok(/!myDemographics\.answered/.test(setup), 'Create My Shop is not gated on an answer')

  const profile = src('ProfilePage.tsx')
  assert.ok(/surface="profile"/.test(profile), 'the answer cannot be corrected')
  assert.ok(/demographicsSummary/.test(profile), 'and is not read back to the person')

  assert.ok(/<DemographicsGate \/>/.test(src('App.tsx')), 'the gate is not mounted')
})

check('the ask cannot be walked past, and never sits on top of a form', () => {
  const gate = src('DemographicsGate.tsx')
  const ask = src('AgeGenderAsk.tsx')
  // No ✕, no Later, no onClose — the only way out is an answer ("prefer not to say" included).
  assert.ok(!/['"]✕['"]/.test(gate) && !/>Later</.test(gate) && !/aria-label="Not now"/.test(gate), 'the gate has a way out')
  assert.ok(!/>Later</.test(ask) && !/onSkip/.test(ask), 'the ask has a way out')
  // A card above the tab bar, never a full-screen overlay: a half-filled order keeps its form.
  assert.ok(/position: 'fixed'/.test(gate), 'the gate is not a card on the page')
  assert.ok(!/top: 0, left: 0, right: 0, bottom: 0/.test(gate), 'the gate became an overlay')

  const allow = gate.match(/const ALLOWED_ROUTES = (\[[^\]]*\])/)
  assert.ok(allow, 'no allowlist')
  const routes = JSON.parse(allow[1].replace(/'/g, '"'))
  assert.deepStrictEqual(routes, ['/browse', '/nearby', '/home', '/bag', '/profile'])
  for (const route of routes) {
    assert.ok(!/^\/store|^\/signin|^\/setup/.test(route), `the ask must not appear at ${route}`)
  }
})

check('the surfaces and the events agree with the taxonomy', () => {
  const tax = src(path.join('analytics', 'taxonomy.ts'))
  for (const event of ['demographics_prompt_shown', 'demographics_answered']) {
    assert.ok(new RegExp(`${event}:`).test(tax), `${event} is missing from the taxonomy`)
  }
  const hook = src('useDemographics.ts')
  const fired = [...new Set([...hook.matchAll(/trackEvent\('([a-z_]+)'/g)].map(m => m[1]))].sort()
  assert.deepStrictEqual(fired, ['demographics_answered', 'demographics_prompt_shown'])
  for (const name of fired) assert.ok(tax.includes(name + ':'), `${name} would be dropped by pickAllowedProps`)
  // Both paths — the phone with no account yet, and a real account — record the same event, so the
  // funnel counts an answer given before signing up exactly like one given after.
  assert.strictEqual((hook.match(/trackEvent\('demographics_answered'/g) || []).length, 2)
  // Both questions are always on screen: a required ask that shows one of them is not an ask.
  assert.ok(/AGE_OPTIONS\.map/.test(src('AgeGenderAsk.tsx')) && /GENDER_OPTIONS\.map/.test(src('AgeGenderAsk.tsx')))
})

console.log(`\n${checks} checks passed \u2014 age & gender: what counts as an answer, what we keep, what we say back, and what a recommender is allowed to receive.`)