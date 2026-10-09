/**
 * Dev-only harness for the ⭐ shop rating — one number, one ruler, shown everywhere.
 *
 *   npx tsc --ignoreConfig src/sellerRatingUtils.ts src/reviewUtils.ts --outDir _dsbuild --module commonjs --target es2020 --skipLibCheck
 *   Copy-Item -Force _dsbuild/sellerRatingUtils.js _dsbuild/sellerRatingUtils.cjs
 *   Copy-Item -Force _dsbuild/reviewUtils.js _dsbuild/reviewUtils.cjs
 *   node _ratings_check.cjs
 *
 * Copy, not move, for `reviewUtils`: the compiled `buyerName.cjs` still asks for `./reviewUtils` with
 * no extension, and Node only resolves that to `reviewUtils.js` — renaming the helper away is what
 * makes `_name_check.cjs` fail to load before a single check has run.
 *
 * A shop's rating is the average of **every comment it has received**, and a comment is worth the
 * star its buyer tapped — one whole number from 1 to 5. Four places have a say in it, and none of
 * them can see the others at build time:
 *
 *   functions/sellerStats.js           isStar · LEGACY_REACTION_SCORES — what the server counts
 *   src/reviewUtils.ts                 isScore · legacyScore — what one star is, what a comment
 *                                      written in the ♥ era is still worth, and the counters the
 *                                      product's own line is drawn from
 *   src/sellerRatingUtils.ts           how the two fields on the seller document are read, and the
 *                                      shape of the number a surface prints
 *   functions/index.js / backfill      the trigger that recomputes it, and the walk for comments
 *                                      that were written before it existed
 *
 * Change the ruler in one of those and every shop on rachett is re-rated at once, silently — a
 * 4.4 shop becomes a 3.9 shop and no build log mentions it. So this file requires all of them and
 * compares them: the stars, the legacy taps they replaced, the rounding, what an unrated shop reads
 * as, and the wiring that puts the number on every card that names a shop.
 */
const assert = require('assert')
const fs = require('fs')
const path = require('path')

let checks = 0
const check = (name, fn) => {
  try {
    fn()
  } catch (err) {
    // Say *which* check failed. A harness that only prints a stack trace makes you go looking.
    console.error(`FAIL  ${name}`)
    err.message = `${name}\n    ${err.message}`
    throw err
  }
  checks++
  console.log('  ok  ' + name)
}

const BUILDS = ['sellerRatingUtils', 'reviewUtils']
const missing = BUILDS.filter(name => !fs.existsSync(path.join(__dirname, '_dsbuild', `${name}.cjs`)))
if (missing.length) {
  console.error(`\n  _dsbuild/${missing.map(n => `${n}.cjs`).join(' and _dsbuild/')} missing. Build first:\n`)
  console.error('    npx tsc --ignoreConfig src/sellerRatingUtils.ts src/reviewUtils.ts --outDir _dsbuild --module commonjs --target es2020 --skipLibCheck')
  BUILDS.forEach(name => console.error(`    Copy-Item -Force _dsbuild/${name}.js _dsbuild/${name}.cjs`))
  console.error('    node _ratings_check.cjs\n')
  process.exit(1)
}

const rating = require(path.join(__dirname, '_dsbuild', 'sellerRatingUtils.cjs'))
const reviews = require(path.join(__dirname, '_dsbuild', 'reviewUtils.cjs'))
const stats = require(path.join(__dirname, 'functions', 'sellerStats.js'))

const read = rel => fs.readFileSync(path.join(__dirname, rel), 'utf8')

/** A comment as Firestore would hold it: a star, an old reaction, or neither. */
const comment = reaction => ({ reaction })
const rated = score => ({ score })

// ── the ruler: what one star is worth ──────────────────────────────────────────────────────────

check('a star is one whole number from 1 to 5, and both sides read it the same', () => {
  assert.strictEqual(stats.STAR_MIN, 1)
  assert.strictEqual(stats.STAR_MAX, 5)
  // The stars a buyer can tap (`SCORES`) and the whole numbers the server counts must be the same
  // set: a star the server cannot count would be a rating that counts for nothing at all.
  assert.deepStrictEqual(reviews.SCORES, [1, 2, 3, 4, 5])
  reviews.SCORES.forEach(star => {
    assert.strictEqual(reviews.isScore(star), true)
    assert.strictEqual(stats.isStar(star), true)
    assert.strictEqual(stats.reviewScore(rated(star)), star,
      `★ ${star} counts as ${stats.reviewScore(rated(star))} on the shop`)
  })
  ;[0, 6, 4.5, -1, '5', null, undefined, Number.NaN].forEach(junk => {
    assert.strictEqual(reviews.isScore(junk), false, `${String(junk)} is not a star to a buyer`)
    assert.strictEqual(stats.isStar(junk), false, `${String(junk)} is not a star to the server`)
    assert.strictEqual(stats.reviewScore(rated(junk)), null, `${String(junk)} must count for nothing`)
  })
})

check("the taps of the old ♥ era are still worth what they always were", () => {
  assert.deepStrictEqual(
    stats.LEGACY_REACTION_SCORES,
    { love: 5, fine: 3, bad: 1 },
    "the server's legacy table changed — every shop on rachett is re-rated by this line",
  )
  Object.entries(stats.LEGACY_REACTION_SCORES).forEach(([reaction, worth]) => {
    assert.strictEqual(reviews.legacyScore(reaction), worth,
      `${reaction} is worth ${reviews.legacyScore(reaction)} to the comment and ${worth} to the shop`)
    assert.strictEqual(reviews.scoreOfReview(comment(reaction)), worth,
      `a comment with reaction "${reaction}" is not read the way it always was`)
    assert.strictEqual(stats.reviewScore(comment(reaction)), worth,
      `a comment with reaction "${reaction}" is not scored the way the shop always scored it`)
  })
  assert.strictEqual(reviews.legacyScore('meh'), null)
  assert.strictEqual(stats.reviewScore(comment('meh')), null)
})

check('one comment counts once, on the star it was stored with, and junk counts for nothing', () => {
  // The stored `score` is what the product's own counters were moved by (`useProductReviews.ts`),
  // so reading *it* keeps the shop average and those counters on the same ruler.
  assert.strictEqual(stats.reviewScore({ reaction: 'love', score: 4 }), 4)
  assert.strictEqual(stats.reviewScore(comment('love')), 5)
  assert.strictEqual(stats.reviewScore(comment('fine')), 3)
  assert.strictEqual(stats.reviewScore(comment('bad')), 1)
  // A comment nobody can score is left out entirely — one comment fewer beats a number nobody can
  // explain, and it must never be counted as a zero.
  assert.strictEqual(stats.reviewScore({}), null)
  assert.strictEqual(stats.reviewScore(null), null)
  assert.strictEqual(stats.reviewScore({ score: '5' }), null, 'a score that is not a number is not a score')
  assert.strictEqual(stats.reviewScore({ score: Number.NaN }), null)
  assert.strictEqual(stats.reviewScore({ score: 9, reaction: 'bad' }), 1, 'a stored score outside 1–5 falls back to the tap')
  assert.strictEqual(stats.reviewScore({ score: 0, reaction: 'fine' }), 3)
})

// ── the math: many comments become one number ─────────────────────────────────────────────────

check('the average is what the comments were worth, and nothing invented', () => {
  assert.deepStrictEqual(stats.ratingFromReviews([]), { count: 0, sum: 0, avg: null })
  assert.deepStrictEqual(
    stats.ratingFromReviews(Array(6).fill(rated(5))),
    { count: 6, sum: 30, avg: 5 },
  )
  const mixed = stats.ratingFromReviews([rated(5), rated(4), rated(3), rated(1), rated(2)])
  assert.strictEqual(mixed.count, 5)
  assert.strictEqual(mixed.sum, 15)
  assert.strictEqual(mixed.avg, 3)
})

check("the product's own line and the shop's average are the same number", () => {
  // The product's counters carry exactly what the shop adds up: the same stars, the same sum, the
  // same rounding (`reviewUtils.ts:averageOf` mirrors `sellerStats.js:ratingFromReviews`). If these
  // two ever disagree, a shop shows one average and its own product sheet another.
  const comments = [rated(5), rated(4), rated(3), rated(5), rated(2)]
  const shop = stats.ratingFromReviews(comments)
  const product = reviews.summaryFromAggregate(comments.length, shop.sum)
  assert.strictEqual(product.scoreSum, shop.sum)
  assert.strictEqual(product.average, shop.avg)
  assert.strictEqual(reviews.averageLabel(product), String(shop.avg))
  // The one case that separates the two roundings: 174 / 40 is 4.35, which a plain division prints
  // as 4.3 and whole-star rounding prints as 4.4.
  const forty = reviews.summaryFromAggregate(40, 174)
  const fortyComments = [...Array(27).fill(rated(5)), ...Array(13).fill(rated(3))]
  assert.strictEqual(stats.ratingFromReviews(fortyComments).avg, 4.4)
  assert.strictEqual(forty.average, 4.4, "a product must not print 4.3 beside its shop's 4.4")
})

/**
 * 27 five-star comments and 13 three-star ones — forty comments summing 174. Real ratings a real shop
 * could have received; the only reason they are here is that 174 / 40 is exactly 4.35.
 */
const FORTY = [...Array(27).fill(rated(5)), ...Array(13).fill(rated(3))]

check('the average is rounded from whole numbers, not from a float that can land a tenth low', () => {
  const shop = stats.ratingFromReviews(FORTY)
  assert.strictEqual(shop.count, 40)
  assert.strictEqual(shop.sum, 174)
  assert.strictEqual(shop.avg, 4.4, 'a shop that close to the line is owed the tenth')
  // Why the server rounds `sum * 10 / count` rather than the quotient: 4.35 is not a number a
  // double can hold, and the nearest one is a hair *below* it, so `toFixed(1)` reads 4.3.
  assert.strictEqual((174 / 40).toFixed(1), '4.3',
    'if this ever reads 4.4 the two paths agree by luck, and this check no longer proves anything')
  assert.strictEqual(rating.formatRatingValue(shop.avg), '4.4', 'the card must print the number the server rounded')
})

check('a shop nobody has rated has no average — never a flattering 0', () => {
  const none = stats.ratingFromReviews([])
  assert.strictEqual(none.avg, null)
  assert.strictEqual(none.count, 0)
  assert.deepStrictEqual(
    stats.ratingFromReviews([comment('meh'), {}, null, { score: 'x' }]),
    { count: 0, sum: 0, avg: null },
    'comments nobody can score were counted as worth something',
  )
  assert.strictEqual(stats.ratingFromReviews([comment('bad')]).avg, 1, 'the worst a shop can honestly be is 1.0')
  assert.strictEqual(stats.ratingFromReviews(undefined).avg, null, 'no comments at all is not an error')
})

// ── the reading rule: two fields become one rating, or nothing ────────────────────────────────

check('the two fields are read as one rating, or as nothing at all', () => {
  assert.deepStrictEqual(rating.sellerRatingOf({ ratingAvg: 4.7, ratingCount: 12 }), { count: 12, avg: 4.7 })
  assert.deepStrictEqual(rating.sellerRatingOf({ ratingAvg: '4.7', ratingCount: '3' }), { count: 3, avg: 4.7 },
    'a number that arrived as a string is still a number')
  // Half a rating is not a rating: an average with no count is “★ 4.7 from nobody”.
  assert.deepStrictEqual(rating.sellerRatingOf({ ratingAvg: 4.7 }), { count: 0, avg: null })
  assert.deepStrictEqual(rating.sellerRatingOf({ ratingCount: 12 }), { count: 0, avg: null })
  // Every shape the seller document can be in: a shop from before the rating existed, a shop the
  // backfill has visited, and a hole where the count should be.
  assert.deepStrictEqual(rating.sellerRatingOf({}), { count: 0, avg: null })
  assert.deepStrictEqual(rating.sellerRatingOf({ ratingAvg: null, ratingCount: 0 }), { count: 0, avg: null })
  assert.deepStrictEqual(rating.sellerRatingOf({ ratingAvg: 0, ratingCount: 5 }), { count: 0, avg: null },
    'a stored zero is a hole, not a one-star shop')
  assert.deepStrictEqual(rating.sellerRatingOf(null), { count: 0, avg: null })
  assert.deepStrictEqual(rating.sellerRatingOf(undefined), { count: 0, avg: null })
  // The two questions a surface asks: may I draw it, and is `avg` a number once I have?
  assert.strictEqual(rating.hasRating(rating.sellerRatingOf({ ratingAvg: 4.7, ratingCount: 12 })), true)
  assert.strictEqual(rating.hasSellerRating({ ratingAvg: 4.7, ratingCount: 12 }), true)
  assert.strictEqual(rating.hasSellerRating({ ratingAvg: 4.7 }), false)
  assert.strictEqual(rating.hasSellerRating({}), false)
})

check('the card prints the number the server rounded, to one decimal', () => {
  assert.strictEqual(rating.formatRatingValue(4.7), '4.7')
  assert.strictEqual(rating.formatRatingValue(5), '5.0')
  assert.strictEqual(rating.formatRatingValue(1), '1.0')
  assert.strictEqual(rating.formatRatingValue(Number.NaN), '')
  assert.strictEqual(rating.ratingCountLabel(1), '1 rating')
  assert.strictEqual(rating.ratingCountLabel(0), '0 ratings')
  assert.strictEqual(rating.ratingCountLabel(12), '12 ratings')
  assert.strictEqual(rating.ratingCountLabel(1, 'buyer rating'), '1 buyer rating')
  assert.strictEqual(rating.ratingCountLabel(12, 'buyer rating'), '12 buyer ratings')
})

// ── the wiring: the number is the server's, and every surface shows it ────────────────────────

check('the rating is produced by the server, from every comment in the shop', () => {
  const index = read('functions/index.js')
  assert.ok(/require\('\.\/sellerStats'\)/.test(index), 'index.js must use the shared sellerStats math')
  assert.ok(/exports\.recomputeSellerRating\s*=/.test(index),
    'the rating trigger must be exported, or nothing ever computes the number the cards read')
  assert.ok(
    /'sellers\/\{sellerId\}\/products\/\{productId\}\/reviews\/\{buyerUid\}'/.test(index),
    'the trigger must watch every comment in the shop, wherever in it a buyer commented',
  )
  assert.ok(/sellerStats\.ratingFromReviews\(/.test(index), 'the trigger must add the comments up with the shared math')
  ;['ratingAvg', 'ratingCount', 'ratingUpdatedAt'].forEach(key => {
    assert.ok(new RegExp(`${key}:`).test(index), `the trigger must write ${key} — the surfaces read exactly these`)
  })
})

check('the backfill adds up the same comments with the same ruler', () => {
  const backfill = read('functions/backfill-seller-ratings.js')
  assert.ok(/require\('\.\/sellerStats'\)/.test(backfill), 'the backfill must not carry a second copy of the ruler')
  assert.ok(/sellerStats\.ratingFromReviews\(/.test(backfill),
    'a comment written last month and one written today must be added up the same way')
  assert.ok(/ratingAvg: rating\.avg/.test(backfill) && /ratingCount: rating\.count/.test(backfill),
    'the backfill must write the two fields the cards read')
  assert.ok(/args\.includes\('--write'\)/.test(backfill), 'the backfill must print until it is told --write')
  // The second, optional pass: stamp `score` on the comments written in the ♥ era, so a document
  // says what it is worth instead of leaving a reader to infer it. It moves **no** number — every
  // reader already infers the same value — which is exactly why it is a flag of its own.
  assert.ok(/args\.includes\('--write-score'\)/.test(backfill), 'the score stamp is a separate, explicit flag')
  assert.ok(/module\.exports = \{[^}]*stampScores[^}]*\}/.test(backfill),
    'stampScores must be exported, so a harness can prove the stamp moves no number')
  assert.ok(!/ratingAvg:\s*[^,]*score/i.test(backfill), 'stamping a score must not recompute the shop average')
})

check('every surface that names a shop draws the same number', () => {
  // The two fields the chip reads have to be on the row type a surface hands over — `CardProduct`
  // is the one every product-shaped row already is, joined by its caller from the shop document.
  const row = read('src/productCardUtils.ts')
  assert.ok(/ratingAvg\?:/.test(row) && /ratingCount\?:/.test(row),
    "a product row no longer carries the shop's two fields, so a card cannot be handed them")

  const surfaces = [
    'src/ProductCard.tsx',
    'src/ProductSheet.tsx',
    'src/StoreCard.tsx',
    'src/NearbyPage.tsx',
    'src/BrowsePage.tsx',
    'src/StorePage.tsx',
  ]
  surfaces.forEach(rel => {
    const text = read(rel)
    assert.ok(/<SellerRating[\s\S]{0,80}?source=/.test(text), `${rel} names a shop but draws no rating`)
    // The row carrying the shop's fields: declared here, or the shared `CardProduct` it passes on.
    assert.ok(/ratingAvg|CardProduct/.test(text), `${rel} draws a rating from an object with no rating on it`)
    // It is a join of the shop's own fields — never a comment query, and never a sum worked out
    // here. One documented exception: the storefront's line for a shop the backfill has not visited
    // yet prints its fallback through `summaryLabel`, the very helper the product sheet uses, so it
    // cannot round the same comments a tenth differently from the shop they belong to.
    const worksOutItsOwn = /scoreOf\(|summaryOf\(/.test(text)
      || (/summaryFromAggregate\(/.test(text) && rel !== 'src/StorePage.tsx')
    assert.ok(!worksOutItsOwn, `${rel} works out an average of its own — the shop number is the server's`)
    assert.ok(!/collectionGroup\(|'reviews'/.test(text), `${rel} reads comments to draw a shop's rating`)
  })
  // The storefront is the one place with room to say it in words, and the one place that has to
  // choose between the shop's rating and the hearts line.
  assert.ok(/hasSellerRating\(/.test(read('src/StorePage.tsx')),
    'the storefront must ask whether there is a rating to show before reaching for the hearts')
})

check('the rating a surface shows is already on the shop document it is reading', () => {
  const hook = read('src/useSellerStats.ts')
  assert.ok(/data\.ratingAvg/.test(hook), "the hook must read the server's average")
  assert.ok(/data\.ratingCount/.test(hook), "the hook must read the server's count")
  assert.ok(/avgRating:/.test(hook) && /reviewCount:/.test(hook),
    'the two fields must reach the numbers the storefront already uses')
  assert.ok(!/collectionGroup\(/.test(hook), 'the rating must not be recomputed from comment reads in the browser')
})

/** Every .ts/.tsx under src/, however deep, as a path relative to src/. */
function srcFiles() {
  const out = []
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.tsx?$/.test(entry.name)) out.push(full)
    }
  }
  const root = path.join(__dirname, 'src')
  walk(root)
  return out.map(file => path.relative(root, file).replace(/\\/g, '/'))
}

check('one component draws the rating, so one shop cannot read two ways', () => {
  const files = srcFiles()
  assert.ok(files.length >= 40, `expected the app's source tree, found ${files.length} files`)
  const textOf = new Map(files.map(rel => [rel, read(path.join('src', rel))]))
  const importing = re => files.filter(rel => re.test(textOf.get(rel)))

  // The surfaces that name a shop — and no others, or a card somewhere has gone without.
  assert.deepStrictEqual(
    importing(/from '\.\/SellerRating'/).sort(),
    ['BrowsePage.tsx', 'NearbyPage.tsx', 'ProductCard.tsx', 'ProductSheet.tsx', 'StoreCard.tsx', 'StorePage.tsx'],
    'the list of surfaces showing a shop changed — check the new one draws the rating too',
  )
  // The reading rule is asked for in two places only: the one component that draws it, and the
  // storefront deciding between the rating and the hearts.
  assert.deepStrictEqual(
    importing(/from '\.\/sellerRatingUtils'/).sort(),
    ['SellerRating.tsx', 'StorePage.tsx'],
    'a third place reads the two fields — the rule belongs in sellerRatingUtils.ts',
  )
  // And the two fields become a number in exactly one place, so ★ 4.7 cannot read 4.8 next door.
  assert.deepStrictEqual(
    importing(/formatRatingValue\(/).sort(),
    ['SellerRating.tsx', 'sellerRatingUtils.ts'],
    'a screen decimals the rating itself — the shape of the number belongs in one place',
  )
})

console.log(`\n${checks} rating checks passed — one ruler, one number, every surface that names a shop.\n`)
