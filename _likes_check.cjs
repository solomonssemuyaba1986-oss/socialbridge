/**
 * Dev-only harness for the ♥ like maths and the rules that make it universal.
 *
 *   npx tsc --ignoreConfig src/productCardUtils.ts --outDir _dsbuild --module commonjs --target es2020 --skipLibCheck
 *   Move-Item -Force _dsbuild/productCardUtils.js _dsbuild/productCardUtils.cjs   # package.json is "type": "module"
 *   node _likes_check.cjs
 *
 * Two things are worth pinning down outside the browser: the number a card shows
 * (K/M, never six digits, never "1000K") and the Firestore rules that keep one vote
 * per account while everybody reads the same tally.
 */
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const { formatCount, formatBagCount, likeTally } = require(path.join(__dirname, '_dsbuild', 'productCardUtils.cjs'))

let checks = 0
const check = (name, fn) => { fn(); checks++; console.log('  ok  ' + name) }

check('a small tally is written out in full', () => {
  assert.strictEqual(formatCount(0), '0')
  assert.strictEqual(formatCount(22), '22')
  assert.strictEqual(formatCount(999), '999')
})

check('thousands become K, millions become M', () => {
  assert.strictEqual(formatCount(1000), '1.0K')
  assert.strictEqual(formatCount(1200), '1.2K')
  assert.strictEqual(formatCount(9999), '10.0K')
  assert.strictEqual(formatCount(10000), '10K')
  assert.strictEqual(formatCount(542000), '542K')
  assert.strictEqual(formatCount(1000000), '1.0M')
  assert.strictEqual(formatCount(2500000), '2.5M')
})

check('nobody ever reads "1000K" — 999,500 rounds up to 1.0M', () => {
  assert.strictEqual(formatCount(999499), '999K')
  assert.strictEqual(formatCount(999500), '1.0M')
  assert.strictEqual(formatCount(999999), '1.0M')
})

check('junk in a document can never print a weird number', () => {
  assert.strictEqual(formatCount(-5), '0')
  assert.strictEqual(formatCount(NaN), '0')
  assert.strictEqual(formatCount(undefined), '0')
  assert.strictEqual(formatCount(12.7), '12')
  assert.strictEqual(formatCount('1200'), '1.2K')
})

check('the old bagged/bought name is the very same function', () => {
  assert.strictEqual(formatBagCount(1200), formatCount(1200))
  assert.strictEqual(formatBagCount(999999), '1.0M')
})

check('a product with no likeCount reads as zero, never NaN', () => {
  assert.strictEqual(likeTally({ likeCount: 22 }), 22)
  assert.strictEqual(likeTally({}), 0)
  assert.strictEqual(likeTally(null), 0)
  assert.strictEqual(likeTally({ likeCount: -3 }), 0)
  assert.strictEqual(likeTally({ likeCount: 4.9 }), 4)
  assert.strictEqual(likeTally({ likeCount: 'nope' }), 0)
})

/** The rules are the only thing that can promise one vote per account, so they are pinned too. */
const rules = fs.readFileSync(path.join(__dirname, 'firestore.rules'), 'utf8')
const likesBlock = rules.slice(rules.indexOf('match /likes/{voterId}'), rules.indexOf('match /stats/'))

check('the vote is keyed by the voter, and only they may write it', () => {
  assert.ok(/request\.auth\.uid == voterId/.test(likesBlock), 'create must be your own uid')
  assert.ok(/voterId != sellerId/.test(likesBlock), 'nobody may love their own product')
  assert.ok(/allow update: if false/.test(likesBlock), 'a vote is never edited')
  assert.ok(/allow delete: if request\.auth != null && request\.auth\.uid == voterId/.test(likesBlock), 'only you may take your vote back')
})

check('the tally may only ever move by one, up or down', () => {
  assert.ok(/affectedKeys\(\)\.hasOnly\(\['likeCount'\]\)/.test(rules), 'nothing else rides along')
  assert.ok(/resource\.data\.get\('likeCount', 0\) \+ 1/.test(rules), 'a new vote is +1')
  assert.ok(/resource\.data\.get\('likeCount', 0\) - 1/.test(rules), 'a taken-back vote is −1')
  assert.ok(/request\.auth\.uid != sellerId/.test(rules), 'the seller never moves their own tally')
})

check('my votes and my answers stay mine', () => {
  assert.ok(/match \/likes\/\{productId\} \{\s*allow read, write: if request\.auth\.uid == userId/.test(rules))
  assert.ok(/match \/loveAnswers\/\{orderId\} \{\s*allow read, write: if request\.auth\.uid == userId/.test(rules))
})

console.log('\n' + checks + ' like checks passed')
