/**
 * Dev-only harness that pins the seller rating arithmetic to `firestore.rules`.
 *
 *   node _rating_rules_check.cjs
 *
 * A rating is the one number on rachett that a buyer writes and everybody reads, so the same truth
 * is written twice: the rules decide *which stars may exist*, and `lib/utils/seller_rating.dart`
 * decides what they are worth. Neither half is visible from the other, so both are read here -- the
 * rules as text, the arithmetic as the Dart file the phone actually compiles.
 *
 * What is being defended, in one line each:
 *
 *   the allowance   3 chat-only ratings a day is one number, in two files
 *   the star        one whole number, 1..5, and the rules refuse a 4.5
 *   the key         `order_<orderId>` / `chat_<buyerUid>` -- one rating can only replace another
 *   the proof       an order rating needs a delivered order, a chat rating needs the seller to have
 *                   answered, and only the two sources the app knows how to weigh can be written
 *   the clock       `createdAt` is the server's, so a star cannot be dated to look fresher
 *   the shop        `ratingAvg` / `ratingCount` / `ratingWeightSum` / `ratingMathVersion` stay
 *                   unwritable by the shop that owns the document
 *
 * Without the emulator (there is no JDK on this machine) this is a text-level proof, not a semantic
 * one: it cannot show that a rule *evaluates* to false, only that the shape it must have is there.
 * It is still the difference between "I believe it is right" and "the two files agree".
 */
const assert = require('assert')
const fs = require('fs')
const path = require('path')

let checks = 0
const check = (name, fn) => {
  try {
    fn()
  } catch (err) {
    err.message = `${name}\n    ${err.message}`
    throw err
  }
  checks++
  console.log('  ok  ' + name)
}

const rulesText = fs.readFileSync(path.join(__dirname, 'firestore.rules'), 'utf8')
const dartPath = path.join(__dirname, '..', 'projects', 'rachett', 'lib', 'utils', 'seller_rating.dart')
assert.ok(fs.existsSync(dartPath), `the rating arithmetic lives at ${dartPath}`)
const dartText = fs.readFileSync(dartPath, 'utf8')

/**
 * The text of one `match /x/{id} { ... }` block, with its braces matched -- so a rule that moves in
 * or out of the block changes what this harness reads, rather than sliding past it unnoticed.
 */
function ruleBlock(header) {
  const at = rulesText.indexOf(header)
  assert.ok(at !== -1, `firestore.rules no longer has ${header}`)
  let depth = 0
  for (let i = at + header.length - 1; i < rulesText.length; i++) {
    if (rulesText[i] === '{') depth += 1
    else if (rulesText[i] === '}') {
      depth -= 1
      if (depth === 0) return rulesText.slice(at, i + 1)
    }
  }
  throw new Error(`unbalanced braces after ${header}`)
}

/**
 * Rules with their commentary removed.
 *
 * The comments in `firestore.rules` *name* the shapes they forbid -- `source in ['import', ...]`
 * is explained right above the list that refuses it -- so a harness reading the file as-is would
 * find the explanation and call it the crime.
 */
function withoutComments(text) {
  return text.replace(/^\s*\/\/.*$/gm, '')
}

/** One `static const` from the Dart file, as a number. */
function dartConst(name) {
  const found = dartText.match(new RegExp(`static const (?:double|int) ${name} = (-?[\\d.]+);`))
  assert.ok(found, `seller_rating.dart no longer declares ${name}`)
  return Number(found[1])
}

const sellers = ruleBlock('match /sellers/{sellerId} {')
const ratings = ruleBlock('match /ratings/{ratingId} {')
const orders = ruleBlock('match /orders/{orderId} {')
const proofs = ruleBlock('match /proofs/{proofId} {')
const quota = ruleBlock('match /ratingQuota/{docId} {')

const ratingsCode = withoutComments(ratings)
const ordersCode = withoutComments(orders)
const proofsCode = withoutComments(proofs)
const quotaCode = withoutComments(quota)

check('the file is still a tree of balanced blocks', () => {
  const code = withoutComments(rulesText)
  const open = (code.match(/{/g) || []).length
  const close = (code.match(/}/g) || []).length
  assert.strictEqual(open, close, `${open} opening braces against ${close} closing ones`)
})

check('the weight table is the one the design was agreed on', () => {
  const weights = [...dartText.matchAll(/case RatingSource\.(\w+):\s*\n\s*return ([\d.]+);/g)]
  const table = Object.fromEntries(weights.map(([, name, value]) => [name, Number(value)]))
  assert.deepStrictEqual(table, {
    order: 1,
    chatAfterOrder: 0.6,
    chat: 0.3,
    imported: 0.2,
  })
})

check('the decay and the smoothing are the numbers agreed', () => {
  assert.strictEqual(dartConst('confidence'), 5, 'the prior is worth five real ratings')
  assert.strictEqual(dartConst('prior'), 4, 'an unrated shop is assumed to be 4.0, not 5.0')
  assert.strictEqual(dartConst('halfLifeDays'), 180, 'weight halves every six months')
  assert.strictEqual(dartConst('showThreshold'), 3, 'below three ratings of weight, nothing shows')
})

check('the daily allowance is one number in two files', () => {
  const onPhone = dartConst('chatRatingsPerDay')
  const inRules = Number(quotaCode.match(/count <= (\d+)/)[1])
  assert.strictEqual(inRules, 3, 'three a day')
  assert.strictEqual(onPhone, inRules, 'the phone must not outrun the server\'s idea of the allowance')
  assert.ok(
    /\/ratingQuota\/main/.test(ratingsCode),
    'the rating write has to move that counter in the same batch, or the star is refused alone',
  )
})

check('a star is one whole number from 1 to 5', () => {
  assert.strictEqual(dartConst('minStars'), 1)
  assert.strictEqual(dartConst('maxStars'), 5)
  assert.ok(/stars is int/.test(ratingsCode), 'the rules refuse a 4.5, so nothing downstream rounds one')
  assert.ok(/stars >= 1/.test(ratingsCode) && /stars <= 5/.test(ratingsCode))
  assert.ok(!/stars >= 0|stars <= 6/.test(ratingsCode), 'the bounds are the bounds')
})

check('one rating can only ever replace another', () => {
  assert.ok(/ratingId == 'order_' \+ request\.resource\.data\.orderId/.test(ratingsCode))
  assert.ok(/ratingId == 'chat_' \+ request\.auth\.uid/.test(ratingsCode))
  assert.ok(/String orderRatingId\(String orderId\) => 'order_\$orderId';/.test(dartText))
  assert.ok(/String chatRatingId\(String buyerUid\) => 'chat_\$buyerUid';/.test(dartText))
})

check('only the two sources a browser can prove may be written', () => {
  assert.ok(/source in \['order', 'chat'\]/.test(ratingsCode))
  assert.ok(
    !/'import'/.test(ratingsCode) && !/'imported'/.test(ratingsCode),
    'a star from outside rachett is the server\'s to import, never a client\'s to claim',
  )
})

check('an order rating stands on a delivered order', () => {
  assert.ok(/function delivered\(\)/.test(ratingsCode))
  assert.ok(/status == 'fulfilled'/.test(ratingsCode), 'the seller marking it delivered is one path')
  assert.ok(/get\('receivedAt', 0\) > 0/.test(ratingsCode), 'the buyer saying so is the other')
  assert.ok(
    /ratedOrder\(\)\.buyerUid == request\.auth\.uid/.test(ratingsCode),
    'and the order has to be theirs',
  )
})

check('"I received it" is two fields, once, and never a status change', () => {
  assert.ok(/hasOnly\(\['receivedAt', 'receivedBy'\]\)/.test(ordersCode))
  assert.ok(/!\('receivedAt' in resource\.data\)/.test(ordersCode), 'write-once')
  assert.ok(/receivedBy == 'buyer'/.test(ordersCode))
  assert.ok(/checkoutState', ''\) != 'paying'/.test(ordersCode), 'a cart still being paid for is not received')
  const clause = ordersCode.slice(ordersCode.indexOf("receivedAt', 'receivedBy"))
  assert.ok(
    !/'status'/.test(clause),
    'the completion rate and the return window stay the shop\'s own business',
  )
})

check('a chat rating that names an order waits three days', () => {
  assert.ok(/function deliveredThreeDaysAgo\(\)/.test(ratingsCode), 'the wait is its own function')
  assert.ok(
    /timestamp\.value\(ratedOrder\(\)\.receivedAt \+ 259200000\) <= request\.time/.test(ratingsCode),
    '259200000 ms is the three days, measured back from the server\'s clock',
  )
  assert.ok(
    /\('orderId' in request\.resource\.data \|\| quotaMoved\(\)\)/.test(ratingsCode),
    'so naming an order is what buys the exemption from the daily allowance',
  )
})

check('a chat-only star needs the seller to have answered', () => {
  assert.ok(/proofs\/sellerReplied/.test(ratingsCode), 'the rating reads the proof')
  assert.ok(/'orderId' in request\.resource\.data \|\| quotaMoved\(\)/.test(ratingsCode))
  assert.ok(/proofId == 'sellerReplied'/.test(proofsCode))
  assert.ok(/request\.auth\.uid == thread\(\)\.sellerId/.test(proofsCode), 'only the seller may stamp it')
  assert.ok(/allow update, delete: if false;/.test(proofsCode), 'and it cannot be taken back or edited')
})

check('the allowance can be reset once a day, never backwards and never tomorrow', () => {
  const buckets = quotaCode.match(/request\.time < request\.resource\.data\.day \+ duration\.value\(1, 'd'\)/g) || []
  assert.strictEqual(buckets.length, 2, 'the first write and every later one must both be today\'s bucket')
  assert.ok(/request\.resource\.data\.day <= request\.time/.test(quotaCode), 'never a bucket from tomorrow')
  assert.ok(/request\.resource\.data\.day == resource\.data\.day/.test(quotaCode), 'the same bucket ticks')
  assert.ok(/request\.resource\.data\.day > resource\.data\.day/.test(quotaCode), 'a new bucket only moves forward')
  assert.ok(/count == 1/.test(quotaCode), 'and starts at one, so there is one reset a day')
  assert.ok(/allow delete: if false;/.test(quotaCode), 'deleting it would be a free reset')
  assert.ok(/day is timestamp/.test(quotaCode), 'a day, not a client\'s idea of a day')
})

check('a rating is dated by the server', () => {
  assert.ok(/createdAt == request\.time/.test(ratingsCode))
  assert.ok(
    !/createdAt is int/.test(ratingsCode),
    'a client-supplied date is exactly what age-weighted decay must not trust',
  )
})

check('a shop still cannot write its own reputation', () => {
  const create = sellers.match(/allow create: if request\.auth\.uid == sellerId[\s\S]*?;/)[0]
  const update = sellers.match(/allow update: if request\.auth\.uid == sellerId[\s\S]*?;/)[0]
  for (const key of ['ratingAvg', 'ratingCount', 'ratingUpdatedAt', 'ratingWeightSum', 'ratingMathVersion']) {
    assert.ok(create.includes(`'${key}'`), `create must refuse ${key}`)
    assert.ok(update.includes(`'${key}'`), `update must refuse ${key}`)
  }
})

console.log(`\n${checks} rating checks passed`)
