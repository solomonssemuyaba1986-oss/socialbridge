/**
 * Dev-only harness for the 💎 Reliable Seller badge — pinning the two halves together.
 *
 *   npx tsc --ignoreConfig src/reliableBadge.ts --outDir _dsbuild --module commonjs --target es2020 --skipLibCheck
 *   Move-Item -Force _dsbuild/reliableBadge.js _dsbuild/reliableBadge.cjs
 *   node _reliable_check.cjs
 *
 * The badge rests on two numbers only rachett can produce — a shop's order-completion rate and its
 * average first-reply time. Two files touch them:
 *
 *   functions/sellerStats.js   the math: turns raw orders and messages into each number
 *   src/reliableBadge.ts       the rule: the thresholds the app judges the numbers by
 *
 * If the two ever disagree — a rounding change on one side, an 80/75 flip on the other — the badge
 * moves for every shop at once, silently. So this file requires both and compares them on a table
 * of inputs, boundaries (80%, 120 min) included. It also proves the rest of the wiring: the
 * redundant 🔵 badge is gone, the browser cannot write the numbers, and the Cloud Functions that
 * produce them are actually exported.
 */
const assert = require('assert')
const fs = require('fs')
const path = require('path')

let checks = 0
const check = (name, fn) => {
  try {
    fn()
  } catch (err) {
    console.error(`FAIL  ${name}`)
    err.message = `${name}\n    ${err.message}`
    throw err
  }
  checks++
  console.log('  ok  ' + name)
}

const BUILD = path.join(__dirname, '_dsbuild', 'reliableBadge.cjs')
if (!fs.existsSync(BUILD)) {
  console.error('\n  _dsbuild/reliableBadge.cjs is missing. Build it first:\n')
  console.error('    npx tsc --ignoreConfig src/reliableBadge.ts --outDir _dsbuild --module commonjs --target es2020 --skipLibCheck')
  console.error('    Move-Item -Force _dsbuild/reliableBadge.js _dsbuild/reliableBadge.cjs\n')
  process.exit(1)
}
const badge = require(BUILD)
const stats = require(path.join(__dirname, 'functions', 'sellerStats.js'))

const read = (rel) => fs.readFileSync(path.join(__dirname, rel), 'utf8')

/** Every .ts/.tsx under src/, however deep. */
function srcFiles() {
  const out = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.tsx?$/.test(entry.name)) out.push(full)
    }
  }
  walk(path.join(__dirname, 'src'))
  return out
}

const CASES = [
  { name: 'both clear', realSeller: true, orderCompletionRate: 100, totalOrders: 10, avgResponseMinutes: 30, want: true },
  { name: 'exactly 80% and 119 min', realSeller: true, orderCompletionRate: 80, totalOrders: 16, avgResponseMinutes: 119, want: true },
  { name: 'a single finished order, answered fast', realSeller: true, orderCompletionRate: 100, totalOrders: 1, avgResponseMinutes: 5, want: true },
  { name: '79%, one under the line', realSeller: true, orderCompletionRate: 79, totalOrders: 16, avgResponseMinutes: 30, want: false },
  { name: 'exactly 120 min is too slow', realSeller: true, orderCompletionRate: 100, totalOrders: 4, avgResponseMinutes: 120, want: false },
  { name: 'no reply measured yet', realSeller: true, orderCompletionRate: 100, totalOrders: 4, avgResponseMinutes: null, want: false },
  { name: 'no orders yet', realSeller: true, orderCompletionRate: null, totalOrders: 0, avgResponseMinutes: 10, want: false },
  { name: 'not a real seller', realSeller: false, orderCompletionRate: 100, totalOrders: 10, avgResponseMinutes: 10, want: false },
]

check('the two thresholds are the same number in both files', () => {
  assert.strictEqual(
    stats.COMPLETION_PCT, badge.RELIABLE_COMPLETION_PCT,
    'sellerStats.js and reliableBadge.ts disagree on the completion line',
  )
  assert.strictEqual(
    stats.MAX_RESPONSE_MINUTES, badge.RELIABLE_MAX_RESPONSE_MINUTES,
    'sellerStats.js and reliableBadge.ts disagree on the reply-time line',
  )
  assert.strictEqual(badge.RELIABLE_COMPLETION_PCT, 80)
  assert.strictEqual(badge.RELIABLE_MAX_RESPONSE_MINUTES, 120)
})

check('the server math and the app rule judge every case the same way', () => {
  for (const c of CASES) {
    const signals = {
      realSeller: c.realSeller,
      orderCompletionRate: c.orderCompletionRate,
      totalOrders: c.totalOrders,
      avgResponseMinutes: c.avgResponseMinutes,
    }
    assert.strictEqual(badge.meetsReliableCriteria(signals), c.want, `rule misjudged: ${c.name}`)
    assert.strictEqual(stats.meetsReliableCriteria(signals), c.want, `math misjudged: ${c.name}`)
  }
})

check('a completion rate is a whole percent, and an empty shop has none', () => {
  assert.strictEqual(stats.orderCompletionRate(10, 16), 63)
  assert.strictEqual(stats.orderCompletionRate(16, 16), 100)
  assert.strictEqual(stats.orderCompletionRate(1, 1), 100)
  assert.strictEqual(stats.orderCompletionRate(0, 0), null, 'nothing over nothing is not 100%')
  assert.strictEqual(stats.countCompleted([
    { status: 'fulfilled' }, { status: 'cancelled' }, { status: 'fulfilled' },
  ]), 2)
})

check('a first reply is measured, but a seller who speaks first is not a responder', () => {
  const buyerFirst = [
    { senderId: 'buyer', atMillis: 0 },
    { senderId: 'seller', atMillis: 90 * 60000 },
  ]
  assert.strictEqual(stats.firstResponseMinutes(buyerFirst, 'seller', 'buyer'), 90)
  const sellerFirst = [
    { senderId: 'seller', atMillis: 0 },
    { senderId: 'buyer', atMillis: 60000 },
  ]
  assert.strictEqual(stats.firstResponseMinutes(sellerFirst, 'seller', 'buyer'), null)
  assert.strictEqual(stats.firstResponseMinutes([{ senderId: 'buyer', atMillis: 0 }], 'seller', 'buyer'), null)
})

check('replies fold into a running average the same way every time', () => {
  const one = stats.accumulateResponse(null, 30)
  assert.deepStrictEqual(one, { responsesMeasured: 1, responseTotalMinutes: 30, avgResponseMinutes: 30 })
  const two = stats.accumulateResponse(one, 90)
  assert.deepStrictEqual(two, { responsesMeasured: 2, responseTotalMinutes: 120, avgResponseMinutes: 60 })
})

check('the browser cannot write the numbers the badge is judged on', () => {
  const rules = read('firestore.rules')
  assert.ok(
    /match \/stats\/\{statId\}\s*\{\s*allow read:\s*if true;\s*allow write:\s*if false;\s*\}/.test(rules),
    'stats must be world-readable and server-only to write — a seller may not award themselves the badge',
  )
})

check('the redundant Active badge is gone from the app', () => {
  const files = srcFiles()
  assert.ok(files.length >= 40, `expected the app's source tree, found ${files.length} files`)
  files.forEach((file) => {
    assert.ok(
      !/activeSellerBadge/.test(fs.readFileSync(file, 'utf8')),
      `${path.relative(__dirname, file)} still mentions the removed Active badge`,
    )
  })
})

check('the store page shows the Reliable chip instead of the Active one', () => {
  const store = read('src/StorePage.tsx')
  assert.ok(/sellerStats\.reliableSellerBadge/.test(store), 'the store page must draw the Reliable chip')
  assert.ok(/Reliable Seller/.test(store), 'the chip must read "Reliable Seller"')
  assert.ok(!/Active Seller/.test(store), 'the Active chip must be gone')
})

check('the hook reads the server numbers and judges them with the shared rule', () => {
  const hook = read('src/useSellerStats.ts')
  assert.ok(/meetsReliableCriteria/.test(hook), 'the hook must judge the badge with reliableBadge.ts')
  assert.ok(/stats', 'main'/.test(hook), 'the hook must read sellers/{uid}/stats/main')
  assert.ok(/orderCompletionRate:\s*data\.orderCompletionRate/.test(hook), 'the completion rate must come from the server document')
  assert.ok(/avgResponseMinutes:\s*data\.avgResponseMinutes/.test(hook), 'the reply average must come from the server document')
})

check('the Cloud Functions that produce the numbers are exported', () => {
  const index = read('functions/index.js')
  assert.ok(/exports\.recomputeSellerCompletion\s*=/.test(index), 'the completion trigger must be exported')
  assert.ok(/exports\.recordSellerFirstResponse\s*=/.test(index), 'the first-response trigger must be exported')
  assert.ok(/require\('\.\/sellerStats'\)/.test(index), 'index.js must use the shared sellerStats math')
  assert.ok(/'sellers\/\{sellerId\}\/orders\/\{orderId\}'/.test(index), 'the completion trigger must watch the orders collection')
  assert.ok(/'conversations\/\{conversationId\}\/messages\/\{messageId\}'/.test(index), 'the response trigger must watch the messages collection')
})

check('the seller dashboard renders the progress card', () => {
  const dash = read('src/Dashboard.tsx')
  assert.ok(/ReliableBadgeCard/.test(dash), 'the dashboard must render the Reliable progress card')
  assert.ok(/reliableStats\.orderCompletionRate/.test(dash), 'the card must be fed the server numbers')
})

console.log(`\n${checks} reliable-badge checks passed`)

