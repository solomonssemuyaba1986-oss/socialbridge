/**
 * Dev-only harness for the comment rules (`src/reviewUtils.ts`).
 *
 *   npx tsc --ignoreConfig src/reviewUtils.ts --outDir _dsbuild --module commonjs --target es2020 --skipLibCheck
 *   Copy-Item -Force _dsbuild/reviewUtils.js _dsbuild/reviewUtils.cjs
 *   node _review_check.cjs
 *
 * Copy, not move: `buyerName.ts` imports `./reviewUtils`, so the compiled `buyerName.cjs` asks Node
 * for `./reviewUtils` with no extension — and Node only resolves that to `reviewUtils.js`. Moving the
 * helper away is what makes `_name_check.cjs` fail to load before a single check has run.
 *
 * Why this exists: a rating is one tap on a star, and every number rachett shows about a shop is a
 * sum of that one number. So this file checks the star itself (1–5, whole, and what a comment
 * written in the ♥/🙂/👎 era was always worth), what a product is allowed to claim, who may write,
 * who may *ask* — and, because the asking is spread over three screens and four moments, that all of
 * them go through the same gate and that the security rules still demand a star.
 */
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const {
  EDIT_WINDOW_HOURS,
  RATING_NUDGE_DAYS,
  REVIEW_TAGS,
  SCORES,
  SCORE_LABELS,
  averageLabel,
  canAskForRating,
  canEdit,
  canPost,
  canReview,
  cleanReviewText,
  cleanTags,
  displayName,
  isScore,
  legacyScore,
  postBlocker,
  scoreLabel,
  scoreOfReview,
  shouldNudgeRating,
  starRow,
  summaryFromAggregate,
  summaryLabel,
  summaryOf,
  timeAgo,
  toMillis,
} = require(path.join(__dirname, '_dsbuild', 'reviewUtils.cjs'))

let checks = 0
const check = (name, fn) => { fn(); checks++; console.log('  ok  ' + name) }
const review = (score, tags = [], text = '', buyerUid = 'u1') => ({ buyerUid, score, tags, text, orderId: 'o1' })
/** A comment written before stars existed: it carries a tapped reaction and no score at all. */
const oldComment = (reaction, buyerUid = 'u1') => ({ buyerUid, reaction, tags: [], text: '', orderId: 'o1' })
/** A file's text with line endings normalised, so a check about a line holds on Windows too. */
const read = rel => fs.readFileSync(path.join(__dirname, rel), 'utf8').replace(/\r\n/g, '\n')

// -- the star, and what it is worth ----------------------------------------------------------

check('five stars, and only five', () => {
  assert.deepStrictEqual(SCORES, [1, 2, 3, 4, 5])
  SCORES.forEach(star => assert.strictEqual(isScore(star), true))
  assert.strictEqual(isScore(0), false, 'a zero is "no rating", not the worst rating')
  assert.strictEqual(isScore(6), false)
  assert.strictEqual(isScore(4.5), false, 'half a star is a number nobody can average')
  assert.strictEqual(isScore('5'), false, "the rules ask for `is int` — a string would be refused")
  assert.strictEqual(isScore(null), false)
  assert.strictEqual(isScore(undefined), false)
  assert.strictEqual(isScore(Number.NaN), false)
})

check('a score says what it is worth, and a star row shows which star', () => {
  assert.strictEqual(SCORE_LABELS.length, 5)
  assert.strictEqual(scoreLabel(5), 'Loved it')
  assert.strictEqual(scoreLabel(3), 'It was fine')
  assert.strictEqual(scoreLabel(1), 'Not good')
  assert.strictEqual(scoreLabel(0), '')
  assert.strictEqual(scoreLabel('5'), '')
  assert.strictEqual(starRow(5), '\u2605\u2605\u2605\u2605\u2605')
  assert.strictEqual(starRow(3), '\u2605\u2605\u2605\u2606\u2606')
  assert.strictEqual(starRow(1), '\u2605\u2606\u2606\u2606\u2606')
  // Junk is drawn as five empty stars, never as five filled ones.
  assert.strictEqual(starRow(Number.NaN), '\u2606\u2606\u2606\u2606\u2606')
  assert.strictEqual(starRow('9').length, 5)
})

check('an old tap is worth the score it always meant', () => {
  assert.strictEqual(legacyScore('love'), 5)
  assert.strictEqual(legacyScore('fine'), 3)
  assert.strictEqual(legacyScore('bad'), 1)
  assert.strictEqual(legacyScore('LOVE'), null)
  assert.strictEqual(legacyScore('5'), null)
  assert.strictEqual(legacyScore(undefined), null)
})

check('the stored star wins; an old comment answers with its tap; junk counts for nothing', () => {
  assert.strictEqual(scoreOfReview({ score: 4 }), 4)
  assert.strictEqual(scoreOfReview({ score: 4, reaction: 'love' }), 4,
    'the stored star is the one the product counters were moved by')
  assert.strictEqual(scoreOfReview({ reaction: 'love' }), 5)
  assert.strictEqual(scoreOfReview({ reaction: 'bad' }), 1)
  assert.strictEqual(scoreOfReview({ score: 9, reaction: 'bad' }), 1, 'a star outside 1–5 falls back to the tap')
  assert.strictEqual(scoreOfReview({ score: '5', reaction: 'fine' }), 3)
  assert.strictEqual(scoreOfReview({}), null)
  assert.strictEqual(scoreOfReview(null), null)
  assert.strictEqual(scoreOfReview(undefined), null)
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
  assert.deepStrictEqual(empty.stars, [0, 0, 0, 0, 0])
  assert.strictEqual(averageLabel(empty), '')
  assert.strictEqual(summaryLabel(empty), 'No comments yet')
})

check('the summary counts what people actually said, star by star', () => {
  const s = summaryOf([review(5), review(5), review(4), review(1, [], '', 'u4')])
  assert.strictEqual(s.count, 4)
  assert.deepStrictEqual(s.stars, [1, 0, 0, 1, 2], 'stars[0] is 1\u2605 … stars[4] is 5\u2605')
  assert.strictEqual(s.scoreSum, 15)
  assert.strictEqual(s.average, 3.8, '15 over 4 is rounded to a tenth, the way the server rounds a shop')
  assert.strictEqual(averageLabel(s), '3.8')
  assert.strictEqual(summaryLabel(s), '\u2605 3.8 from 4 ratings')
})

check('one comment is described honestly too', () => {
  assert.strictEqual(summaryLabel(summaryOf([review(5)])), '\u2605 5.0 from 1 rating')
  assert.strictEqual(summaryLabel(summaryOf([review(1)])), '\u2605 1.0 from 1 rating')
})

check('a comment written before stars is counted as the tap it always was', () => {
  assert.strictEqual(summaryOf([oldComment('love')]).average, 5)
  const mixed = summaryOf([oldComment('bad'), review(3, [], '', 'u2')])
  assert.strictEqual(mixed.count, 2)
  assert.strictEqual(mixed.scoreSum, 4)
  assert.strictEqual(mixed.average, 2)
  assert.strictEqual(summaryLabel(mixed), '\u2605 2.0 from 2 ratings')
})

check('the chips people used most come first', () => {
  const s = summaryOf([
    review(5, ['Fast delivery', 'Good quality']),
    review(5, ['Fast delivery']),
    review(3, ['Fair price']),
  ])
  assert.strictEqual(s.topTags[0], 'Fast delivery')
  assert.strictEqual(s.topTags.length, 3)
})

check('a product with no counters reads as no comments, not as a broken number', () => {
  const junk = summaryFromAggregate(undefined, 'x')
  assert.strictEqual(junk.count, 0)
  assert.strictEqual(junk.scoreSum, 0)
  assert.strictEqual(junk.average, null)
  assert.strictEqual(summaryLabel(junk), 'No comments yet')
  // 23 comments adding up to 108 — the average is the counters', taken the same way as the comments'.
  const real = summaryFromAggregate(23, 108)
  assert.strictEqual(real.count, 23)
  assert.strictEqual(real.scoreSum, 108)
  assert.strictEqual(averageLabel(real), '4.7')
  assert.strictEqual(summaryLabel(real), '\u2605 4.7 from 23 ratings')
})

check('a product and its shop round the same comments the same way', () => {
  const page = summaryOf([review(1), review(1)])
  // 40 comments adding up to 174 — the case that separates the two roundings: 174/40 is 4.35, which
  // a plain division prints as 4.3 and the server's whole-star rounding prints as 4.4. Both sides
  // must say 4.4, or a shop would show one average and its own product another.
  const counters = summaryFromAggregate(40, 174)
  assert.strictEqual(page.average, 1, 'the page of comments we loaded is not the whole story')
  assert.strictEqual(counters.average, 4.4)
  assert.strictEqual(summaryLabel(counters), '\u2605 4.4 from 40 ratings')
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

check('posting needs a star and the order that proves it', () => {
  assert.strictEqual(canPost({ score: 5, orderId: 'abc' }), true)
  assert.strictEqual(canPost({ score: 1, orderId: 'abc' }), true, 'the worst rating is postable too')
  assert.strictEqual(canPost({ score: 5, orderId: '' }), false)
  assert.strictEqual(canPost({ score: 5, orderId: undefined }), false)
  assert.strictEqual(canPost({ orderId: 'abc' }), false, 'no star, no comment')
  assert.strictEqual(canPost({ score: '5', orderId: 'abc' }), false)
  assert.strictEqual(canPost({ score: 4.5, orderId: 'abc' }), false)
  assert.strictEqual(canPost({ score: 0, orderId: 'abc' }), false)
  assert.strictEqual(canPost({ score: 1, orderId: 'abc', text: 'x'.repeat(401) }), false)
})

check('the buyer is told what is missing, in their own words', () => {
  assert.strictEqual(postBlocker({ score: 5, orderId: 'abc' }), '')
  assert.strictEqual(postBlocker({ orderId: 'abc' }), 'Tap a star first.')
  assert.strictEqual(postBlocker({ score: 4.5, orderId: 'abc' }), 'Tap a star first.')
  assert.ok(/order that proves it/.test(postBlocker({ score: 5, orderId: '' })))
  assert.ok(/a little long/.test(postBlocker({ score: 5, orderId: 'abc', text: 'x'.repeat(401) })))
})

// -- asking for a rating ---------------------------------------------------------------------

check('nothing is asked when there is nothing left to ask', () => {
  const base = { orderStatus: 'fulfilled', hasRated: false }
  assert.strictEqual(canAskForRating(base), true)
  assert.strictEqual(canAskForRating({ ...base, orderStatus: 'pending' }), false)
  assert.strictEqual(canAskForRating({ ...base, orderStatus: 'paid' }), false)
  assert.strictEqual(canAskForRating({ ...base, orderStatus: undefined }), false)
  assert.strictEqual(canAskForRating({ ...base, hasRated: true }), false, 'a buyer who rated is never asked again')
  assert.strictEqual(canAskForRating({ ...base, alreadyAsked: true }), false)
  assert.strictEqual(canAskForRating({ ...base, isSeller: true }), false)
})

check('the fallback waits a few days, and only fires when nothing else did', () => {
  const now = 1800000000000
  const day = 24 * 60 * 60 * 1000
  const base = { orderStatus: 'fulfilled', hasRated: false, now }
  assert.strictEqual(RATING_NUDGE_DAYS, 3)
  assert.strictEqual(shouldNudgeRating({ ...base, deliveredAtMs: now - 4 * day }), true)
  assert.strictEqual(shouldNudgeRating({ ...base, deliveredAtMs: now - RATING_NUDGE_DAYS * day }), true)
  assert.strictEqual(shouldNudgeRating({ ...base, deliveredAtMs: now - 2 * day }), false, 'the receipt just asked')
  assert.strictEqual(shouldNudgeRating({ ...base, deliveredAtMs: undefined }), false)
  assert.strictEqual(shouldNudgeRating({ ...base, deliveredAtMs: Number.NaN }), false)
  // …and it is still the same one gate: nobody is nudged about an order they answered, however old.
  assert.strictEqual(shouldNudgeRating({ ...base, hasRated: true, deliveredAtMs: now - 30 * day }), false)
  assert.strictEqual(shouldNudgeRating({ ...base, alreadyAsked: true, deliveredAtMs: now - 30 * day }), false)
  assert.strictEqual(shouldNudgeRating({ ...base, orderStatus: 'out_of_stock', deliveredAtMs: now - 30 * day }), false)
  assert.strictEqual(shouldNudgeRating({
    orderStatus: 'fulfilled', hasRated: false, isSeller: true, deliveredAtMs: now - 30 * day,
  }), false, 'a seller is not nudged to rate their own product')
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

// -- the rules: a star the browser cannot fake ------------------------------------------------

const rules = read('firestore.rules')
/** The comments block, from `match /reviews/…` to its closing brace. */
const commentsBlock = rules.match(/match \/reviews\/\{buyerUid\} \{[\s\S]*?\n {8}\}/)

check('a comment is authorised by the delivered order the buyer owns', () => {
  assert.ok(commentsBlock, 'the comments block is gone from firestore.rules')
  const text = commentsBlock[0]
  assert.ok(/request\.auth\.uid == buyerUid/.test(text), "anyone could write someone else's comment")
  assert.ok(/data\.buyerUid == request\.auth\.uid/.test(text))
  assert.ok(/data\.verified == true/.test(text), '"✓ Bought it" is set by the app because the rules proved it')
  assert.ok(/data\.orderId is string/.test(text), 'a comment must name the order that proves it')
  assert.ok(/data\.score is int/.test(text), 'a comment without a whole star must be refused')
  assert.ok(/data\.score >= 1/.test(text) && /data\.score <= 5/.test(text), '1–5 is the whole range of a star')
  assert.ok(/data\.text\.size\(\) <= 400/.test(text) || /data\.text\.size\(\) < 401/.test(text),
    'the 400-character limit is the rules\', not the app\'s')
  assert.ok(/\.data\.buyerUid == request\.auth\.uid/.test(text), "the order must be the buyer's own")
  assert.ok(/\.data\.status == 'fulfilled'/.test(text), 'the order must be delivered, not merely placed')
  assert.ok(!/data\.reaction/.test(text), 'the rules still ask for a reaction nobody writes any more')
})

check('the comment counters move only alongside the comment, and only by a star', () => {
  assert.ok(/hasOnly\(\['reviewCount', 'reviewScoreSum'\]\)/.test(rules),
    'the app moves exactly these two counters — anything else is a counter nobody maintains')
  assert.ok(!/reviewLovedCount/.test(rules), 'reviewLovedCount is retired: nothing may still move it')
  assert.ok(/existsAfter\([\s\S]{0,400}?\/reviews\/\$\(request\.auth\.uid\)\)/.test(rules),
    'the counters must be provably in the same write as the comment')
  assert.ok(/reviewCount - resource\.data\.get\('reviewCount', 0\) <= 1/.test(rules),
    'one comment can add one count')
  assert.ok(/reviewScoreSum - resource\.data\.get\('reviewScoreSum', 0\) >= -5/.test(rules)
    && /reviewScoreSum - resource\.data\.get\('reviewScoreSum', 0\) <= 5/.test(rules),
    'an edit moves the sum by at most four, so ±5 is the whole window a write may move it by')
})

check('asking for a rating is a write-once promise', () => {
  const at = rules.indexOf("hasOnly(['reviewAskedAt'])")
  assert.notStrictEqual(at, -1, 'the seller can no longer ask for a rating at all')
  // From the ask itself up to the next rule (the buyer's half of a return).
  const end = rules.indexOf('allow update: if request.auth != null', at)
  const after = rules.slice(at, end === -1 ? at + 500 : end)
  assert.ok(/!?\('reviewAskedAt' in resource\.data\)/.test(after), 'a second ask must be refused')
  assert.ok(/reviewAskedAt is int/.test(after), 'a timestamp that is not a number is not a time')
  assert.ok(!/updatedAt/.test(after),
    'asking must not move the date the return window and the completion numbers are counted from')
  assert.ok(/resource\.data\.status == 'fulfilled'/.test(rules.slice(Math.max(0, at - 900), at)),
    'only a delivered order can be asked about')
})

check('the rating marker is its own private document, apart from the ♥ answer', () => {
  assert.ok(/match \/ratingAsks\/\{orderId\} \{\s*allow read, write: if request\.auth\.uid == userId/.test(rules),
    'without this rule the fallback cannot remember that it asked — and would ask on every visit')
  assert.ok(/match \/comments\/\{productId\} \{\s*allow read, write: if request\.auth\.uid == userId/.test(rules),
    'the comment posts in one batch with its index, so a missing rule refuses the whole comment')
  assert.ok(/match \/loveAnswers\/\{orderId\}/.test(rules), 'the ♥ answers are still being written — leave them readable')
  assert.notStrictEqual(rules.indexOf('match /ratingAsks/{orderId}'), rules.indexOf('match /loveAnswers/{orderId}'),
    'the two questions were merged: a leftover ♥ answer would silence every rating ask')
})
// -- the four moments that ask, and the one writer --------------------------------------------

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
const SRC = srcFiles()
const srcOf = rel => read(path.join('src', rel))

check('one writer, and it writes a star — never a reaction', () => {
  const hook = srcOf('useProductReviews.ts')
  assert.ok(/score,\n/.test(hook), 'the comment document must carry the score itself')
  assert.ok(!/\breaction:/.test(hook), 'a document with a score *and* a reaction has two answers where there is one')
  assert.ok(/patch\.reviewScoreSum = increment\(scoreDelta\)/.test(hook),
    'the product counters must be moved by the same number the comment carries')
  assert.ok(/reviewCount = increment\(countDelta\)/.test(hook))
  assert.ok(/scoreDelta = score - \(previous \|\| 0\)/.test(hook),
    'an edit must correct the tally by the difference, never add to it twice')
  assert.ok(/previous = scoreOfReview\(rawPrevious\)/.test(hook),
    "an old ♥ comment's existing weight is what the difference is taken from")
  assert.ok(/writeBatch\(db\)/.test(hook), 'the comment and its counters are one write, or neither lands')
  assert.ok(/trackEvent\('review_posted'/.test(hook) && /score: input\.score/.test(hook),
    'the score belongs in the event, not only in the document')
  assert.ok(/'ratingAsks'/.test(hook) && !/'loveAnswers'/.test(hook),
    'the rating marker is its own document: a leftover ♥ answer must never silence a rating ask')
})

check('one tap on a star is a whole comment already', () => {
  const ask = srcOf('RatePrompt.tsx')
  assert.ok(/postReview\(\{[^}]*\bscore\b/.test(ask), 'the ask must post through the one writer, with a score')
  assert.ok(/hasReviewed\(sellerId, productId\)/.test(ask),
    'the stars must not be shown to someone who already rated — that is the whole gate')
  assert.ok(/answered !== false\) return null/.test(ask),
    'nothing is shown until the read has answered, so the stars never flash in and out')
  assert.ok(/aria-label=\{`Rate \$\{s\} out of 5/.test(ask), 'a star with no label cannot be read out')
  assert.ok(/trackEvent\('review_prompt_shown'/.test(ask) && /trackEvent\('review_prompt_answered'/.test(ask),
    'being asked and answering are two different questions — count both')
})

check('the full form asks for stars first, and posts one number', () => {
  const form = srcOf('ReviewForm.tsx')
  assert.ok(/SCORES\.map/.test(form), 'the form must offer exactly the five stars')
  assert.ok(/canPost\(\{ score, orderId, text \}\)/.test(form), 'the same rule decides whether it may be posted')
  assert.ok(/existing\?\.score \|\| initialScore \|\| null/.test(form),
    'a star already tapped elsewhere opens the form with it chosen, not asked twice')
  assert.ok(/postReview\(\{/.test(form) && /\bscore\b/.test(form))
  assert.ok(/aria-label=\{starAria\(s\)\}/.test(form), 'each star says which star it is')
})

check('the three asking surfaces, and the same gate behind all of them', () => {
  const orders = srcOf('BuyerOrders.tsx')
  assert.ok(/shouldNudgeRating\(/.test(orders), 'the fallback must use the shared rule, not its own arithmetic')
  assert.ok(/wasRatingAsked\(/.test(orders) && /markRatingAsked\(/.test(orders),
    'the fallback must remember that it asked, or it asks on every visit')
  assert.ok(/order\.id !== askRatingId/.test(orders), 'the ♥ prompt must stand down on the row the stars are asking on')

  const thread = srcOf('ConversationPanel.tsx')
  assert.ok(/orderId=\{m\.orderDocId\}/.test(thread),
    'the bubble must carry the order document id — the rules look that document up')
  assert.strictEqual((thread.match(/<RatePrompt/g) || []).length, 3,
    'a thread asks in three places: the receipt, the seller\'s own ask, and under the composer')

  const seller = srcOf('OrderHistory.tsx')
  assert.ok(/reviewAskedAt: Date\.now\(\)/.test(seller),
    'the seller\'s ask is a plain millisecond — write-once in the rules, and no `updatedAt` beside it')
  assert.ok(/postReviewRequestMessage\(/.test(seller), 'the ask belongs in the thread the buyer is already reading')
  assert.ok(/trackEvent\('review_requested'/.test(seller), 'a seller-produced ask is worth counting separately')
})

check('the retired half of the old feature is gone', () => {
  const retired = ['REACTIONS', 'isReaction', 'reactionLabel', 'scoreOf(', 'reviewLovedCount']
  retired.forEach(name => {
    const users = SRC.filter(rel => srcOf(rel).includes(name))
    assert.deepStrictEqual(users, [], `${name} was retired with the reactions — still used by ${users.join(', ')}`)
  })
  // The legacy table itself is read-only history, and it lives in exactly one place.
  const legacyReaders = SRC.filter(rel => /'love'/.test(srcOf(rel)))
  assert.deepStrictEqual(legacyReaders, ['reviewUtils.ts'],
    `the love|fine|bad table leaked out of reviewUtils.ts: ${legacyReaders.join(', ')}`)
  const askers = SRC.filter(rel => /LovePrompt/.test(srcOf(rel)))
  assert.deepStrictEqual(askers, ['BuyerOrders.tsx', 'LovePrompt.tsx'],
    'the ♥ question is a separate, older question now — it may only be rendered from one place')
  // And it is a question about the *product*, not a rating: it must never write a comment.
  const love = srcOf('LovePrompt.tsx')
  assert.ok(!/postReview/.test(love), 'the ♥ prompt must not be able to post a comment with no star')
  assert.ok(!/score/.test(love), 'the ♥ prompt has no business knowing about scores')
})

check('the events the asking surfaces send are in the taxonomy', () => {
  const tax = srcOf('analytics/taxonomy.ts')
  ;['review_prompt_shown', 'review_prompt_answered', 'review_requested', 'review_posted'].forEach(event => {
    assert.ok(new RegExp(`\\n  ${event}: \\[`).test(tax), `${event} is missing from the taxonomy`)
    assert.ok(!new RegExp(`\\n  ${event}: \\[[^\\]]*reaction`).test(tax), `${event} still declares a reaction`)
  })
  assert.ok(/review_posted: \[[^\]]*'score'/.test(tax), 'the rating itself must be declared in the event')
})

console.log(`\n${checks} checks passed \u2014 comments: stars, chips, names, counters, who may write and who may ask.\n`)