/**
 * Dev-only harness for the market's sort (`src/browseSort.ts`).
 *
 *   npx tsc --ignoreConfig src/browseSort.ts --outDir _dsbuild --module commonjs --target es2020 --skipLibCheck
 *   Move-Item -Force _dsbuild/browseSort.js _dsbuild/browseSort.cjs
 *   node _browse_sort_check.cjs
 *
 * Pins what a buyer is actually promised when they pick a sort: "Popular" is everything a listing has
 * moved, "Trending" is movement per freshness (so this week's orders count for more than last year's),
 * dead stock never outranks something selling, an unknown distance goes last instead of being invented
 * as zero, and the location ask only appears for the one sort that needs it.
 */
const assert = require('assert')
const path = require('path')
const {
  SORT_KEYS,
  SORT_LABELS,
  NEARBY_NO_AREA_HINT,
  TRENDING_HALF_LIFE_DAYS,
  priceNumber,
  listedMs,
  popularScore,
  trendingScore,
  distanceToSeller,
  sortProducts,
  nearbyNeedsArea,
  sortWords,
  distanceWords,
  sellerGeoFrom,
  sellerDirectoryFrom,
} = require(path.join(__dirname, '_dsbuild', 'browseSort.cjs'))

let checks = 0
const check = (name, fn) => { fn(); checks++; console.log('  ok  ' + name) }

const DAY = 24 * 60 * 60 * 1000
/** A fixed clock, so nothing here depends on the day the harness is run. */
const NOW = Date.parse('2026-09-29T09:00:00Z')
const daysAgo = (n) => new Date(NOW - n * DAY).toISOString()

/** Kampala and two points around it, so distances are real distances. */
const KAMPALA = { lat: 0.3476, lng: 32.5825 }
const NAKAWA = { lat: 0.3667, lng: 32.6167 }   // ~4 km east
const ENTEBBE = { lat: 0.0512, lng: 32.4637 }  // ~35 km south

const p = (over = {}) => ({ id: over.id || 'p', sellerId: over.sellerId || 's', price: '10000', ...over })

check('every offered sort is one of the seven, in the order the select shows them', () => {
  assert.deepStrictEqual(SORT_KEYS, ['relevance', 'price-asc', 'price-desc', 'popular', 'trending', 'newest', 'nearby'])
  SORT_KEYS.forEach(key => assert.ok(SORT_LABELS[key] && SORT_LABELS[key].startsWith('Sort:'), key + ' has no words'))
  assert.strictEqual(new Set(SORT_KEYS).size, SORT_KEYS.length)
})

check('"Most Popular" keeps the price-words label the page already showed', () => {
  assert.strictEqual(SORT_LABELS['price-asc'], 'Sort: Price (Low → High)')
  assert.strictEqual(SORT_LABELS['price-desc'], 'Sort: Price (High → Low)')
  assert.strictEqual(SORT_LABELS.popular, 'Sort: Most Popular')
  assert.strictEqual(SORT_LABELS.relevance, 'Sort: Relevance')
})

check('a price reads the same way everywhere — commas and currency words are not numbers', () => {
  assert.strictEqual(priceNumber('40,000'), 40000)
  assert.strictEqual(priceNumber('UGX 12,500'), 12500)
  assert.strictEqual(priceNumber(''), 0)
  assert.strictEqual(priceNumber(undefined), 0)
  assert.strictEqual(priceNumber('free'), 0)
})

check('a listing date is read from whatever shape the document holds', () => {
  assert.strictEqual(listedMs({ createdAtMs: 1234 }), 1234)
  assert.strictEqual(listedMs({ createdAt: 4321 }), 4321)
  assert.strictEqual(listedMs({ createdAt: '2026-09-01T00:00:00Z' }), Date.parse('2026-09-01T00:00:00Z'))
  assert.strictEqual(listedMs({ createdAt: { seconds: 5, nanoseconds: 0 } }), 5000)
  assert.strictEqual(listedMs({ createdAt: { toDate: () => new Date(9000) } }), 9000)
  assert.strictEqual(listedMs({}), 0)
  assert.strictEqual(listedMs({ createdAt: 'not a date' }), 0)
})

check('popular is what has moved: an order counts double, a sale counts once', () => {
  assert.strictEqual(popularScore({ orderCount: 3, salesCount: 2 }), 8)
  assert.strictEqual(popularScore({}), 0)
  assert.strictEqual(popularScore({ orderCount: '4' }), 8)
})

check('a product nobody has bought trends at zero — never a small score to hide behind', () => {
  assert.strictEqual(trendingScore(p({ orderCount: 0, salesCount: 0, createdAt: daysAgo(1) }), NOW), 0)
  assert.strictEqual(trendingScore(p({ createdAt: daysAgo(1) }), NOW), 0)
})

check('trending decays with shelf life: the same orders count for less as a listing ages', () => {
  const fresh = trendingScore(p({ orderCount: 1, createdAt: daysAgo(0) }), NOW)
  const oneMonth = trendingScore(p({ orderCount: 1, createdAt: daysAgo(TRENDING_HALF_LIFE_DAYS) }), NOW)
  const old = trendingScore(p({ orderCount: 1, createdAt: daysAgo(365) }), NOW)
  assert.ok(fresh > oneMonth && oneMonth > old, `${fresh} / ${oneMonth} / ${old}`)
  assert.ok(Math.abs(oneMonth / fresh - 0.5) < 0.05, 'a month should halve it')
})

check('a listing with no date sits in the middle — never treated as brand new', () => {
  const fresh = trendingScore(p({ orderCount: 1, createdAt: daysAgo(0) }), NOW)
  const undated = trendingScore(p({ orderCount: 1 }), NOW)
  const stale = trendingScore(p({ orderCount: 1, createdAt: daysAgo(365) }), NOW)
  assert.ok(undated < fresh, 'an unknown date must not read as today')
  assert.ok(undated > stale, 'nor as abandoned — we simply do not know')
  assert.ok(Math.abs(undated / fresh - 0.5) < 0.05, 'the middle of the curve is the half-life')
})

check('this week\'s orders beat last year\'s, even though last year moved more', () => {
  const thisWeek = p({ id: 'fresh', orderCount: 6, createdAt: daysAgo(3) })
  const lastYear = p({ id: 'stale', orderCount: 40, createdAt: daysAgo(365) })
  assert.strictEqual(sortProducts([lastYear, thisWeek], 'trending')[0].id, 'fresh')
  // …while "Most Popular" still honours the bigger total: two different promises.
  assert.strictEqual(sortProducts([lastYear, thisWeek], 'popular')[0].id, 'stale')
})

check('untouched listings never outrank something that is selling', () => {
  const selling = p({ id: 'selling', orderCount: 1, createdAt: daysAgo(200) })
  const dead = p({ id: 'dead', orderCount: 0, createdAt: daysAgo(0) })
  assert.strictEqual(sortProducts([dead, selling], 'trending')[0].id, 'selling')
})

check('among things nobody has bought, newest comes first — the one honest tie-break', () => {
  const newer = p({ id: 'newer', createdAt: daysAgo(1) })
  const older = p({ id: 'older', createdAt: daysAgo(90) })
  assert.strictEqual(sortProducts([older, newer], 'trending')[0].id, 'newer')
})

check('"relevance" is left exactly as the page ranked it, and nothing is mutated', () => {
  const list = [p({ id: 'a' }), p({ id: 'b', price: '1' }), p({ id: 'c' })]
  const sorted = sortProducts(list, 'relevance')
  assert.deepStrictEqual(sorted.map(x => x.id), ['a', 'b', 'c'])
  assert.notStrictEqual(sorted, list, 'a copy must come back, not the same array')
  sortProducts(list, 'price-asc')
  assert.deepStrictEqual(list.map(x => x.id), ['a', 'b', 'c'], 'the page\'s own array was reordered')
})

check('price and newest sorts do what they say', () => {
  const cheap = p({ id: 'cheap', price: '9,000' })
  const dear = p({ id: 'dear', price: '50000' })
  assert.deepStrictEqual(sortProducts([dear, cheap], 'price-asc').map(x => x.id), ['cheap', 'dear'])
  assert.deepStrictEqual(sortProducts([cheap, dear], 'price-desc').map(x => x.id), ['dear', 'cheap'])
  const old = p({ id: 'old', createdAt: daysAgo(30) })
  const fresh = p({ id: 'fresh', createdAt: daysAgo(0) })
  assert.deepStrictEqual(sortProducts([old, fresh], 'newest').map(x => x.id), ['fresh', 'old'])
})

check('a distance needs both points — one missing means we do not know it', () => {
  const geo = new Map([['near', NAKAWA], ['far', ENTEBBE]])
  const nearKm = distanceToSeller('near', KAMPALA, geo)
  const farKm = distanceToSeller('far', KAMPALA, geo)
  assert.ok(nearKm > 3 && nearKm < 6, 'expected ~4 km, got ' + nearKm)
  assert.ok(farKm > 30 && farKm < 40, 'expected ~35 km, got ' + farKm)
  assert.strictEqual(distanceToSeller('near', null, geo), null, 'no buyer area = no claim')
  assert.strictEqual(distanceToSeller('unknown-shop', KAMPALA, geo), null)
  assert.strictEqual(distanceToSeller('near', KAMPALA, null), null)
  assert.strictEqual(distanceToSeller(undefined, KAMPALA, geo), null)
})

check('nearby puts the closest shop first and everything we cannot place last', () => {
  const geo = new Map([['near', NAKAWA], ['far', ENTEBBE]])
  const list = [
    p({ id: 'unplaced', sellerId: 'no-pin' }),
    p({ id: 'very-far', sellerId: 'far' }),
    p({ id: 'close', sellerId: 'near' }),
    p({ id: 'also-unplaced', sellerId: 'no-pin-2' }),
  ]
  const sorted = sortProducts(list, 'nearby', { buyer: KAMPALA, sellerGeo: geo })
  assert.deepStrictEqual(sorted.map(x => x.id), ['close', 'very-far', 'unplaced', 'also-unplaced'])
})

check('nearby with no area changes nothing rather than inventing distances', () => {
  const list = [p({ id: 'a', sellerId: 'near' }), p({ id: 'b', sellerId: 'far' })]
  const geo = new Map([['near', NAKAWA], ['far', ENTEBBE]])
  const sorted = sortProducts(list, 'nearby', { buyer: null, sellerGeo: geo })
  assert.deepStrictEqual(sorted.map(x => x.id), ['a', 'b'], 'relevance order is the safe fallback')
})

check('the location ask appears only for the sort that needs it', () => {
  assert.strictEqual(nearbyNeedsArea('nearby', false), true)
  assert.strictEqual(nearbyNeedsArea('nearby', true), false)
  ;['relevance', 'price-asc', 'price-desc', 'popular', 'trending', 'newest'].forEach(key => {
    assert.strictEqual(nearbyNeedsArea(key, false), false, key + ' must never ask for location')
  })
  assert.ok(NEARBY_NO_AREA_HINT.includes('this phone'), 'the ask must say where the area is kept')
})

check('a sort that needs explaining explains itself, and the quiet ones stay quiet', () => {
  assert.ok(sortWords('trending').includes('moving'))
  assert.ok(sortWords('popular').includes('moved'))
  assert.ok(sortWords('nearby').includes('Closest'))
  assert.strictEqual(sortWords('newest'), '')
  assert.strictEqual(sortWords('relevance'), '')
})

check('a distance is said the way a person says it, and never invented', () => {
  assert.strictEqual(distanceWords(null), '')
  assert.strictEqual(distanceWords(Number.NaN), '')
  assert.strictEqual(distanceWords(0.4), 'less than 1 km away')
  assert.strictEqual(distanceWords(4.24), '4.2 km away')
  assert.strictEqual(distanceWords(35.6), '36 km away')
})

check('a shop with no real pin is unknown, never a shop in the Gulf of Guinea', () => {
  const geo = sellerGeoFrom([
    { id: 'good', geo: { lat: 0.3476, lng: 32.5825 } },
    { id: 'default-pin', geo: { lat: 0, lng: 0 } },
    { id: 'half', geo: { lat: 0.3 } },
    { id: 'junk', geo: { lat: 'north', lng: 'east' } },
    { id: 'empty' },
    { id: 'no-pin', geo: null },
    { geo: { lat: 1, lng: 1 } },
  ])
  assert.deepStrictEqual([...geo.keys()], ['good'])
  assert.deepStrictEqual(geo.get('good'), { lat: 0.3476, lng: 32.5825 })
  assert.strictEqual(sellerGeoFrom(null).size, 0)
  assert.strictEqual(sellerGeoFrom(undefined).size, 0)
  // A string pin from a document that stored it loosely still counts — it is a real place.
  assert.strictEqual(sellerGeoFrom([{ id: 's', geo: { lat: '1.5', lng: '2.5' } }]).get('s').lat, 1.5)
})

check('the same read also tells a page which shop to open and what to call it', () => {
  const { geo, stores } = sellerDirectoryFrom([
    { id: 's1', slug: 'amina', businessName: 'Amina Fabrics', geo: { lat: 0.3476, lng: 32.5825 } },
    { id: 's2', slug: '  kato  ', businessName: '', geo: { lat: 0, lng: 0 } },
    { id: 's3', slug: '', businessName: 'Nameless Shop' },
    { id: 's4', geo: { lat: 1, lng: 1 } },
    { id: '', slug: 'ghost' },
  ])
  assert.deepStrictEqual([...stores.keys()], ['s1', 's2', 's3'])
  assert.deepStrictEqual(stores.get('s1'), { id: 's1', slug: 'amina', businessName: 'Amina Fabrics', point: { lat: 0.3476, lng: 32.5825 } })
  assert.strictEqual(stores.get('s2').slug, 'kato', 'a slug is trimmed, never padded')
  assert.strictEqual(stores.get('s2').point, null, 'no usable pin means the shop is simply not placed')
  assert.strictEqual(stores.get('s3').businessName, 'Nameless Shop')
  // A shop with neither a slug nor a name tells the page nothing, and one with no id is nobody.
  assert.strictEqual(stores.has('s4'), false)
  assert.strictEqual(stores.has(''), false)
  assert.deepStrictEqual(geo, sellerGeoFrom([
    { id: 's1', slug: 'amina', businessName: 'Amina Fabrics', geo: { lat: 0.3476, lng: 32.5825 } },
    { id: 's2', slug: '  kato  ', businessName: '', geo: { lat: 0, lng: 0 } },
    { id: 's3', slug: '', businessName: 'Nameless Shop' },
    { id: 's4', geo: { lat: 1, lng: 1 } },
    { id: '', slug: 'ghost' },
  ]), 'one rule for pins: the directory and the old call cannot disagree')
  assert.strictEqual(sellerDirectoryFrom(null).stores.size, 0)
})

console.log(`\n${checks} browse-sort checks passed`)

