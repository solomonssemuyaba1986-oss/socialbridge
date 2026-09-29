/**
 * Dev-only harness for the search itself (`src/searchRank.ts`).
 *
 *   npx tsc --ignoreConfig src/searchRank.ts --outDir _dsbuild --module commonjs --target es2020 --skipLibCheck
 *   Move-Item -Force _dsbuild/searchRank.js _dsbuild/searchRank.cjs
 *   node _search_rank_check.cjs
 *
 * Pins the four complaints the module was written against: a typo still finds the thing, a different
 * word for the same thing still finds it, every word in the query has to match something, and the
 * best match is the one at the top. Plus the two things a dead-end search owes the buyer: a
 * correction written from real listings, and a line that never just says "no results".
 */
const assert = require('assert')
const path = require('path')
const {
  SYNONYM_GROUPS,
  normalise,
  queryTokens,
  stem,
  tokenVariants,
  editDistance,
  typoBudget,
  matchTier,
  popularity,
  productScore,
  rankProducts,
  vocabularyFrom,
  didYouMean,
  searchLine,
  emptySearchHelp,
} = require(path.join(__dirname, '_dsbuild', 'searchRank.cjs'))

let checks = 0
const check = (name, fn) => { fn(); checks++; console.log('  ok  ' + name) }

/** The catalog the searches below run against — the shapes BrowsePage already holds. */
const catalog = [
  { id: 'a', name: 'Nike Sneakers Size 42', category: 'Fashion', orderCount: 4 },
  { id: 'b', name: 'Hisense Fridge 180L', category: 'Home', orderCount: 9 },
  { id: 'c', name: 'Red Kettle 1.7L', category: 'Home', orderCount: 12 },
  { id: 'd', name: 'Solar Panel 100W', description: 'cheap and strong', category: 'Solar', orderCount: 0 },
  { id: 'e', name: 'Foldable Charger', description: 'solar panel compatible', category: 'Solar', orderCount: 0 },
  { id: 'f', name: 'Solar Panel', category: 'Solar', outOfStock: true, orderCount: 50 },
  { id: 'g', name: 'Solar Panel', category: 'Solar', orderCount: 0 },
]
const ids = rows => rows.map(p => p.id)

check('one typo does not lose the sale', () => {
  assert.deepStrictEqual(ids(rankProducts(catalog, 'sneekers')), ['a'])
  assert.strictEqual(matchTier('Nike Sneakers Size 42', 'sneekers'), 0.5)
})

check('a different word for the same thing still finds it', () => {
  assert.deepStrictEqual(ids(rankProducts(catalog, 'fridge')), ['b'])
  assert.ok(tokenVariants('fridge').includes('refrigerator'))
})

check('every word in the query has to match — "red shoes" never returns a red kettle', () => {
  assert.deepStrictEqual(ids(rankProducts(catalog, 'red shoes')), [])
  assert.deepStrictEqual(ids(rankProducts(catalog, 'red kettle')), ['c'])
})

check('where it matched decides the order: the name beats the description', () => {
  assert.deepStrictEqual(ids(rankProducts(catalog, 'solar panel')), ['g', 'd', 'e', 'f'])
  // 'e' matches only in the description, so it travels behind both name matches — and 'f', the
  // busiest listing in the catalog, still comes last because nobody can buy it today.
})

check('something you can buy today beats the same thing you cannot', () => {
  // Identical listings except for stock — out of stock is still found, just never first.
  const both = rankProducts(catalog, 'solar panel').filter(p => p.name === 'Solar Panel')
  assert.deepStrictEqual(ids(both), ['g', 'f'])
  assert.ok(productScore({ name: 'Solar Panel' }, 'solar panel') >
    productScore({ name: 'Solar Panel', outOfStock: true }, 'solar panel'))
})

check('what has sold before breaks a tie, and never decides one', () => {
  const bestSellers = [
    { id: 'x', name: 'Anker Power Bank', orderCount: 0 },
    { id: 'y', name: 'Anker Power Bank', orderCount: 30 },
  ]
  assert.deepStrictEqual(ids(rankProducts(bestSellers, 'power bank')), ['y', 'x'])
  assert.strictEqual(popularity({ orderCount: 2, salesCount: 3 }), 5)
  // A weak match does not outrank a strong one just because it is in a busy shop.
  const weakButPopular = { name: 'Cheap things', description: 'we also sell solar panels sometimes', orderCount: 100 }
  assert.ok(productScore(catalog[3], 'solar panel') > productScore(weakButPopular, 'solar panel'))
})

check('an empty query is not a search — the list comes back untouched', () => {
  const rows = rankProducts(catalog, '   ')
  assert.deepStrictEqual(ids(rows), ids(catalog))
  assert.notStrictEqual(rows, catalog)   // a copy: the page's own array is never re-ordered
})

check('a query of pure filler is still searched, not ignored', () => {
  assert.deepStrictEqual(queryTokens('the of'), ['the', 'of'])
  assert.deepStrictEqual(queryTokens('shoes for men'), ['shoes', 'men'])
  assert.deepStrictEqual(queryTokens('Sneakers, SNEAKERS and shoes'), ['sneakers', 'shoes'])
  assert.strictEqual(normalise('  Power-Bank  (20,000mAh) '), 'power bank 20 000mah')
})

check('plurals are one idea, not two', () => {
  assert.strictEqual(stem('shoes'), 'shoe')
  assert.strictEqual(stem('phones'), 'phone')
  assert.strictEqual(stem('glass'), 'glass')       // 'ss' is not a plural
  assert.strictEqual(stem('tv'), 'tv')
  assert.deepStrictEqual(ids(rankProducts(catalog, 'sneaker')), ['a'])
})

check('short words get no typo allowance, long ones get two', () => {
  assert.strictEqual(typoBudget('tv'), 0)
  assert.strictEqual(typoBudget('bag'), 0)          // at three letters a typo is a different word
  assert.strictEqual(typoBudget('shoe'), 1)         // four letters is already enough for one slip
  assert.strictEqual(typoBudget('charger'), 1)
  assert.strictEqual(typoBudget('refrigerator'), 2)
  assert.strictEqual(editDistance('charger', 'changer', 2), 1)
  assert.ok(editDistance('charger', 'refrigerator', 2) > 2)   // capped, never a huge number
})

check('"did you mean" is built from words the market really uses', () => {
  const vocab = vocabularyFrom(catalog)
  assert.deepStrictEqual(didYouMean('sneekers', vocab), ['sneakers'])
  assert.deepStrictEqual(didYouMean('shoes', vocab), [])      // already a real word
  assert.deepStrictEqual(didYouMean('', vocab), [])
  assert.ok(vocab.every(word => word.length >= 4))            // we never correct to a stub
  assert.strictEqual(new Set(vocab).size, vocab.length)       // and never to a repeat
})

check('a useless "did you mean" is not offered at all', () => {
  // Nothing here is close to "qqqqq", so we say nothing rather than guess at something.
  assert.deepStrictEqual(didYouMean('qqqqq', vocabularyFrom(catalog)), [])
})

check('the result line is written from what the page is about to draw', () => {
  assert.strictEqual(searchLine(0, 'sneekers'), 'Nothing here matches “sneekers” yet.')
  assert.strictEqual(searchLine(1, 'fridge'), '1 result for “fridge”')
  assert.strictEqual(searchLine(7, 'solar panel'), '7 results for “solar panel”')
  assert.strictEqual(searchLine(0, '   '), '')
})

check('the dead end is never a dead end', () => {
  const vocab = vocabularyFrom(catalog)
  const corrected = emptySearchHelp('sneekers', vocab)
  assert.strictEqual(corrected.suggestion, 'sneakers')
  assert.ok(corrected.title.includes('sneakers'))
  assert.ok(corrected.note.length > 0)

  const stuck = emptySearchHelp('qqqqq', vocab)
  assert.strictEqual(stuck.suggestion, '')
  assert.ok(stuck.title.includes('qqqqq'))
  assert.ok(stuck.note.includes('fridge'))              // offers the words a seller would use
})

check('no word is left belonging to two different meanings', () => {
  const owner = new Map()
  for (const group of SYNONYM_GROUPS) {
    assert.ok(group.length >= 2, `"${group[0]}" is a group of one`)
    for (const member of group) {
      const word = stem(member)
      assert.ok(word.length > 0)
      if (owner.has(word)) {
        // A plural inside its own group ("brake" / "brakes") is harmless; two groups is a bug.
        assert.strictEqual(owner.get(word), group[0], `"${word}" is in two groups`)
        continue
      }
      owner.set(word, group[0])
    }
  }
  // Every group is reachable from any of its own words, which is what makes it a group.
  for (const group of SYNONYM_GROUPS) {
    const variants = tokenVariants(group[group.length - 1])
    for (const member of group) assert.ok(variants.includes(stem(member)), `${group[0]} ⇄ ${member}`)
  }
})

console.log('\n' + checks + ' search-rank checks passed')
