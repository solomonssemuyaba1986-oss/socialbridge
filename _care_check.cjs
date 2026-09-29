/**
 * Dev-only harness for customer care (`src/care.ts`).
 *
 *   npx tsc --ignoreConfig src/care.ts --outDir _dsbuild --module commonjs --target es2020 --skipLibCheck
 *   Move-Item -Force _dsbuild/care.js _dsbuild/care.cjs
 *   node _care_check.cjs
 *
 * Pins the four promises the module is built on: the message is written for you from the real order,
 * a person answers within 24 hours and the clock says so once it has passed, the seller never sees
 * the ticket, and nothing is a dead end for somebody who has already given up once.
 */
const assert = require('assert')
const path = require('path')
const {
  CARE_SLA_HOURS,
  MAX_CARE_NOTE,
  MAX_CARE_PHOTOS,
  CARE_ISSUES,
  careIssue,
  careDateWords,
  careItemWords,
  careDraft,
  careTicket,
  careTicketDoc,
  careAgoWords,
  careIsOverdue,
  careTicketLine,
  careChecklist,
  CARE_PROMISE,
} = require(path.join(__dirname, '_dsbuild', 'care.cjs'))

let checks = 0
const check = (name, fn) => { fn(); checks++; console.log('  ok  ' + name) }

const NOW = Date.UTC(2026, 1, 12, 9, 0, 0)
const hours = n => n * 60 * 60 * 1000

/** The order the ticket is written about — the only context the sheet has. */
const order = {
  orderId: 'ORD-4471',
  itemName: 'Chair',
  quantity: 2,
  shopName: 'Kigali Furniture',
  sellerId: 'seller-9',
  orderedAtMs: new Date(2026, 1, 2, 8, 30, 0).getTime(),
}

check('the message is already written, with this order in it', () => {
  const draft = careDraft('not_arrived', order)
  assert.ok(draft.includes('2 × Chair'))
  assert.ok(draft.includes('Kigali Furniture'))
  assert.ok(draft.includes('ORD-4471'))
  assert.ok(draft.includes('02/02/2026'))
  assert.strictEqual(draft.includes('{'), false, 'a placeholder was left in the message')
  assert.strictEqual(/undefined|NaN/.test(draft), false)
})

check('anything we do not know is left out, not filled with the word "undefined"', () => {
  const draft = careDraft('not_arrived', {})
  assert.ok(draft.includes('the seller'))
  assert.ok(draft.includes('a while ago'))
  assert.ok(draft.includes('unknown'))
  assert.strictEqual(draft.includes('{'), false)
  assert.strictEqual(careDateWords('garbage'), '')
  assert.strictEqual(careDateWords(0), '')
  assert.strictEqual(careItemWords({}), 'an item')
  assert.strictEqual(careItemWords({ itemName: 'Chair', quantity: 1 }), 'Chair')
  assert.strictEqual(careItemWords({ itemName: 'Chair', quantity: 2 }), '2 × Chair')
})

check('the buyer\'s own words are added to the draft, never swapped for it', () => {
  const base = careDraft('no_refund', order)
  const withNote = careDraft('no_refund', order, '  It has been two weeks now.  ')
  assert.ok(withNote.startsWith(base.replace(/\n\n$/, '')))
  assert.ok(withNote.includes('It has been two weeks now.'))
  assert.ok(withNote.length > base.length)
  // Typing the same sentence twice does not send it twice.
  assert.strictEqual(careDraft('no_refund', order, base).includes(base + '\n\n' + base), false)
  const huge = careDraft('no_refund', order, 'x'.repeat(MAX_CARE_NOTE + 100))
  assert.ok(huge.length < MAX_CARE_NOTE + 500)
})

check('the document written to Firestore is the one the rules accept', () => {
  const ticket = careTicket({ issue: 'wrong_or_damaged', context: order, note: 'the screen arrived cracked', photoUrls: ['a.jpg'], nowMs: NOW })
  const doc = careTicketDoc(ticket, 'uid-1')
  // The rules read the author off the document, and demand these three by value.
  assert.strictEqual(doc.uid, 'uid-1')
  assert.strictEqual(doc.status, 'open')
  assert.strictEqual(doc.source, 'care')
  assert.strictEqual(typeof doc.message, 'string')
  assert.ok(doc.message.length > 0)
  // 900 is the rules' own ceiling — the app can never build a ticket they would refuse.
  assert.ok(doc.message.length <= 900)
  // Even a ticket handed in with an impossible message comes out inside the rules' cap.
  const giant = { ...careTicket({ issue: 'no_refund', context: order, nowMs: NOW }), message: 'x'.repeat(5000) }
  assert.strictEqual(careTicketDoc(giant, 'uid-1').message.length, 900)
  // Nothing we do not know is written as an empty string, and no key is invented.
  const bare = careTicketDoc(careTicket({ issue: 'app_problem', nowMs: NOW }), 'uid-1')
  assert.deepStrictEqual(
    Object.keys(bare).sort(),
    ['createdAtMs', 'issue', 'message', 'slaHours', 'source', 'status', 'subject', 'topic', 'uid'],
  )
  assert.deepStrictEqual(doc.photoUrls, ['a.jpg'])
  assert.deepStrictEqual(Object.keys(careTicketDoc(careTicket({ issue: 'app_problem', nowMs: NOW }), 'uid-1')).includes('photoUrls'), false)
})

check('an issue we do not know is still a ticket, never a crash', () => {
  const ticket = careTicket({ issue: 'nonsense', context: order, nowMs: NOW })
  assert.strictEqual(ticket.issue, 'something_else')
  assert.strictEqual(ticket.topic, 'app')
  assert.ok(ticket.subject.length > 0)
  assert.strictEqual(careIssue(null), null)
  assert.strictEqual(careIssue('nonsense'), null)
  assert.strictEqual(careIssue('not_arrived').value, 'not_arrived')
})

check('the ticket carries everything a person needs, and nothing they do not', () => {
  const ticket = careTicket({
    issue: 'wrong_or_damaged',
    context: { ...order, returnState: 'declined', returnReason: 'changed_mind' },
    nowMs: NOW,
  })
  assert.strictEqual(ticket.status, 'open')
  assert.strictEqual(ticket.slaHours, CARE_SLA_HOURS)
  assert.strictEqual(ticket.createdAtMs, NOW)
  assert.strictEqual(ticket.source, 'care')
  assert.strictEqual(ticket.orderId, 'ORD-4471')
  assert.strictEqual(ticket.sellerId, 'seller-9')
  assert.strictEqual(ticket.shopName, 'Kigali Furniture')
  assert.deepStrictEqual(ticket.photoUrls, [])
  // A return already running travels with the complaint instead of being retyped by the buyer.
  assert.strictEqual(ticket.returnState, 'declined')
  assert.strictEqual(ticket.returnReason, 'changed_mind')
  // The seller's own copy is not a field: a ticket is the buyer's and rachett's business.
  assert.strictEqual('sellerVisible' in ticket, false)
  assert.strictEqual('messages' in ticket, false)
})

check('photos are trimmed, capped and never blank strings', () => {
  const many = careTicket({
    issue: 'wrong_or_damaged',
    context: order,
    photoUrls: ['a.jpg', '  ', '', 'b.jpg', 'c.jpg', 'd.jpg', null, 7],
    nowMs: NOW,
  })
  assert.deepStrictEqual(many.photoUrls, ['a.jpg', 'b.jpg', 'c.jpg'])
  assert.strictEqual(many.photoUrls.length, MAX_CARE_PHOTOS)
  const notAnArray = careTicket({ issue: 'app_problem', context: order, photoUrls: 'a.jpg', nowMs: NOW })
  assert.deepStrictEqual(notAnArray.photoUrls, [])
})

check('we are judged against our own 24 hours', () => {
  assert.strictEqual(CARE_SLA_HOURS, 24)
  assert.strictEqual(careIsOverdue(NOW - hours(23), NOW), false)
  assert.strictEqual(careIsOverdue(NOW - hours(25), NOW), true)
  assert.strictEqual(careIsOverdue(0, NOW), false)      // a ticket that never happened is not late
  assert.strictEqual(careIsOverdue(NOW - hours(25), NOW, 48), false)   // the SLA is honoured when passed
})

check('a missed promise is said out loud, not quietly forgotten', () => {
  const fresh = careTicketLine({ createdAtMs: NOW - hours(2), status: 'open' }, NOW)
  assert.ok(fresh.includes('2 hours ago'))
  assert.ok(fresh.includes('22 hours'))
  const missed = careTicketLine({ createdAtMs: NOW - hours(30), status: 'open' }, NOW)
  assert.ok(missed.includes('past the 24 hours we promised'))
  assert.ok(missed.includes('a person'))
  const closed = careTicketLine({ createdAtMs: NOW - hours(30), status: 'closed' }, NOW)
  assert.ok(closed.startsWith('Closed'))
  assert.strictEqual(careTicketLine({}, NOW), '')
  assert.strictEqual(careTicketLine({ createdAtMs: 0, status: 'open' }, NOW), '')
  // The words never promise "in progress" — the buyer is told what actually happens next.
  assert.strictEqual(/in progress/i.test(fresh + missed + closed), false)
  assert.ok(careTicketLine({ createdAtMs: NOW - hours(2), slaHours: 48 }, NOW).includes('46 hours'))
})

check('"sent 2 hours ago" is written the way a person says it', () => {
  assert.strictEqual(careAgoWords(0), 'just now')
  assert.strictEqual(careAgoWords(30 * 1000), 'just now')
  assert.strictEqual(careAgoWords(90 * 1000), '2 minutes ago')
  assert.strictEqual(careAgoWords(hours(1)), '1 hour ago')
  assert.strictEqual(careAgoWords(hours(3)), '3 hours ago')
  assert.strictEqual(careAgoWords(24 * hours(2)), '2 days ago')
  assert.strictEqual(careAgoWords(-5000), 'just now')   // never "in -1 minutes"
})

check('the checklist is help, not homework', () => {
  const damaged = careChecklist('wrong_or_damaged')
  assert.ok(damaged.length > 0 && damaged.length <= 2)
  assert.ok(damaged[0].toLowerCase().includes('photo'))
  assert.strictEqual(careChecklist('payment_problem').length, 2)
  assert.ok(careChecklist('payment_problem').some(line => line.includes('order number')))
  assert.ok(careChecklist('seller_behaviour').some(line => line.includes('shop')))
  assert.deepStrictEqual(careChecklist('nonsense'), [])
  for (const issue of CARE_ISSUES) {
    assert.ok(careChecklist(issue.value).length <= 2, issue.value)
  }
})

check('the way in is short, and every door is a real one', () => {
  assert.ok(CARE_ISSUES.length >= 6 && CARE_ISSUES.length <= 10)
  assert.strictEqual(new Set(CARE_ISSUES.map(i => i.value)).size, CARE_ISSUES.length)
  const topics = []
  for (const issue of CARE_ISSUES) {
    assert.ok(issue.label && issue.icon && issue.hint && issue.subject && issue.message, issue.value)
    assert.ok(issue.label.includes(' '), `"${issue.label}" is a label, not a sentence`)
    assert.ok(['delivery', 'item', 'money', 'seller', 'app'].includes(issue.topic), issue.value)
    assert.strictEqual(typeof issue.needsOrder, 'boolean')
    topics.push(issue.topic)
  }
  // Every money problem is reachable: the buyer in a bad mood at 9pm finds their sentence.
  for (const topic of ['delivery', 'item', 'money', 'seller', 'app']) assert.ok(topics.includes(topic), topic)
  // An order-based issue always names the order in the message it sends.
  for (const issue of CARE_ISSUES.filter(i => i.needsOrder && i.value !== 'seller_behaviour')) {
    assert.ok(issue.message.includes('{order}') || issue.message.includes('{item}'), issue.value)
  }
})

check('the promise is read before the problem is typed', () => {
  assert.ok(CARE_PROMISE.length >= 3)
  const words = CARE_PROMISE.map(item => `${item.title} ${item.body}`).join(' ')
  assert.ok(words.includes(`${CARE_SLA_HOURS} hours`))
  assert.ok(words.includes('already written'))
  assert.ok(words.includes('never sees this'))
  for (const item of CARE_PROMISE) assert.ok(item.icon && item.title && item.body)
})

console.log('\n' + checks + ' care checks passed')
