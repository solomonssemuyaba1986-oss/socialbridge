/**
 * Dev-only harness for the feedback asking rules (`src/feedbackRules.ts`).
 *
 *   npx tsc --ignoreConfig src/feedbackRules.ts --outDir _dsbuild --module commonjs --target es2020 --skipLibCheck
 *   Move-Item -Force _dsbuild/feedbackRules.js _dsbuild/feedbackRules.cjs
 *   node _feedback_check.cjs
 *
 * "At least everyone should be asked what they didn't like" only works if the asking is
 * predictable: not on the first page, not twice in a week, and never again for three months
 * once somebody has answered. That policy is pinned here.
 */
const assert = require('assert')
const path = require('path')
const {
  DONE_COOLDOWN_MS,
  MIN_PAGES,
  SNOOZE_MS,
  countVisitedPage,
  feedbackMemoryStore,
  markAsked,
  markDone,
  readFeedbackMemory,
  readFeedbackVisit,
  shouldAskFeedback,
} = require(path.join(__dirname, '_dsbuild', 'feedbackRules.cjs'))

let checks = 0
const check = (name, fn) => { fn(); checks++; console.log('  ok  ' + name) }

/** The same surface localStorage exposes, in memory. */
function mem() {
  const map = new Map()
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)) },
    removeItem: (k) => { map.delete(k) },
  }
}

const DAY = 24 * 60 * 60 * 1000

check('somebody who has barely looked around is NOT asked', () => {
  for (let actions = 0; actions < MIN_PAGES; actions++) {
    assert.strictEqual(shouldAskFeedback({ actions, askedAt: 0, doneAt: 0 }), false, `${actions} pages`)
  }
  assert.strictEqual(shouldAskFeedback({ actions: MIN_PAGES, askedAt: 0, doneAt: 0 }), true)
})

check('"Later" buys a week of quiet, then the question comes back', () => {
  const now = 1_700_000_000_000
  assert.strictEqual(shouldAskFeedback({ actions: 5, askedAt: now, doneAt: 0, now }), false)
  assert.strictEqual(shouldAskFeedback({ actions: 5, askedAt: now, doneAt: 0, now: now + 6 * DAY }), false)
  assert.strictEqual(
    shouldAskFeedback({ actions: 5, askedAt: now, doneAt: 0, now: now + SNOOZE_MS + 1 }),
    true,
  )
})

check('somebody who already answered is left alone for three months', () => {
  const now = 1_700_000_000_000
  // Answered a moment ago: nothing for the next three months.
  const answered = { actions: 9, askedAt: now, doneAt: now, now }
  assert.strictEqual(shouldAskFeedback(answered), false)
  assert.strictEqual(shouldAskFeedback({ ...answered, now: now + 89 * DAY }), false)
  assert.strictEqual(shouldAskFeedback({ ...answered, now: now + DONE_COOLDOWN_MS + 1 }), true)
  // An answer from long ago no longer holds the question back.
  assert.strictEqual(
    shouldAskFeedback({ actions: 9, askedAt: now - 200 * DAY, doneAt: now - 200 * DAY, now }),
    true,
  )
})

check('the memory remembers an answer without forgetting the ask', () => {
  const store = mem()
  assert.deepStrictEqual(readFeedbackMemory(store), { askedAt: 0, doneAt: 0 })
  markAsked(store, 111)
  assert.deepStrictEqual(readFeedbackMemory(store), { askedAt: 111, doneAt: 0 })
  markDone(store, 222)
  assert.deepStrictEqual(readFeedbackMemory(store), { askedAt: 111, doneAt: 222 })
})

check('a corrupt memory reads as never-asked instead of throwing', () => {
  const store = mem()
  store.setItem('rachett_feedback', '{not json')
  assert.deepStrictEqual(readFeedbackMemory(store), { askedAt: 0, doneAt: 0 })
  store.setItem('rachett_feedback', '{"askedAt":"soon","doneAt":null}')
  assert.deepStrictEqual(readFeedbackMemory(store), { askedAt: 0, doneAt: 0 })
})

check('only DIFFERENT pages count towards "they have used it"', () => {
  const store = mem()
  assert.strictEqual(countVisitedPage(store, '/browse'), 1)
  assert.strictEqual(countVisitedPage(store, '/browse'), 1, 'the same page again is not progress')
  assert.strictEqual(countVisitedPage(store, '/nearby'), 2)
  assert.strictEqual(countVisitedPage(store, '/bag'), 3)
  assert.strictEqual(countVisitedPage(store, '/bag'), 3)
  assert.deepStrictEqual(readFeedbackVisit(store).pages, ['/browse', '/nearby', '/bag'])
})

check('a corrupt visit list never blocks the count', () => {
  const store = mem()
  store.setItem('rachett_feedback_visit', 'garbage')
  assert.strictEqual(countVisitedPage(store, '/browse'), 1)
  store.setItem('rachett_feedback_visit', '{"pages":[1,2,null]}')
  assert.deepStrictEqual(readFeedbackVisit(store).pages, [])
  assert.strictEqual(countVisitedPage(store, '/nearby'), 1)
})

check('storage being blocked falls back to memory instead of crashing', () => {
  const blocked = {
    getItem: () => { throw new Error('blocked') },
    setItem: () => { throw new Error('blocked') },
    removeItem: () => { throw new Error('blocked') },
  }
  const originalWindow = global.window
  global.window = { localStorage: blocked, sessionStorage: blocked }
  try {
    const store = feedbackMemoryStore()
    markAsked(store, 42)
    assert.deepStrictEqual(readFeedbackMemory(store), { askedAt: 42, doneAt: 0 })
  } finally {
    global.window = originalWindow
  }
})

console.log('\n' + checks + ' feedback checks passed')
