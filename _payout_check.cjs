/**
 * Dev-only harness for the Payouts number proof.
 *
 *   node _payout_check.cjs
 *
 * The promise this feature makes is narrow and testable: a seller may not switch on a payout rail
 * until the number behind it has received a code from our SMS server, and the verified number is
 * kept somewhere the browser cannot forge. This checks the decisions (`api/_lib/payout.js`), then
 * reads the four files that carry the promise:
 *
 *   api/payout/methods.js  — consumes the code and writes both records server-side
 *   src/PayoutNumberField.tsx — sends the code and posts it to that endpoint
 *   src/PaymentSetup.tsx   — only reads Firestore; never writes `paymentMethods` itself
 *   firestore.rules        — the browser may not write `paymentMethods`; the private record is
 *                            owner-read and server-write
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

function codeOnly(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

const read = rel => fs.readFileSync(path.join(__dirname, rel), 'utf8')
const api = read('api/payout/methods.js')
const pure = read('api/_lib/payout.js')
const field = read('src/PayoutNumberField.tsx')
const setup = read('src/PaymentSetup.tsx')
const client = read('src/payoutClient.ts')
const rules = read('firestore.rules')

;(async () => {
  const payout = await import('./api/_lib/payout.js')

  check('only the two live rails are payout methods', () => {
    assert.deepStrictEqual(payout.PAYOUT_METHODS, ['mtn', 'airtel'])
    assert.strictEqual(payout.isPayoutMethod('mtn'), true)
    assert.strictEqual(payout.isPayoutMethod('airtel'), true)
    assert.strictEqual(payout.isPayoutMethod('card'), false)
    assert.strictEqual(payout.isPayoutMethod('MTN'), false)
    assert.strictEqual(payout.isPayoutMethod(''), false)
  })

  check('a verified number needs both the number and the moment it was proved', () => {
    const good = { mtn: { number: '+256771234567', verifiedAt: 1000 } }
    assert.strictEqual(payout.verifiedNumberFor(good, 'mtn'), '+256771234567')
    assert.strictEqual(payout.verifiedNumberFor({ mtn: { number: '+256771234567' } }, 'mtn'), '')
    assert.strictEqual(payout.verifiedNumberFor({ mtn: { number: '+256771234567', verifiedAt: 0 } }, 'mtn'), '')
    assert.strictEqual(payout.verifiedNumberFor({ mtn: { number: '0771234567', verifiedAt: 1 } }, 'mtn'), '')
    assert.strictEqual(payout.verifiedNumberFor(null, 'mtn'), '')
    assert.strictEqual(payout.verifiedNumberFor(good, 'card'), '')
  })

  check('an enabled rail without proof is named, never quietly saved', () => {
    const account = { mtn: { number: '+256771234567', verifiedAt: 1000 } }
    assert.deepStrictEqual(payout.flagsFrom({ mtn: true, airtel: false }).mtn, true)
    assert.deepStrictEqual(payout.flagsFrom({ mtn: 'true', airtel: 1 }),
      { mtn: false, airtel: false })
    assert.deepStrictEqual(payout.methodsMissingProof({ mtn: true, airtel: false }, account), [])
    assert.deepStrictEqual(payout.methodsMissingProof({ mtn: true, airtel: true }, account), ['airtel'])
    assert.ok(payout.missingProofMessage(['airtel']).includes('Airtel Money'))
    assert.ok(payout.missingProofMessage(['mtn', 'airtel']).includes('MTN MoMo and Airtel Money'))
    assert.strictEqual(payout.missingProofMessage([]), '')
  })

  check('the public seller document says a rail is on, never the number', () => {
    const patch = payout.publicRailPatch(1234)
    assert.deepStrictEqual(patch, { enabled: true, verified: true, verifiedAt: 1234 })
    assert.strictEqual('number' in patch, false)
  })

  check('the endpoint consumes the code and does not claim a sign-in account', () => {
    assert.ok(/consume\(\{/.test(api), 'the payout endpoint must consume the one-time code')
    assert.ok(!/claimNumber/.test(codeOnly(api)), 'a payout number must not become the sign-in number')
    assert.ok(!/customToken/.test(codeOnly(api)), 'a payout code must not mint a sign-in token')
    assert.ok(/payoutAccounts/.test(api), 'the verified number must live in the private ledger')
    assert.ok(/delete methods\[method\]\.number/.test(api), 'old public numbers must be removed')
  })

  check('the screen sends a code and posts it to the payout endpoint', () => {
    assert.ok(/await sendOtp\(full\)/.test(field), 'the field must text a code through the shared client')
    assert.ok(/await verifyPayoutNumber\(full, code, method/.test(field), 'the code must go to the payout endpoint')
    assert.ok(!/verifyOtp\(/.test(codeOnly(field)), 'payout verification must not sign anybody in')
  })

  check('the Payouts page cannot write a payout number itself', () => {
    assert.ok(!/setDoc\(|updateDoc\(/.test(codeOnly(setup)), 'the page must not write the seller document')
    assert.ok(/getDoc\(doc\(db, 'payoutAccounts', uid\)\)/.test(setup), 'the page reads the server-written record')
    assert.ok(/savePayoutMethods\(/.test(setup), 'switching a rail on goes through the server endpoint')
  })

  check('the client names the action and code the endpoint reads', () => {
    assert.ok(/\{\s*action:\s*'verify',\s*method,\s*phone,\s*code\s*\}/.test(client))
    assert.ok(/\{\s*action:\s*'save',\s*mtn:\s*enabled\.mtn/.test(client))
    assert.ok(/Authorization: `Bearer \$\{idToken\}`/.test(client))
  })

  check('the rules make the browser a reader, never a writer', () => {
    assert.ok(/match \/payoutAccounts\/\{userId\} \{\s*allow read: if request\.auth != null && request\.auth\.uid == userId;\s*allow write: if false;/.test(rules))
    assert.ok(/hasAny\(\['phoneVerified'[\s\S]*?'paymentMethods', 'paymentMethodsUpdatedAt'\]\)/.test(rules))
  })

  console.log(`\n${checks} payout checks passed`)
})()
