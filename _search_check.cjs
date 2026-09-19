/**
 * Dev-only harness for the rolling search hint (`src/searchPlaceholder.ts`).
 *
 *   npx tsc --ignoreConfig src/searchPlaceholder.ts --outDir _dsbuild --module commonjs --target es2020 --skipLibCheck
 *   Move-Item -Force _dsbuild/searchPlaceholder.js _dsbuild/searchPlaceholder.cjs
 *   node _search_check.cjs
 *
 * Pins the promise the app makes in words ("only shops and products that exist on rachett"):
 * 4 products + 2 shops, never a repeat inside a round, a fresh sample next round, and a
 * graceful fallback when a page has nothing to roll.
 */
const assert = require('assert')
const path = require('path')
const {
  buildPlaceholderPool,
  nextPlaceholderBatch,
  placeholderAt,
  PLACEHOLDER_PRODUCTS,
  PLACEHOLDER_STORES,
  PLACEHOLDER_ROUND,
} = require(path.join(__dirname, '_dsbuild', 'searchPlaceholder.cjs'))

let checks = 0
const check = (name, fn) => { fn(); checks++; console.log('  ok  ' + name) }

const pool = buildPlaceholderPool({
  products: ['Kitenge Dress', 'Nike Air', 'Samsung charger', 'Fresh coffee', 'Leather Bag', 'Rice 5kg'],
  stores: ['Aisha Fabrics', 'Kicks Uganda', 'Gadget Hub', 'Nakawa Tools'],
})

check('the pool is trimmed, de-duplicated and stable', () => {
  const messy = buildPlaceholderPool({
    products: ['  Kitenge Dress ', 'kitenge dress', '', '   ', undefined, null, 'Nike Air'],
    stores: ['Aisha Fabrics', 'aisha fabrics'],
  })
  assert.deepStrictEqual(messy.products, ['Kitenge Dress', 'Nike Air'])
  assert.deepStrictEqual(messy.stores, ['Aisha Fabrics'])
})

check('a round is 4 products + 2 shops', () => {
  const batch = nextPlaceholderBatch(pool, 1)
  assert.strictEqual(batch.length, PLACEHOLDER_ROUND)
  assert.strictEqual(PLACEHOLDER_PRODUCTS, 4)
  assert.strictEqual(PLACEHOLDER_STORES, 2)
  const shopsShown = batch.filter(name => pool.stores.includes(name)).length
  assert.strictEqual(shopsShown, 2)
})

check('no name is repeated inside one round', () => {
  for (let seed = 1; seed <= 25; seed++) {
    const batch = nextPlaceholderBatch(pool, seed)
    assert.strictEqual(new Set(batch).size, batch.length, `seed ${seed} repeated a name`)
  }
})

check('shops are spread through the round, not bunched at the end', () => {
  const batch = nextPlaceholderBatch(pool, 3)
  const firstShop = batch.findIndex(name => pool.stores.includes(name))
  const lastProduct = [...batch].reverse().findIndex(name => pool.products.includes(name))
  assert.ok(firstShop > -1 && firstShop < batch.length - 1, 'a shop should not be last-only')
  assert.strictEqual(lastProduct, 0, 'the round should end on a product (p p s p s p)')
})

check('the next round brings FRESH names from the same list', () => {
  const first = nextPlaceholderBatch(pool, 0)
  const second = nextPlaceholderBatch(pool, 1)
  assert.notDeepStrictEqual(first, second)
  // The pool has more products than one round can show, so a later round can reach the rest.
  const seen = new Set([...first, ...second])
  assert.ok(seen.size > PLACEHOLDER_ROUND)
})

check('the same seed always gives the same round (no flicker on re-render)', () => {
  assert.deepStrictEqual(nextPlaceholderBatch(pool, 7), nextPlaceholderBatch(pool, 7))
})

check('a short list simply yields a short round', () => {
  const tiny = buildPlaceholderPool({ products: ['One Item'], stores: ['One Shop'] })
  const batch = nextPlaceholderBatch(tiny, 2)
  assert.strictEqual(batch.length, 2)
  assert.ok(batch.includes('One Item') && batch.includes('One Shop'))
  assert.deepStrictEqual(nextPlaceholderBatch(buildPlaceholderPool({}), 1), [])
})

check('Browse and Nearby roll DIFFERENT names because they are handed different lists', () => {
  // Browse: the whole catalog and shops directory.
  const browse = nextPlaceholderBatch(pool, 5)
  // Nearby: only what is inside the buyer's distance.
  const nearbyPool = buildPlaceholderPool({
    products: ['Boda helmet', 'Sukuma wiki', 'Maize flour', 'Phone repair', 'Charcoal Stove'],
    stores: ['Kampala Tools', 'Nakawa Fabrics'],
  })
  const nearby = nextPlaceholderBatch(nearbyPool, 5)
  assert.ok(nearby.every(name => name !== undefined))
  assert.ok(nearby.includes('Boda helmet') || nearby.includes('Sukuma wiki'))
  assert.strictEqual(nearby.some(name => pool.stores.includes(name) && !nearbyPool.stores.includes(name)), false)
  assert.notDeepStrictEqual(browse, nearby)
})

check('the shown name always exists — never a blank hint', () => {
  const batch = nextPlaceholderBatch(pool, 4)
  assert.ok(batch.includes(placeholderAt(batch, 0, 'fallback')))
  assert.ok(batch.includes(placeholderAt(batch, 5, 'fallback')))
  assert.ok(batch.includes(placeholderAt(batch, 6, 'fallback')))   // wraps into the next round
  assert.strictEqual(placeholderAt([], 3, 'Search products, stores...'), 'Search products, stores...')
  assert.strictEqual(placeholderAt(batch, 0, 'x').length > 0, true)
})

console.log('\n' + checks + ' search-hint checks passed')
