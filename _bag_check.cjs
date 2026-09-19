/**
 * Dev-only harness for the bag counter's honesty rules.
 *
 *   node _bag_check.cjs
 *
 * These are **source-level** assertions on `src/useBag.ts` and `firestore.rules`: the runtime
 * behaviour needs Firestore (a transaction, and the rules), so what is pinned here is the wiring
 * that makes the public number trustworthy —
 *   • a guest's add is never counted (there is no account to count it as),
 *   • the number a card shows can only be written by a signed-in account,
 *   • one account counts once (the marker document *is* the account's uid),
 *   • and a guest's bag is credited the moment they sign in — exactly once, never twice.
 */
const assert = require('assert')
const fs = require('fs')
const path = require('path')

let checks = 0
const check = (name, fn) => { fn(); checks++; console.log('  ok  ' + name) }

const bag = fs.readFileSync(path.join(__dirname, 'src', 'useBag.ts'), 'utf8')
const rules = fs.readFileSync(path.join(__dirname, 'firestore.rules'), 'utf8')

check('a guest is never counted — there is no account to count them as', () => {
  assert.ok(/if \(!userId\) return/.test(bag), 'incrementBaggedCount must bail without a uid')
  assert.ok(/guests don't count toward ever-bagged/.test(bag), 'and say why, in the code')
})

check('one account counts once — the marker IS the account', () => {
  assert.ok(/doc\(db, 'bagCounts', productId, 'baggers', userId\)/.test(bag), 'the marker is keyed by uid')
  assert.ok(/runTransaction/.test(bag), 'check-and-count happens in a transaction, so two tabs cannot double it')
  assert.ok(/if \(markerSnap\.exists\(\)\) return/.test(bag), 'an account that already bagged it is skipped')
})

check('a guest bag is credited when they sign in — and only for items the account did not have', () => {
  assert.ok(/incrementBagCount\(i\.productId, 1\)/.test(bag), 'the live count is bumped at the merge')
  assert.ok(/incrementBaggedCount\(i\.productId, user\.uid\)/.test(bag), 'the ever-bagged number is credited at the merge')
  assert.ok(/if \(remoteIds\.has\(i\.productId\)\) return/.test(bag), 'items already on the account are left alone, so a second device cannot double-count')
})

check('the public number can only be written by a signed-in account', () => {
  const block = rules.slice(rules.indexOf('match /bagCounts/'), rules.indexOf('match /feedback/'))
  assert.ok(/allow write: if request\.auth != null/.test(block), 'no public writes to a number the world sees')
  assert.ok(/allow create: if request\.auth != null && request\.auth\.uid == key/.test(block), 'a bagger marker must be your own uid')
})

console.log('\n' + checks + ' bag-honesty checks passed')
