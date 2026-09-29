/**
 * Dev-only harness for the return policy (`src/returnPolicy.ts`).
 *
 *   npx tsc --ignoreConfig src/returnPolicy.ts --outDir _dsbuild --module commonjs --target es2020 --skipLibCheck
 *   Move-Item -Force _dsbuild/returnPolicy.js _dsbuild/returnPolicy.cjs
 *   node _return_policy_check.cjs
 *
 * Pins the promises an 86-day (just under three months) return policy is actually judged on: the
 * clock starts at delivery and not at payment, the day the window closes is printed as a real
 * calendar date, a fault is returnable whatever the item is, a seller who refuses has to say why,
 * and silence ends the seller's turn instead of the buyer's patience.
 */
const assert = require('assert')
const path = require('path')
const {
  RETURN_WINDOW_DAYS,
  RETURN_WINDOW_PLAIN,
  SELLER_ANSWER_HOURS,
  MAX_RETURN_NOTE,
  DAY_MS,
  RETURN_REASONS,
  returnReason,
  whoPaysReturn,
  isReturnable,
  BUYER_RETURN_STATES,
  SELLER_RETURN_STATES,
  returnIsOpen,
  returnStateWords,
  returnWindowEndsAt,
  durationWords,
  returnWindowWords,
  returnWindowClosesOnWords,
  returnWindowShortWords,
  canOpenReturn,
  returnPatch,
  buyerReturnPatch,
  sellerReturnPatch,
  sellerDecisionProblem,
  sellerAnswerDeadline,
  sellerAnswerWords,
  RETURN_PROMISE,
  RETURN_LIMITS,
  returnOpeningLine,
  returnRowLine,
} = require(path.join(__dirname, '_dsbuild', 'returnPolicy.cjs'))

let checks = 0
const check = (name, fn) => { fn(); checks++; console.log('  ok  ' + name) }

const NOW = Date.UTC(2026, 1, 12, 9, 0, 0)
const days = n => n * DAY_MS
const hours = n => n * 60 * 60 * 1000

/** An order the seller marked delivered `n` days ago — the only anchor the window uses. */
const deliveredDaysAgo = n => ({
  status: 'fulfilled',
  deliveredAtMs: NOW - days(n),
  category: 'Home',
  subCategory: 'Furniture',
})

check('the window is 86 days, counted from delivery', () => {
  assert.strictEqual(RETURN_WINDOW_DAYS, 86)
  assert.strictEqual(RETURN_WINDOW_PLAIN, 'just under three months')
  assert.strictEqual(returnWindowEndsAt(NOW, RETURN_WINDOW_DAYS), NOW + days(86))
  assert.strictEqual(returnWindowEndsAt(0), 0)          // unknown delivery date is never guessed
  assert.strictEqual(returnWindowWords(NOW, NOW).daysLeft, 86)
  assert.strictEqual(returnWindowWords(NOW, NOW + days(85)).daysLeft, 1)
  assert.strictEqual(returnWindowWords(NOW, NOW + days(85)).open, true)
  const closed = returnWindowWords(NOW, NOW + days(87))
  assert.strictEqual(closed.open, false)
  assert.strictEqual(closed.daysLeft, 0)
  assert.ok(closed.text.includes('closed'))
})

check('the window is printed as a real date, not only as a countdown', () => {
  // 12 Feb 2026 + 86 days lands in the first week of May 2026; the exact day moves with the
  // reader's own timezone, which is the point — it is a date they can check, not our arithmetic.
  const closes = returnWindowClosesOnWords(NOW)
  assert.match(closes, /^\d{1,2} May 2026$/)
  assert.strictEqual(returnWindowClosesOnWords(0), '')   // no delivery date, so no date claimed
  const open = returnWindowWords(NOW, NOW)
  assert.ok(open.text.includes(closes))
  assert.ok(open.text.includes('open until'))
  assert.ok(returnWindowWords(NOW, NOW + days(87)).text.includes(closes))
  assert.strictEqual(returnWindowShortWords(), 'the 86 days')
  assert.ok(returnStateWords('canceled', 'buyer').note.includes('the 86 days'))
})

check('a delivery date we do not have is said out loud, not invented', () => {
  const words = returnWindowWords(0, NOW)
  assert.strictEqual(words.open, false)
  assert.ok(words.text.includes('delivered'))
  assert.strictEqual(canOpenReturn({ status: 'fulfilled' }, NOW).ok, false)
})

check('the clock is delivery, not payment — an undelivered order cannot be returned yet', () => {
  for (const status of ['pending', 'paid', 'processing', 'shipped', 'canceled']) {
    const verdict = canOpenReturn({ status, deliveredAtMs: NOW - days(1) }, NOW)
    assert.strictEqual(verdict.ok, false, status)
    assert.ok(verdict.text.length > 0)
  }
  assert.strictEqual(canOpenReturn(deliveredDaysAgo(1), NOW).ok, true)
})

check('a live return cannot be started twice', () => {
  const closed = ['canceled', 'declined', 'refunded', 'completed']
  for (const state of BUYER_RETURN_STATES.concat(SELLER_RETURN_STATES)) {
    if (closed.includes(state)) continue
    const verdict = canOpenReturn({ ...deliveredDaysAgo(1), returnState: state }, NOW)
    assert.strictEqual(verdict.ok, false, state)
    assert.ok(verdict.text.includes('already'), state)
  }
  // A return the buyer withdrew inside the window may be started again.
  assert.strictEqual(canOpenReturn({ ...deliveredDaysAgo(1), returnState: 'canceled' }, NOW).ok, true)
  assert.ok(returnStateWords('canceled', 'buyer').note.includes('again'))
  // One that was decided cannot be reopened in either direction.
  for (const state of ['declined', 'refunded', 'completed']) {
    assert.strictEqual(canOpenReturn({ ...deliveredDaysAgo(1), returnState: state }, NOW).ok, false, state)
  }
  // The state lists stay disjoint: nobody may write the other side's state.
  for (const state of BUYER_RETURN_STATES) assert.strictEqual(SELLER_RETURN_STATES.includes(state), false, state)
})

check('after the window, the answer is "get help", not a locked door', () => {
  const late = canOpenReturn(deliveredDaysAgo(RETURN_WINDOW_DAYS + 2), NOW)
  assert.strictEqual(late.ok, false)
  assert.ok(late.text.includes('get help'))
})

check('a fault always lands on the seller, a change of mind on the buyer', () => {
  assert.strictEqual(whoPaysReturn('damaged').value, 'seller')
  assert.strictEqual(whoPaysReturn('changed_mind').value, 'buyer')
  assert.strictEqual(whoPaysReturn('nonsense').value, 'seller')   // unknown: never charge the buyer
  assert.strictEqual(returnReason('wrong_item').fault, 'seller')
  assert.strictEqual(returnReason('nope'), null)
})

check('underwear and food refuse a change of mind — and nothing else', () => {
  assert.strictEqual(isReturnable({ category: 'Underwear', reason: 'changed_mind' }).ok, false)
  assert.strictEqual(isReturnable({ category: 'Groceries', reason: 'changed_mind' }).ok, false)
  assert.strictEqual(isReturnable({ category: 'Electronics', reason: 'changed_mind' }).ok, true)
  // The same opened, un-resellable item, but something is wrong with it.
  assert.strictEqual(isReturnable({ category: 'Underwear', reason: 'damaged' }).ok, true)
  assert.strictEqual(isReturnable({ category: 'Underwear', reason: 'wrong_item' }).ok, true)
  assert.ok(isReturnable({ category: 'Underwear', reason: 'changed_mind' }).text.includes('covered'))
})

check('the reasons are short, plain and complete', () => {
  assert.ok(RETURN_REASONS.length >= 6)
  for (const reason of RETURN_REASONS) {
    assert.ok(reason.value && reason.label && reason.hint, reason.value)
    assert.ok(reason.label[0] !== reason.label[0].toLowerCase(), `"${reason.label}" is not a sentence`)
    assert.ok(reason.fault === 'seller' || reason.fault === 'buyer')
  }
  assert.strictEqual(new Set(RETURN_REASONS.map(r => r.value)).size, RETURN_REASONS.length)
})

check('starting a return writes the five fields the rules allow — and no clock of its own', () => {
  const patch = returnPatch({ reason: 'damaged', note: '  cracked lid on arrival  ', nowMs: NOW })
  assert.deepStrictEqual(Object.keys(patch).sort(), ['returnFault', 'returnNote', 'returnReason', 'returnRequestedAt', 'returnState'])
  assert.strictEqual(patch.returnState, 'requested')
  assert.strictEqual(patch.returnFault, 'seller')
  assert.strictEqual(patch.returnRequestedAt, NOW)
  assert.strictEqual(patch.returnNote, 'cracked lid on arrival')
  assert.strictEqual('updatedAt' in patch, false)      // a client clock is not evidence
})

check('an empty note is left out rather than written as empty text', () => {
  const patch = returnPatch({ reason: 'changed_mind', note: '   ', nowMs: NOW })
  assert.strictEqual('returnNote' in patch, false)
  assert.strictEqual(patch.returnFault, 'buyer')
  const long = returnPatch({ reason: 'other', note: 'x'.repeat(MAX_RETURN_NOTE + 50), nowMs: NOW })
  assert.strictEqual(long.returnNote.length, MAX_RETURN_NOTE)
})

check('a nonsense reason is written as "something else", never as undefined', () => {
  const patch = returnPatch({ reason: undefined, nowMs: NOW })
  assert.strictEqual(patch.returnReason, 'other')
  assert.strictEqual(patch.returnFault, 'seller')       // doubt lands on the side holding the stock
})

check('a buyer can never approve their own return', () => {
  assert.throws(() => buyerReturnPatch('approved', NOW), /not the buyer's to set/)
  assert.throws(() => buyerReturnPatch('refunded', NOW), /not the buyer's to set/)
  assert.throws(() => sellerReturnPatch('requested', NOW), /not the seller's to set/)
  assert.throws(() => sellerReturnPatch('canceled', NOW), /not the seller's to set/)
  const sent = buyerReturnPatch('photos_sent', NOW)
  assert.strictEqual(sent.returnState, 'photos_sent')
  assert.strictEqual(sent.returnUpdatedAt, NOW)
  const refunded = sellerReturnPatch('refunded', NOW)
  assert.strictEqual(refunded.returnState, 'refunded')
  assert.strictEqual(refunded.returnDecidedAt, NOW)
})

check('a refusal without a reason is not a decision', () => {
  assert.ok(sellerDecisionProblem('declined', '').length > 0)
  assert.ok(sellerDecisionProblem('declined', 'no').length > 0)
  assert.strictEqual(sellerDecisionProblem('declined', 'It was worn and washed already.'), '')
  assert.strictEqual(sellerDecisionProblem('approved', ''), '')
  assert.strictEqual(sellerDecisionProblem('photos_needed', ''), '')
  assert.strictEqual(sellerReturnPatch('declined', NOW).returnNote, undefined)
})

check('the seller has 48 hours, and silence ends their turn', () => {
  assert.strictEqual(SELLER_ANSWER_HOURS, 48)
  assert.strictEqual(sellerAnswerDeadline(NOW), NOW + hours(48))
  const early = sellerAnswerWords(NOW, NOW + hours(47))
  assert.strictEqual(early.late, false)
  assert.ok(early.text.includes('48 hours'))
  const late = sellerAnswerWords(NOW, NOW + hours(49))
  assert.strictEqual(late.late, true)
  assert.strictEqual(late.msLeft, 0)
  assert.ok(late.text.includes('take over'))
  assert.strictEqual(sellerAnswerWords(0, NOW).text, '')   // nothing to say about a request that never happened
})

check('every state says what it means, to the person reading it', () => {
  for (const state of BUYER_RETURN_STATES.concat(SELLER_RETURN_STATES)) {
    const buyer = returnStateWords(state, 'buyer')
    const seller = returnStateWords(state, 'seller')
    assert.ok(buyer && buyer.text && buyer.note, state)
    assert.ok(seller && seller.text && seller.note, state)
    assert.ok(['waiting', 'good', 'bad', 'done'].includes(buyer.tone), state)
  }
  assert.strictEqual(returnStateWords('', 'buyer'), null)
  assert.strictEqual(returnStateWords('refunded', 'buyer').tone, 'done')
  assert.strictEqual(returnStateWords('declined', 'buyer').tone, 'bad')
  assert.strictEqual(returnStateWords('declined', 'seller').tone, 'bad')
  assert.strictEqual(returnStateWords(null, 'seller'), null)
})

check('the top of the sheet says what to do before the form is filled in', () => {
  const open = returnOpeningLine(deliveredDaysAgo(2), NOW)
  assert.ok(open.includes(`${RETURN_WINDOW_DAYS - 2} days left`))
  assert.ok(open.includes('open until'))
  assert.ok(open.includes(returnWindowClosesOnWords(NOW - days(2))))
  assert.ok(open.includes(String(SELLER_ANSWER_HOURS)))
  const shut = returnOpeningLine(deliveredDaysAgo(RETURN_WINDOW_DAYS + 4), NOW)
  assert.strictEqual(shut, canOpenReturn(deliveredDaysAgo(RETURN_WINDOW_DAYS + 4), NOW).text)
})

check('the order row carries the clock, so nobody has to count days', () => {
  const requested = NOW - hours(49)
  const line = returnRowLine({ returnState: 'requested', returnRequestedAtMs: requested }, NOW)
  assert.ok(line.includes('Return sent to the seller'))
  assert.ok(line.includes('seller is late'))
  const fresh = returnRowLine({ returnState: 'requested', returnRequestedAtMs: NOW - hours(2) }, NOW)
  assert.strictEqual(fresh, 'Return sent to the seller')
  assert.strictEqual(returnRowLine({}, NOW), '')
})

check('the promise and the limits are shown, in full, on the page', () => {
  assert.ok(RETURN_PROMISE.length >= 5)
  const promise = RETURN_PROMISE.map(item => `${item.title} ${item.body}`).join(' ')
  assert.ok(promise.includes(`${RETURN_WINDOW_DAYS} days`))
  assert.ok(promise.includes(RETURN_WINDOW_PLAIN))      // the number and the plain words, together
  assert.ok(promise.includes(`${SELLER_ANSWER_HOURS} hours`))
  assert.ok(promise.includes('Always returnable'))
  assert.ok(promise.includes('calendar day'))           // the closing date is promised, not implied
  assert.ok(!/\b7 days\b|\bseven days\b/.test(promise), 'the old window is still being quoted')
  assert.ok(RETURN_LIMITS.length >= 2)                 // the honest limits are never hidden
  for (const item of RETURN_PROMISE.concat(RETURN_LIMITS)) {
    assert.ok(item.icon && item.title && item.body)
  }
  assert.ok(durationWords(days(1) + hours(2)).includes('day'))
  assert.ok(durationWords(hours(3)).includes('hours'))
  assert.ok(durationWords(-9999).includes('minute'))   // never a negative duration
})

console.log('\n' + checks + ' return-policy checks passed')
