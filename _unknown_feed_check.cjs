/**
 * Dev-only harness for the Unknown home mix (`src/unknownFeed.ts`).
 *
 *   npx tsc --ignoreConfig src/unknownFeed.ts src/categories.ts src/demographics.ts --outDir _dsbuild --module commonjs --target es2020 --skipLibCheck
 *   Move-Item -Force _dsbuild/unknownFeed.js _dsbuild/unknownFeed.cjs
 *   (leave categories.js and demographics.js in place: unknownFeed.cjs requires them extensionless)
 *   node _unknown_feed_check.cjs
 *
 * Pins the one thing the home page promises: the shelf leans on the **bracket before** the buyer
 * (their habit), then the one after (their horizon), then their own — and never invents an age
 * when somebody chose not to say. Renamed categories are read through the alias table, so an old
 * "Fashion" listing remains on the Fashion & Clothing shelf.
 */
const assert = require('assert')
const path = require('path')
const {
  UNKNOWN_AGE_ORDER,
  adjacentAgeBands,
  unknownScore,
  rankUnknown,
  unknownCohortLine,
  UNKNOWN_TITLE,
  UNKNOWN_BLURB,
} = require(path.join(__dirname, '_dsbuild', 'unknownFeed.cjs'))
const {
  CATEGORIES,
  getMainCategories,
  getSubcategories,
  canonicalCategory,
} = require(path.join(__dirname, '_dsbuild', 'categories.js'))

let checks = 0
const check = (name, fn) => { fn(); checks++; console.log('  ok  ' + name) }

check('the bands run youngest to oldest, once each', () => {
  assert.deepStrictEqual(UNKNOWN_AGE_ORDER, ['under-18', '18-24', '25-34', '35-44', '45-54', '55+'])
  assert.strictEqual(new Set(UNKNOWN_AGE_ORDER).size, UNKNOWN_AGE_ORDER.length)
})

check('25-34 has the bracket before and the bracket after', () => {
  assert.deepStrictEqual(adjacentAgeBands('25-34'), { prior: '18-24', next: '35-44', current: '25-34' })
})

check('the youngest has only a next, the oldest only a prior', () => {
  assert.deepStrictEqual(adjacentAgeBands('under-18'), { prior: null, next: '18-24', current: 'under-18' })
  assert.deepStrictEqual(adjacentAgeBands('55+'), { prior: '45-54', next: null, current: '55+' })
})

check('no answer means no invented cohort', () => {
  for (const answer of ['', null, undefined, 'undisclosed']) {
    assert.deepStrictEqual(adjacentAgeBands(answer), { prior: null, next: null, current: null })
  }
})

check('the prior bracket outweighs the next, and both outweigh the buyer\'s own shelf', () => {
  const prior = unknownScore({ category: 'Fashion & Clothing' }, '25-34') // 18-24 (+ own)
  const next = unknownScore({ category: 'Automotive' }, '25-34')          // 35-44 only
  const current = unknownScore({ category: 'Services' }, '25-34')         // 25-34 only
  assert.ok(prior > next, `prior ${prior} must beat next ${next}`)
  assert.ok(next > current, `next ${next} must beat current ${current}`)
})

check('an unlisted category still ranks by real movement', () => {
  const quiet = unknownScore({ category: 'Something New', orderCount: 0 }, '25-34')
  const moving = unknownScore({ category: 'Something New', orderCount: 8 }, '25-34')
  assert.ok(moving > quiet)
})

check('a renamed category is read through the alias table', () => {
  assert.strictEqual(
    unknownScore({ category: 'Fashion' }, '25-34'),
    unknownScore({ category: 'Fashion & Clothing' }, '25-34'),
  )
})

check('the ranked shelf is a copy, sorted, and stable for equal scores', () => {
  const list = [
    { id: 'home', category: 'Home & Living' },
    { id: 'fashion', category: 'Fashion & Clothing' },
    { id: 'quiet', category: 'Unlisted' },
  ]
  const ranked = rankUnknown(list, '25-34')
  assert.deepStrictEqual(ranked.map(x => x.id), ['fashion', 'home', 'quiet'])
  assert.deepStrictEqual(list.map(x => x.id), ['home', 'fashion', 'quiet'], 'the input was mutated')
})

check('without an age the shelf is the market, not a guess', () => {
  const list = [
    { id: 'quiet', category: 'Fashion & Clothing' },
    { id: 'moving', category: 'Fashion & Clothing', orderCount: 5 },
  ]
  assert.deepStrictEqual(rankUnknown(list, 'undisclosed').map(x => x.id), ['moving', 'quiet'])
})

check('the sentence says which two shelves were mixed, and makes no claim without an age', () => {
  const line = unknownCohortLine('25-34')
  assert.ok(line.includes('18-24'))
  assert.ok(line.includes('35-44'))
  assert.ok(unknownCohortLine('undisclosed').includes('across rachett'))
  assert.ok(unknownCohortLine('under-18').includes('18-24'))
  assert.ok(unknownCohortLine('55+').includes('45-54'))
})

check('the page is called Unknown, not Discover', () => {
  assert.strictEqual(UNKNOWN_TITLE, 'Unknown')
  assert.ok(UNKNOWN_BLURB.toLowerCase().includes('did not know'))
})

check('the renamed and new shelves exist, with subcategories a seller can finish', () => {
  const names = getMainCategories()
  for (const name of [
    'Fashion & Clothing',
    'Pets & Pet Supplies',
    'Youths',
    'Industrial & Commercial',
    'Second Hand / Used',
  ]) {
    assert.ok(names.includes(name), `${name} is missing from the market`)
    assert.ok(getSubcategories(name).length > 0, `${name} would be a dead end in store setup`)
  }
  assert.ok(!names.includes('Fashion') && !names.includes('Pet Supplies'),
    'the old display names must not still be shelves')
  assert.strictEqual(getSubcategories('Fashion').length, getSubcategories('Fashion & Clothing').length)
  assert.strictEqual(canonicalCategory('Pet Supplies'), 'Pets & Pet Supplies')
  assert.ok(Object.values(CATEGORIES).every(list => list.length > 0))
})

console.log(`\n  ${checks} Unknown-feed checks passed\n`)
