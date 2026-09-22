/**
 * Dev-only harness for the comment rules (`src/reviewUtils.ts`).
 *
 *   npx tsc --ignoreConfig src/reviewUtils.ts --outDir _dsbuild --module commonjs --target es2020 --skipLibCheck
 *   Move-Item -Force _dsbuild/reviewUtils.js _dsbuild/reviewUtils.cjs
 *   node _review_check.cjs
 *
 * Why this exists: these functions decide what a buyer is shown as, who is allowed to comment at
 * all, whether a bad comment is ever dressed up as a good one, and what a product may claim about
 * itself. A wrong answer here is a wrong reputation — and no build log would mention it.
 */
const assert = require('assert')
const path = require('path')
const {
  EDIT_WINDOW_HOURS,
  REVIEW_TAGS,
  averageLabel,
  canEdit,
  canPost,
  canReview,
  cleanReviewText,
  cleanTags,
  displayName,
  isReaction,
  reactionLabel,
  scoreOf,
  summaryFromAggregate,
  summaryLabel,
  summaryOf,
  timeAgo,
  toMillis,
} = require(path.join(__dirname, '_dsbuild', 'reviewUtils.cjs'))

let checks = 0
const check = (name, fn) => { fn(); checks++; console.log('  ok  ' + name) }
const review = (reaction, tags = [], text = '', buyerUid = 'u1') => ({ buyerUid, reaction, tags, text, orderId: 'o1' })

// -- the reaction, and what it is worth ------------------------------------------------------

check('three reactions, and only three', () => {
  assert.strictEqual(isReaction('love'), true)
  assert.strictEqual(isReaction('fine'), true)
  assert.strictEqual(isReaction('bad'), true)
  assert.strictEqual(isReaction('5'), false)
  assert.strictEqual(isReaction('LOVE'), false)
  assert.strictEqual(isReaction(undefined), false)
  assert.strictEqual(scoreOf('love'), 5)
  assert.strictEqual(scoreOf('fine'), 3)
  assert.strictEqual(scoreOf('bad'), 1)
  assert.strictEqual(reactionLabel('love'), 'Loved it')
  assert.strictEqual(reactionLabel('bad'), 'Not good')
})

// -- the chips are the countable half --------------------------------------------------------

check('only the chips we offer, never free text', () => {
  assert.deepStrictEqual(cleanTags(['Fast delivery', 'Good quality']), ['Fast delivery', 'Good quality'])
  assert.deepStrictEqual(cleanTags(['fast delivery']), ['Fast delivery'])
  assert.deepStrictEqual(cleanTags(['Cheap', 'Nice', 7, null]), [])
  assert.deepStrictEqual(cleanTags(['Fast delivery', 'Fast delivery']), ['Fast delivery'])
  assert.strictEqual(cleanTags(REVIEW_TAGS).length, 4)
  assert.deepStrictEqual(cleanTags('Fast delivery'), [])
})

// -- the words -------------------------------------------------------------------------------

check('the optional words are tidied, capped and never "undefined"', () => {
  assert.strictEqual(cleanReviewText('  Arrived   fast.  '), 'Arrived fast.')
  assert.strictEqual(cleanReviewText('line\u0000with\u0007junk'), 'line with junk')
  assert.strictEqual(cleanReviewText(''), '')
  assert.strictEqual(cleanReviewText(undefined), '')
  assert.strictEqual(cleanReviewText(42), '')
  assert.strictEqual(cleanReviewText('x'.repeat(500)).length, 400)
})

check('line breaks a buyer typed are kept, invisible junk is not', () => {
  assert.strictEqual(cleanReviewText('Good quality.\n\nPacked well.'), 'Good quality.\n\nPacked well.')
  assert.strictEqual(cleanReviewText('a\n\n\n\n\nb'), 'a\n\nb')
  assert.strictEqual(cleanReviewText('tab\there'), 'tab here')
})

check('a buyer is shown as a first name and an initial, never in full', () => {
  assert.strictEqual(displayName('Aisha Nabukeera'), 'Aisha N.')
  assert.strictEqual(displayName('Aisha'), 'Aisha')
  assert.strictEqual(displayName('  John  Paul  Otim  '), 'John O.')
  assert.strictEqual(displayName(''), 'Verified buyer')
  assert.strictEqual(displayName(undefined), 'Verified buyer')
  assert.strictEqual(displayName('\u{1F600}'), 'Verified buyer')
})

// -- what a product may claim about itself ---------------------------------------------------

check('an empty product claims nothing', () => {
  const empty = summaryOf([])
  assert.strictEqual(empty.count, 0)
  assert.strictEqual(empty.average, null)          // never 0, never a flattering 5
  assert.strictEqual(averageLabel(empty), '')
  assert.strictEqual(summaryLabel(empty), 'No comments yet')
})

check('the summary counts what people actually said', () => {
  const s = summaryOf([review('love'), review('love'), review('fine'), review('bad', [], '', 'u4')])
  assert.strictEqual(s.count, 4)
  assert.strictEqual(s.loved, 2)
  assert.strictEqual(s.fine, 1)
  assert.strictEqual(s.bad, 1)
  assert.strictEqual(s.scoreSum, 5 + 5 + 3 + 1)
  assert.strictEqual(s.average, 3.5)
  assert.strictEqual(averageLabel(s), '3.5')
  assert.strictEqual(summaryLabel(s), '2 of 4 loved it')
})

check('one comment is described honestly too', () => {
  assert.strictEqual(summaryLabel(summaryOf([review('love')])), '\u2665 Loved it')
  assert.strictEqual(summaryLabel(summaryOf([review('bad')])), '1 comment')
})

check('the chips people used most come first', () => {
  const s = summaryOf([
    review('love', ['Fast delivery', 'Good quality']),
    review('love', ['Fast delivery']),
    review('fine', ['Fair price']),
  ])
  assert.strictEqual(s.topTags[0], 'Fast delivery')
  assert.strictEqual(s.topTags.length, 3)
})

check('a product with no counters reads as no comments, not as a broken number', () => {
  const junk = summaryFromAggregate(undefined, 'x', null)
  assert.strictEqual(junk.count, 0)
  assert.strictEqual(junk.average, null)
  assert.strictEqual(summaryLabel(junk), 'No comments yet')
  const real = summaryFromAggregate(23, 108, 19)
  assert.strictEqual(real.count, 23)
  assert.strictEqual(real.loved, 19)
  assert.strictEqual(summaryLabel(real), '19 of 23 loved it')
  assert.strictEqual(averageLabel(real), '4.7')
})

check('a counter can never claim more loved than comments', () => {
  const impossible = summaryFromAggregate(3, 15, 99)
  assert.strictEqual(impossible.loved, 3)
  assert.strictEqual(summaryLabel(impossible), '3 of 3 loved it')
})

// -- who may write ---------------------------------------------------------------------------

check('delivery is the gate', () => {
  assert.strictEqual(canReview({ orderStatus: 'fulfilled', alreadyReviewed: false }).ok, true)
  assert.strictEqual(canReview({ orderStatus: 'pending', alreadyReviewed: false }).ok, false)
  assert.strictEqual(canReview({ orderStatus: 'paid', alreadyReviewed: false }).ok, false)
  assert.strictEqual(canReview({ orderStatus: undefined, alreadyReviewed: false }).ok, false)
  const failed = canReview({ orderStatus: 'out_of_stock', alreadyReviewed: false })
  assert.strictEqual(failed.ok, false)
  assert.ok(/could not be delivered/.test(failed.reason))
  assert.ok(/delivered/.test(canReview({ orderStatus: 'pending', alreadyReviewed: false }).reason))
})

check('one comment each, and never on your own product', () => {
  const twice = canReview({ orderStatus: 'fulfilled', alreadyReviewed: true })
  assert.strictEqual(twice.ok, false)
  assert.ok(/already had your say/.test(twice.reason))
  const mine = canReview({ orderStatus: 'fulfilled', alreadyReviewed: false, isSeller: true })
  assert.strictEqual(mine.ok, false)
  assert.ok(/your own product/.test(mine.reason))
})

check('a typo is fixable for one day, then it stands', () => {
  const now = 1800000000000
  assert.strictEqual(canEdit(now - 60 * 1000, now), true)
  assert.strictEqual(canEdit(now - (EDIT_WINDOW_HOURS - 1) * 3600 * 1000, now), true)
  assert.strictEqual(canEdit(now - (EDIT_WINDOW_HOURS + 1) * 3600 * 1000, now), false)
  assert.strictEqual(canEdit(undefined, now), false)
})

check('posting needs a reaction and the order that proves it', () => {
  assert.strictEqual(canPost({ reaction: 'love', orderId: 'abc' }), true)
  assert.strictEqual(canPost({ reaction: 'love', orderId: '' }), false)
  assert.strictEqual(canPost({ reaction: 'love', orderId: undefined }), false)
  assert.strictEqual(canPost({ reaction: 'whatever', orderId: 'abc' }), false)
  assert.strictEqual(canPost({ reaction: 'bad', orderId: 'abc', text: 'x'.repeat(401) }), false)
})

// -- timestamps ------------------------------------------------------------------------------

check('a comment says how fresh it is, in words', () => {
  const now = 1800000000000
  assert.strictEqual(timeAgo(now, now), 'just now')
  assert.strictEqual(timeAgo(now - 5 * 60 * 1000, now), '5 min ago')
  assert.strictEqual(timeAgo(now - 3 * 3600 * 1000, now), '3 hours ago')
  assert.strictEqual(timeAgo(now - 26 * 3600 * 1000, now), 'yesterday')
  assert.strictEqual(timeAgo(now - 10 * 24 * 3600 * 1000, now), 'last week')
  assert.strictEqual(timeAgo(now - 60 * 24 * 3600 * 1000, now), '2 months ago')
  assert.strictEqual(timeAgo(undefined, now), '')
  assert.strictEqual(timeAgo(now + 1000, now), 'just now')
})

check('Firestore timestamps, Dates, numbers - all understood, junk is not', () => {
  assert.strictEqual(toMillis({ toMillis: () => 1234 }), 1234)
  assert.strictEqual(toMillis(new Date(5000)), 5000)
  assert.strictEqual(toMillis(9000), 9000)
  assert.strictEqual(toMillis('yesterday'), undefined)
  assert.strictEqual(toMillis(null), undefined)
})

console.log(`\n${checks} checks passed \u2014 comments: reactions, chips, names, counters and who may write.\n`)

