/**
 * Dev-only harness that pins the app's return and care lists to `firestore.rules`.
 *
 *   npx tsc --ignoreConfig src/returnPolicy.ts src/care.ts --outDir _dsbuild --module commonjs --target es2020 --skipLibCheck
 *   Move-Item -Force _dsbuild/returnPolicy.js _dsbuild/returnPolicy.cjs
 *   Move-Item -Force _dsbuild/care.js _dsbuild/care.cjs
 *   node _rules_check.cjs
 *
 * The same truth written twice is how one of them quietly becomes wrong: a state the app offers but
 * the rules refuse (a dead button), or a reason the rules accept but the app never sends (a hole
 * nobody tests). Both live in this repo, so both are read here and compared — the rules as text, the
 * app as the compiled module a screen would actually call.
 *
 * The last section pins the 🟢 phone badge shut. It used to be forgeable in one line — the seller
 * could write `phoneVerified` onto their own document (`firestore.rules:7`), so the browser could
 * claim the badge by hand with no SMS ever sent. That is now refused on both halves of the write,
 * the proof has moved to `trust/{uid}` (public to read, closed to write), and this file reads
 * `api/_lib/identity.js` to prove the publicly readable document holds no phone number.
 */
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const {
  RETURN_REASONS,
  BUYER_RETURN_STATES,
  SELLER_RETURN_STATES,
  MAX_RETURN_NOTE,
  returnPatch,
  buyerReturnPatch,
  sellerReturnPatch,
} = require(path.join(__dirname, '_dsbuild', 'returnPolicy.cjs'))
const {
  MAX_CARE_NOTE,
  careTicket,
  careTicketDoc,
} = require(path.join(__dirname, '_dsbuild', 'care.cjs'))

let checks = 0
const check = (name, fn) => {
  try {
    fn()
  } catch (err) {
    // Say *which* check failed. A harness that only prints a stack trace makes you go looking.
    err.message = `${name}\n    ${err.message}`
    throw err
  }
  checks++
  console.log('  ok  ' + name)
}

const NOW = Date.UTC(2026, 1, 12, 9, 0, 0)
const rulesText = fs.readFileSync(path.join(__dirname, 'firestore.rules'), 'utf8')

/**
 * The text of one `match /x/{id} { ... }` block, with its braces matched — so a rule that moves in
 * or out of the block changes what this harness reads, rather than sliding past it unnoticed.
 * Counting starts at the block's own opening brace: the `{id}` in the header would otherwise close
 * the block before the first rule.
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

/** Where a phrase sits inside a block — asserted, so a reworded comment is a failure, not a mystery. */
function markerOf(text, needle) {
  const at = text.indexOf(needle)
  assert.ok(at !== -1, `firestore.rules no longer says "${needle}"`)
  return at
}

/**
 * Rules with their commentary removed.
 *
 * A comment that *names* a forbidden shape is not the shape: the `sellers` block explains the bug
 * it fixes by quoting `` `phoneVerified: true` ``, and an assertion that reads the file as-is would
 * see the explanation and call it the crime. Comments in this file sit on their own lines, so
 * whole-line stripping is enough — and it leaves strings (which can contain `//`) untouched.
 */
function withoutComments(text) {
  return text.replace(/^\s*\/\/.*$/gm, '')
}

/** The values of one rules list: `x in ['a', 'b']` → ['a', 'b']. */
function splitList(raw) {
  return raw.split(',').map(v => v.trim().replace(/^'/, '').replace(/'$/, '')).filter(v => v !== '')
}

/** Every list in this branch shaped `field in [...]` — the first one is the full list. */
function listsOf(text, field) {
  const all = [...text.matchAll(new RegExp(`${field} in \\[([^\\]]*)\\]`, 'g'))].map(m => splitList(m[1]))
  assert.ok(all.length > 0, `this branch of firestore.rules has no \`${field} in [...]\``)
  return all
}

/** The fields a branch lets a write touch: `affectedKeys().hasOnly(['a', 'b'])`. */
function onlyFields(text) {
  const m = text.match(/affectedKeys\(\)\s*\.hasOnly\(\[([^\]]*)\]/)
  assert.ok(m, 'this branch no longer restricts the fields a write may touch')
  return splitList(m[1].replace(/\s+/g, ' '))
}

/** The keys a patch builder can produce, with and without a note. */
const keysOf = (...patches) => {
  const keys = new Set()
  patches.forEach(patch => Object.keys(patch).forEach(key => keys.add(key)))
  return [...keys].sort()
}

const orders = ruleBlock('match /orders/{orderId} {')
const care = ruleBlock('match /careTickets/{ticketId} {')
const sellerBranchAt = markerOf(orders, 'allow update: if request.auth.uid == sellerId')
// ASCII anchors on purpose: a marker one emoji wide is a marker that breaks on a copy-paste.
const buyerBranchAt = markerOf(orders, 'half of a return')
const deleteAt = markerOf(orders, 'allow delete:')
const sellerHalf = orders.slice(sellerBranchAt, buyerBranchAt)
const buyerHalf = orders.slice(buyerBranchAt, deleteAt)
assert.ok(sellerHalf.length > 0 && buyerHalf.length > 0, 'both halves of the order rules are read here')

check('the states only a seller may set are the states the rules reserve for the seller', () => {
  assert.deepStrictEqual(listsOf(sellerHalf, 'returnState')[0].slice().sort(), [...SELLER_RETURN_STATES].sort())
  // A decision is only ever made on a delivered order — the same condition the app checks.
  assert.ok(/resource\.data\.status == 'fulfilled'/.test(sellerHalf))
})

check('the states a buyer may set are exactly the three the rules hand them', () => {
  assert.deepStrictEqual(listsOf(buyerHalf, 'returnState')[0], [...BUYER_RETURN_STATES])
  const prior = buyerHalf.match(/resource\.data\.get\('returnState', ''\) in \[([^\]]*)\]/)
  assert.ok(prior, 'the rules no longer say what a return may be restarted from')
  // The list itself starts with an empty string — an order with nothing on it yet is the common case,
  // and `splitList` drops empties, so the raw text is what proves it is allowed.
  assert.ok(prior[1].includes("''"), 'a first return must be allowed on an order with no return on it yet')
  const from = splitList(prior[1])
  // A withdrawn return has to be restartable, or the one mistake a buyer can undo is permanent.
  assert.ok(from.includes('canceled'))
  // And a buyer can never approve their own return.
  const buyerSet = new Set(BUYER_RETURN_STATES)
  SELLER_RETURN_STATES.forEach(state => assert.ok(!buyerSet.has(state), `${state} cannot be both sides' to set`))
})

check('every reason on the screen is a reason the rules accept — and no others', () => {
  assert.deepStrictEqual(listsOf(buyerHalf, 'returnReason')[0], RETURN_REASONS.map(r => r.value))
})

check('the fault comes from the reason here, and is checked by the rules there', () => {
  const lists = listsOf(buyerHalf, 'returnReason')
  assert.strictEqual(lists.length, 3, 'the rules should name the reasons, then split them by fault')
  assert.deepStrictEqual(lists[1], RETURN_REASONS.filter(r => r.fault === 'seller').map(r => r.value))
  assert.deepStrictEqual(lists[2], RETURN_REASONS.filter(r => r.fault === 'buyer').map(r => r.value))
  RETURN_REASONS.forEach(reason => {
    const patch = returnPatch({ reason: reason.value, nowMs: NOW })
    if (lists[1].includes(reason.value)) {
      // The seller's fault, and the rules accept nothing else — a buyer cannot file their own mistake
      // as ours to move the cost of the trip.
      assert.strictEqual(patch.returnFault, 'seller', `${reason.value} must be filed against the seller`)
    } else {
      assert.strictEqual(patch.returnFault, reason.fault, `${reason.value} carries its own fault`)
    }
  })
  // A reason we do not know is still filed against the seller — a buyer is never told it was theirs.
  assert.strictEqual(returnPatch({ reason: 'not_a_reason', nowMs: NOW }).returnFault, 'seller')
})

check('a buyer can only write the field set the rules allow them to write', () => {
  const allowed = onlyFields(buyerHalf).sort()
  const written = keysOf(
    returnPatch({ reason: 'damaged', nowMs: NOW }),
    returnPatch({ reason: 'other', note: 'it is the wrong colour', nowMs: NOW }),
    buyerReturnPatch('photos_sent', NOW),
    buyerReturnPatch('canceled', NOW, 'changed my mind'),
  )
  assert.deepStrictEqual(written, allowed)
  assert.ok(allowed.includes('returnRequestedAt'))
})

check('a seller can only write the three decision fields, never the buyer’s request', () => {
  const allowed = onlyFields(sellerHalf).sort()
  assert.deepStrictEqual(allowed, ['returnDecidedAt', 'returnNote', 'returnState'])
  const written = keysOf(
    sellerReturnPatch('approved', NOW),
    sellerReturnPatch('declined', NOW, 'this was not bought here'),
  )
  assert.deepStrictEqual(written, allowed)
})

check('the 300-character note is the same 300 characters in the rules', () => {
  assert.strictEqual(MAX_RETURN_NOTE, 300)
  const caps = [...orders.matchAll(/returnNote'?\)?\.size\(\) <= (\d+)/g)].map(m => Number(m[1]))
  assert.strictEqual(caps.length, 2, 'both halves of the order rules cap the note')
  caps.forEach(cap => assert.strictEqual(cap, MAX_RETURN_NOTE))
  // The app trims to the same number, so a note a buyer can type is never refused by the rules.
  assert.strictEqual(returnPatch({ reason: 'other', note: 'x'.repeat(5000), nowMs: NOW }).returnNote.length, MAX_RETURN_NOTE)
  assert.strictEqual(sellerReturnPatch('declined', NOW, 'x'.repeat(5000)).returnNote.length, MAX_RETURN_NOTE)
})

check('the request time is write-once, so the clock cannot be restarted by asking again', () => {
  assert.strictEqual(returnPatch({ reason: 'damaged', nowMs: NOW }).returnRequestedAt, NOW)
  // Only the buyer's first request ever stamps it: nothing later may move it.
  assert.ok(!('returnRequestedAt' in buyerReturnPatch('canceled', NOW + 1000)))
  assert.ok(!('returnRequestedAt' in sellerReturnPatch('approved', NOW + 1000)))
  assert.ok(/returnRequestedAt is number/.test(buyerHalf), 'the rules insist the stamp is a number')
  assert.ok(
    /resource\.data\.get\('returnRequestedAt', 0\) == 0\s*\|\| request\.resource\.data\.returnRequestedAt == resource\.data\.get\('returnRequestedAt', 0\)/.test(buyerHalf),
    'the rules must refuse a second, later request time',
  )
})

check('a care ticket is inside the rules’ 900 characters, and says who it is', () => {
  const capped = care.match(/request\.resource\.data\.message\.size\(\) <= (\d+)/)
  assert.ok(capped, 'the rules cap the message')
  const cap = Number(capped[1])
  // The longest note the app accepts, over the longest draft the app can write…
  const worst = careTicket({
    issue: 'no_refund',
    context: { orderId: 'ORD-7', shopName: 'Kabale Phones', itemName: 'Solar panel', quantity: 2, orderedAtMs: NOW },
    note: 'x'.repeat(5000),
    photoUrls: ['https://a/1.jpg'],
    nowMs: NOW,
  })
  // …and a message longer than anything that can be typed, to test the cap itself.
  const giant = careTicketDoc({ ...worst, message: 'x'.repeat(5000) }, 'uid-1')
  assert.strictEqual(giant.message.length, Math.min(cap, MAX_CARE_NOTE + 400))
  assert.ok(careTicketDoc(worst, 'uid-1').message.length <= cap, 'never a ticket the rules would refuse')
  assert.ok(worst.message.length > 0)
  assert.strictEqual(worst.status, 'open')
  assert.strictEqual(worst.source, 'care')
  // The rules read the author off the document, so the writer has to put it there.
  assert.strictEqual(giant.uid, 'uid-1')
  assert.ok(/request\.resource\.data\.uid == request\.auth\.uid/.test(care))
  assert.ok(/request\.resource\.data\.status == 'open'/.test(care))
  assert.ok(/request\.resource\.data\.source == 'care'/.test(care))
})

check('a ticket is readable only by the person who sent it — never by the seller it is about', () => {
  assert.ok(/allow read: if request\.auth != null && resource\.data\.uid == request\.auth\.uid/.test(care))
  assert.ok(!/sellerId/.test(care), 'the seller must not be named as a reader of a care ticket')
  // Nothing may reopen or rewrite one: a ticket is a record, not a thread.
  assert.ok(/allow update, delete: if false/.test(care))
})

check('one writer for care tickets, and it only ever adds', () => {
  const files = []
  const walk = dir => {
    fs.readdirSync(dir, { withFileTypes: true }).forEach(entry => {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.(ts|tsx)$/.test(entry.name)) {
        const text = fs.readFileSync(full, 'utf8')
        if (text.includes("'careTickets'")) files.push({ full, text })
      }
    })
  }
  walk(path.join(__dirname, 'src'))
  assert.deepStrictEqual(
    files.map(f => path.basename(f.full)).sort(),
    ['careTickets.ts'],
    'a ticket is written in one module, so the rules are not copied around the app',
  )
  const writer = files[0].text
  assert.ok(/addDoc\(collection\(db, 'careTickets'\)/.test(writer), 'a ticket is added, never set over')
  assert.ok(!/updateDoc\(|deleteDoc\(|setDoc\(/.test(writer), 'a ticket is never rewritten')
  assert.ok(/careTicketDoc\(/.test(writer), 'the document comes from `care.ts`, where it is checked')
  // The author has to be the signed-in person's uid — the rules read it straight off the document.
  assert.ok(/careTicketDoc\([^)]*\.uid\)/.test(writer), 'the author is stamped from the signed-in user')
  assert.ok(
    /auth\.currentUser/.test(writer) && /'signin'/.test(writer),
    'a ticket needs an account — the rules demand request.auth, so the screen is told to sign in',
  )
})

// ── the 🟢 badge that must not be self-serve ─────────────────────────────────────────────────

const sellers = ruleBlock('match /sellers/{sellerId} {')
const identitySrc = fs.readFileSync(path.join(__dirname, 'api', '_lib', 'identity.js'), 'utf8')

check('a store page stays public, but a seller may no longer write their own badge', () => {
  // The lookup on `phoneVerified` in SetupStore's save call expected this to be writable. It is not.
  assert.ok(/allow read: if true/.test(sellers), 'the badge must draw for a visitor who is not signed in')

  const create = sellers.match(/allow create: if[\s\S]*?;/)
  const update = sellers.match(/allow update: if[\s\S]*?;/)
  assert.ok(create && update, 'the seller document still has both halves of the write')
  assert.ok(
    /!\s*request\.resource\.data\.keys\(\)\.hasAny\(\['phoneVerified'\]\)/.test(create[0]),
    'a new seller document may not carry phoneVerified at all',
  )
  assert.ok(
    /!\s*request\.resource\.data\.diff\(resource\.data\)\.affectedKeys\(\)\.hasAny\(\['phoneVerified'\]\)/.test(update[0]),
    'a write may not so much as touch phoneVerified — it is a claim about the seller, not a setting',
  )
  // The exception is that one field, not the shop: the seller still owns everything else.
  assert.ok(/request\.auth\.uid == sellerId/.test(create[0]), 'the seller still creates their own document')
  assert.ok(/request\.auth\.uid == sellerId/.test(update[0]), 'the seller still edits their own document')
  // Nobody else may write it either — the only writer is the server, through firebase-admin.
  // Stripped first: this block's comment *quotes* the old `phoneVerified: true` to explain the bug.
  assert.ok(!/phoneVerified\s*:/.test(withoutComments(sellers)), 'the rules never set a value themselves')
  // Old shops keep the badge they earned, and *why* is written down next to the rule.
  assert.ok(markerOf(sellers, 'frozen snapshot') > 0, 'the reason old badges are left alone is recorded')
})

check('the proof lives where the person it is about cannot reach it', () => {
  const trust = ruleBlock('match /trust/{userId} {')
  // Public read is deliberate: a store page is shareable and its badge renders logged-out.
  assert.ok(/allow read:\s*if true/.test(trust), 'a public store page needs a publicly readable badge')
  assert.ok(/allow write:\s*if false/.test(trust), 'the browser may never write its own proof')
  // And the field it reads is the new one — if these diverge, every badge silently goes blank.
  assert.ok(!/phoneVerified/.test(withoutComments(trust)), 'the record the server writes is `phoneProven`, not the old field')
  // The promise that makes a public read safe is written down where the read is granted.
  assert.ok(markerOf(trust, 'must hold no') > 0, 'the reason this document may hold no number is recorded')
})

check('the codes, the day counter and the number ledger are closed to the browser', () => {
  // One line each, on purpose: there is no rule to read, and that *is* the rule. `firebase-admin`
  // bypasses rules entirely, so the server is the only thing that can touch them.
  const closed = [
    [/match \/otpCodes\/\{phoneKey\}\s*\{\s*allow read, write: if false;\s*\}/, 'the hashed code and its send counters'],
    [/match \/meta\/\{docId\}\s*\{\s*allow read, write: if false;\s*\}/, 'the day counter'],
    [/match \/phones\/\{phoneKey\}\s*\{\s*allow read, write: if false;\s*\}/, 'the number-to-account ledger'],
  ]
  closed.forEach(([pattern, what]) => {
    assert.ok(pattern.test(rulesText), `${what} must not be reachable from the browser`)
  })
  // A missing `match` would be closed by default too — until somebody adds a friendly rule to it.
  // These two are the ones whose leak would be silent, so they are named.
  const ruleLines = withoutComments(rulesText)
  assert.ok(!/otpCodes[\s\S]{0,60}allow (read|write): if true/.test(ruleLines))
  assert.ok(!/phones[\s\S]{0,60}allow (read|write): if true/.test(ruleLines))
})

check('the publicly readable proof holds the fact, the time and the flow — never the number', () => {
  const written = identitySrc.match(/collection\(TRUST\)\.doc\(uid\)\.set\(\{([\s\S]*?)\}/)
  assert.ok(written, 'identity.js is still the module that writes the trust record')
  const fields = [...written[1].matchAll(/(\w+):/g)].map(m => m[1]).sort()
  assert.deepStrictEqual(
    fields,
    ['method', 'phoneProven', 'phoneProvenAt', 'updatedAt'],
    'a document anyone can read may hold the proof and when it happened, and nothing more',
  )
  // The number is the one thing that must never appear here.
  assert.ok(!/\be164\b/.test(written[1]), 'the number itself must not be written where the world reads')
  assert.ok(!/phoneNumber/.test(written[1]), 'nor the Firebase Auth field that carries it')
  // Two ways to prove a number, and the record says which one did.
  assert.ok(/'social-link'/.test(written[1]) && /'phone-signup'/.test(written[1]))
})

check('the ledger that keeps one number to one account is keyed by an HMAC', () => {
  // So a dump of this collection is a list of opaque strings, not a list of who signed up.
  assert.ok(
    /collection\(PHONES\)\.doc\(phoneKey\(e164, pepper\)\)/.test(identitySrc),
    'the ledger key must be the HMAC from otp.js, never the number itself',
  )
  assert.ok(/import \{ phoneKey \} from '\.\/otp\.js'/.test(identitySrc), 'and it must be the same HMAC')
})

console.log(`\n${checks} rules checks passed`)
