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
const check = (name, fn) => { fn(); checks++; console.log('  ok  ' + name) }

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

console.log(`\n${checks} rules checks passed`)
