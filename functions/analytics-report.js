/**
 * rachett journey analytics — funnels, conversion, search, product performance,
 * seller performance, acquisition sources and the Nearby block, computed from
 * the raw `events` collection.
 *
 *   cd functions
 *   npm install                                    # once — installs firebase-admin
 *   node analytics-report.js --since=2026-09-01
 *   node analytics-report.js --since=2026-08-01 --seller=<uid>
 *   node analytics-report.js --since=2026-09-01 --json > report.json
 *   node analytics-report.js --since=2026-09-01 --out=../report.txt
 *
 * Credentials: point GOOGLE_APPLICATION_CREDENTIALS at a service-account JSON, or
 * run `firebase login` first so application default credentials are used.
 *
 * What it reads: every document in `events`. v2 batches (schemaVersion 2) carry
 * an array of events with a session/anonymous id and a first-touch channel; the
 * older v1 documents are single events with a `data` bag. Both are reported so
 * history stays comparable — see ANALYTICS.md for the taxonomy.
 *
 * PRIVACY: nothing here prints names, phone numbers, emails or message text —
 * the taxonomy bans those from events in the first place (DATA_COLLECTION.md §8).
 */
const admin = require('firebase-admin')

const PROJECT_ID = process.env.GCLOUD_PROJECT || 'socialbridge-93ee1'
const PAGE = 500

// ─── flags ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)

function flag(name, fallback = '') {
  const hit = args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return fallback
  return hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : 'true'
}

const SINCE = flag('since', '')
const UNTIL = flag('until', '')
const SELLER = flag('seller', '')
const OUT = flag('out', '')
const AS_JSON = args.includes('--json')
const TOP = Math.max(1, Number(flag('top', '15')) || 15)
/** Default window: the last 30 days. */
const SINCE_MS = SINCE ? Date.parse(SINCE) : Date.now() - 30 * 24 * 60 * 60 * 1000
const UNTIL_MS = UNTIL ? Date.parse(UNTIL) : Date.now()

if (SINCE && Number.isNaN(SINCE_MS)) {
  console.error(`--since must look like 2026-09-01 (got "${SINCE}")`)
  process.exit(1)
}
if (UNTIL && Number.isNaN(UNTIL_MS)) {
  console.error(`--until must look like 2026-09-30 (got "${UNTIL}")`)
  process.exit(1)
}

/** Firestore is opened lazily so the pure report logic can be tested without credentials. */
let _db = null
function getDb() {
  if (!_db) {
    admin.initializeApp({ projectId: PROJECT_ID })
    _db = admin.firestore()
  }
  return _db
}

// ─── loading ───────────────────────────────────────────────────────────────
function millis(value) {
  if (!value) return 0
  if (typeof value === 'number') return value
  if (typeof value.toMillis === 'function') return value.toMillis()
  if (typeof value.toDate === 'function') return value.toDate().getTime()
  if (value instanceof Date) return value.getTime()
  return 0
}

function dayKey(ms) {
  if (!ms) return 'unknown'
  return new Date(ms).toISOString().slice(0, 10)
}

/** v2 batch, or a v1 single event — both become one flat shape. */
function flatten(doc) {
  const d = doc.data()
  if (Array.isArray(d.events)) {
    const source = (d.firstTouch && d.firstTouch.source) || ''
    return d.events.map((e) => ({
      name: e.n,
      at: typeof e.t === 'number' ? e.t : millis(d.clientAt),
      route: e.r || '',
      source: e.s || source,
      sessionId: d.sessionId || null,
      anonymousId: d.anonymousId || null,
      userId: d.userId || 'guest',
      role: d.role || null,
      appVersion: d.appVersion || null,
      props: e.p || {},
      schema: 2,
    }))
  }
  const at = millis(d.createdAt)
  return [{
    name: d.event || 'unknown',
    at,
    route: '',
    source: d.sourcePlatform || '',
    sessionId: null,
    anonymousId: null,
    userId: d.userId || 'guest',
    role: null,
    appVersion: null,
    props: d.data || {},
    schema: 1,
  }]
}

async function pageThrough(baseQuery, label) {
  const events = []
  let cursor = null
  for (;;) {
    let q = baseQuery
    if (cursor) q = q.startAfter(cursor)
    const snap = await withTimeout(q.get(), READ_TIMEOUT_MS, `${label} read`)
    if (snap.empty) break
    snap.docs.forEach((doc) => events.push(...flatten(doc)))
    cursor = snap.docs[snap.docs.length - 1]
    if (snap.size < PAGE) break
  }
  console.log(`  ${label}: ${events.length} events`)
  return events
}

async function loadEvents() {
  const events = []
  // v2 batches carry a numeric clientAt; v1 documents carry a createdAt timestamp.
  // Two single-field range queries — no composite index, and each one is cheap.
  events.push(...await pageThrough(
    getDb().collection('events').where('clientAt', '>=', SINCE_MS).where('clientAt', '<=', UNTIL_MS).limit(PAGE),
    'v2 batches',
  ))
  events.push(...await pageThrough(
    getDb().collection('events')
      .where('createdAt', '>=', new Date(SINCE_MS))
      .where('createdAt', '<=', new Date(UNTIL_MS))
      .limit(PAGE),
    'v1 events',
  ))
  return events.filter((e) => e.at >= SINCE_MS && e.at <= UNTIL_MS)
}

// ─── small helpers ─────────────────────────────────────────────────────────
/** Without credentials the Firestore client can hang instead of failing — never wait on it silently. */
const READ_TIMEOUT_MS = 30000

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(
      `${label} timed out after ${Math.round(ms / 1000)}s — check credentials: set GOOGLE_APPLICATION_CREDENTIALS to a service-account JSON, or run "firebase login" first.`,
    )), ms)),
  ])
}

function pct(part, whole) {
  if (!whole) return '—'
  return `${Math.round((part / whole) * 1000) / 10}%`
}

function avg(values) {
  const real = values.filter((v) => typeof v === 'number' && Number.isFinite(v))
  if (real.length === 0) return null
  return Math.round(real.reduce((a, b) => a + b, 0) / real.length)
}

function topEntries(map, limit = TOP) {
  return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, limit)
}

function table(headers, rows) {
  const widths = headers.map((h, i) => Math.max(String(h).length, ...rows.map((r) => String(r[i] ?? '').length)))
  const line = (cells) => cells.map((c, i) => String(c ?? '').padEnd(widths[i])).join('  ').trimEnd()
  return [line(headers), line(widths.map((w) => '-'.repeat(w))), ...rows.map(line)].join('\n')
}

// ─── aggregation ───────────────────────────────────────────────────────────
function visitorOf(event) {
  return event.sessionId || event.anonymousId || event.userId || 'unknown'
}

function buildReport(events) {
  /** `--seller=<uid|slug>` narrows the whole report to one store. */
  const scoped = SELLER
    ? events.filter((e) => e.props.sellerId === SELLER || e.props.slug === SELLER)
    : events

  const uniqueVisitors = (list) => new Set(list.map(visitorOf)).size
  const byName = (name, from = scoped) => from.filter((e) => e.name === name)
  const inc = (map, key, amount = 1) => {
    if (key === undefined || key === null || key === '') return
    map[key] = (map[key] || 0) + amount
  }

  // 1) The funnel the whole app exists for — unique visitors per stage, in order.
  const stageDefs = [
    ['store seen', (e) => e.name === 'store_visited'],
    ['product seen', (e) => e.name === 'product_impression'],
    ['product opened', (e) => e.name === 'product_viewed'],
    ['bagged', (e) => e.name === 'bag_added'],
    ['checkout started', (e) => e.name === 'checkout_started'],
    ['ordered', (e) => e.name === 'order_placed'],
    ['confirmed', (e) => e.name === 'order_status_changed' && e.props.to === 'fulfilled'],
  ]
  const funnel = stageDefs.map(([label, match]) => {
    const people = new Set()
    scoped.forEach((e) => { if (match(e)) people.add(visitorOf(e)) })
    return { stage: label, visitors: people.size }
  })

  // 2) Acquisition: which channel brought them, and which one converts.
  const sourceVisitors = {}
  const sourceOrders = {}
  const counted = new Set()
  scoped.forEach((e) => {
    const src = e.source || 'unknown'
    const id = `${src}:${visitorOf(e)}`
    if (!counted.has(id)) {
      counted.add(id)
      inc(sourceVisitors, src)
    }
    if (e.name === 'order_placed') inc(sourceOrders, src)
  })

  // 3) Search: what people typed, and what found nothing (the product gaps).
  const searchBySurface = {}
  const topQueries = {}
  const zeroResultQueries = {}
  byName('search_performed').forEach((e) => {
    inc(searchBySurface, e.props.surface || 'unknown')
    const q = String(e.props.query || '').toLowerCase().trim()
    if (!q) return
    inc(topQueries, q)
    if (e.props.zeroResult === true) inc(zeroResultQueries, q)
  })

  // 4) Product performance: seen → opened → bagged → ordered → confirmed → ♥.
  const products = {}
  const productRow = (id) => {
    if (!products[id]) {
      products[id] = { productId: id, impressions: 0, views: 0, bagged: 0, ordered: 0, confirmed: 0, liked: 0, likedFromOrders: 0, sellerId: '' }
    }
    return products[id]
  }
  scoped.forEach((e) => {
    const id = e.props.productId
    if (!id) return
    const row = productRow(id)
    if (e.props.sellerId) row.sellerId = e.props.sellerId
    if (e.name === 'product_impression') row.impressions += 1
    else if (e.name === 'product_viewed') row.views += 1
    else if (e.name === 'bag_added') row.bagged += 1
    else if (e.name === 'order_placed') row.ordered += 1
    else if (e.name === 'order_status_changed' && e.props.to === 'fulfilled') row.confirmed += 1
    // ♥ Votes observed in this window. The live tally is `products.likeCount`; this column is
    // what happened *here* (net of un-likes), split by where the vote came from.
    else if (e.name === 'product_liked') {
      row.liked += 1
      if (e.props.source === 'purchase') row.likedFromOrders += 1
    }
    else if (e.name === 'product_unliked') row.liked -= 1
  })
  const productRows = Object.values(products)
  const productRanking = [...productRows]
    .sort((a, b) => (b.ordered - a.ordered) || (b.views - a.views) || (b.impressions - a.impressions))
    .slice(0, TOP)
  const seenNotSold = productRows
    .filter((p) => p.impressions >= 5 && p.ordered === 0)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, TOP)
  // Confirmed three or more times and still nobody loved it: the "did you love it? — no"
  // answers land here, which is where a seller should change the price, photo or description.
  const boughtNotLoved = productRows
    .filter((p) => p.confirmed >= 3 && p.liked <= 0)
    .sort((a, b) => b.confirmed - a.confirmed)
    .slice(0, TOP)

  // 5) Seller performance: how fast they answer, how fast they confirm, what fell over.
  const sellers = {}
  const sellerRow = (id, slug) => {
    if (!id) return null
    if (!sellers[id]) {
      sellers[id] = {
        sellerId: id, slug: slug || '', visits: 0, impressions: 0, orders: 0, confirmed: 0,
        outOfStock: 0, removed: 0, confirmMinutes: [], responseMinutes: [],
      }
    }
    if (slug) sellers[id].slug = slug
    return sellers[id]
  }
  scoped.forEach((e) => {
    const row = sellerRow(e.props.sellerId, e.props.slug)
    if (!row) return
    if (e.name === 'store_visited') row.visits += 1
    else if (e.name === 'product_impression') row.impressions += 1
    else if (e.name === 'order_placed') row.orders += 1
    else if (e.name === 'order_status_changed') {
      if (e.props.to === 'fulfilled') {
        row.confirmed += 1
        if (typeof e.props.latencyMinutes === 'number') row.confirmMinutes.push(e.props.latencyMinutes)
      } else if (e.props.to === 'out_of_stock') row.outOfStock += 1
    } else if (e.name === 'order_deleted') row.removed += 1
    else if (e.name === 'seller_first_response' && typeof e.props.latencyMinutes === 'number') {
      row.responseMinutes.push(e.props.latencyMinutes)
    }
  })
  const sellerRanking = Object.values(sellers).map((s) => ({
    ...s,
    avgConfirmMinutes: avg(s.confirmMinutes),
    avgResponseMinutes: avg(s.responseMinutes),
    answered: s.responseMinutes.length,
    outOfStockRate: s.orders + s.outOfStock > 0 ? pct(s.outOfStock, s.orders + s.outOfStock) : '—',
    dealRate: s.visits > 0 ? pct(s.orders, s.visits) : '—',
  })).sort((a, b) => b.orders - a.orders).slice(0, TOP)

  // 6) Nearby, judged on its own so it never hides inside Browse.
  const nearbyViews = byName('nearby_viewed')
  const nearbySorts = {}
  const nearbyRanges = {}
  const nearbyResultCounts = []
  let nearbyAreaUses = 0
  let nearbyOrders = 0
  let nearbyResorts = 0
  scoped.forEach((e) => {
    if (e.name === 'nearby_area_set') nearbyAreaUses += 1
    if (e.name === 'nearby_viewed' && e.props.areaSet === true) nearbyAreaUses += 1
    if (e.name === 'nearby_sort_changed') {
      nearbyResorts += 1
      inc(nearbySorts, e.props.sortMode)
    }
    if (e.name === 'nearby_range_changed') inc(nearbyRanges, `${e.props.rangeKm}km`)
    if (e.name === 'nearby_results' && typeof e.props.count === 'number') nearbyResultCounts.push(e.props.count)
    if (e.name === 'order_placed' && e.props.surface === 'nearby') nearbyOrders += 1
  })

  // 7) The sign-in wall — the biggest single drop-off in the app.
  const wallShown = byName('signin_wall_shown')
  const wallPassed = byName('signin_wall_passed')
  const wallByAction = {}
  const wallPassedByAction = {}
  wallShown.forEach((e) => inc(wallByAction, e.props.action))
  wallPassed.forEach((e) => inc(wallPassedByAction, e.props.action))

  // 8) Daily shape.
  const perDay = {}
  scoped.forEach((e) => {
    const day = dayKey(e.at)
    if (!perDay[day]) perDay[day] = { day, events: 0, visitors: new Set(), orders: 0, confirmed: 0 }
    perDay[day].events += 1
    perDay[day].visitors.add(visitorOf(e))
    if (e.name === 'order_placed') perDay[day].orders += 1
    if (e.name === 'order_status_changed' && e.props.to === 'fulfilled') perDay[day].confirmed += 1
  })

  // 9) Health of the data itself — check this before trusting any number above.
  const eventNames = {}
  const appVersions = {}
  let v1 = 0
  let withoutIdentity = 0
  scoped.forEach((e) => {
    inc(eventNames, e.name)
    if (e.appVersion) inc(appVersions, e.appVersion)
    if (e.schema === 1) v1 += 1
    if (!e.sessionId && !e.anonymousId) withoutIdentity += 1
  })

  return {
    window: {
      since: new Date(SINCE_MS).toISOString().slice(0, 10),
      until: new Date(UNTIL_MS).toISOString().slice(0, 10),
      seller: SELLER || null,
    },
    totals: {
      events: scoped.length,
      visitors: uniqueVisitors(scoped),
      legacyV1Events: v1,
      eventsWithoutIdentity: withoutIdentity,
    },
    funnel,
    acquisition: Object.keys(sourceVisitors).map((src) => ({
      source: src,
      visitors: sourceVisitors[src],
      orders: sourceOrders[src] || 0,
      conversion: pct(sourceOrders[src] || 0, sourceVisitors[src]),
    })).sort((a, b) => b.visitors - a.visitors),
    search: {
      bySurface: searchBySurface,
      top: topEntries(topQueries).map(([query, count]) => ({ query, count })),
      zeroResults: topEntries(zeroResultQueries).map(([query, count]) => ({ query, count })),
    },
    products: { tracked: productRows.length, ranking: productRanking, seenNotSold, boughtNotLoved },
    sellers: sellerRanking,
    nearby: {
      sessions: uniqueVisitors(nearbyViews),
      views: nearbyViews.length,
      avgResults: avg(nearbyResultCounts),
      areaUses: nearbyAreaUses,
      resorts: nearbyResorts,
      sorts: nearbySorts,
      ranges: nearbyRanges,
      orders: nearbyOrders,
    },
    signInWall: {
      shown: wallShown.length,
      passed: wallPassed.length,
      conversion: pct(wallPassed.length, wallShown.length),
      byAction: Object.keys(wallByAction).map((action) => ({
        action,
        shown: wallByAction[action],
        passed: wallPassedByAction[action] || 0,
      })),
    },
    daily: Object.values(perDay)
      .map((d) => ({ day: d.day, events: d.events, visitors: d.visitors.size, orders: d.orders, confirmed: d.confirmed }))
      .sort((a, b) => a.day.localeCompare(b.day)),
    health: { eventNames: topEntries(eventNames, 30).map(([name, count]) => ({ name, count })), appVersions },
  }
}

// ─── rendering ─────────────────────────────────────────────────────────────
function render(report) {
  const out = []
  const add = (line = '') => out.push(line)
  const win = report.window
  const t = report.totals

  add(`rachett journey report — ${win.since} → ${win.until}${win.seller ? `  (seller: ${win.seller})` : ''}`)
  add(`events: ${t.events.toLocaleString()}   visitors: ${t.visitors.toLocaleString()}   legacy v1 events: ${t.legacyV1Events.toLocaleString()}   without identity: ${t.eventsWithoutIdentity.toLocaleString()}`)
  add()

  add('FUNNEL (unique visitors per stage)')
  const start = report.funnel[0]?.visitors || 0
  add(table(['stage', 'visitors', 'of first', 'of previous'], report.funnel.map((stage, i) => [
    stage.stage,
    stage.visitors,
    pct(stage.visitors, start),
    i === 0 ? '—' : pct(stage.visitors, report.funnel[i - 1].visitors),
  ])))
  add()

  add('ACQUISITION (first-touch channel)')
  add(table(['source', 'visitors', 'orders', 'conversion'], report.acquisition.map((a) => [a.source, a.visitors, a.orders, a.conversion])))
  add()

  add('SEARCH')
  add(table(['surface', 'searches'], Object.entries(report.search.bySurface).map(([s, c]) => [s, c])))
  if (report.search.top.length > 0) {
    add()
    add('  what people looked for')
    add(table(['query', 'times'], report.search.top.map((q) => [q.query, q.count])))
  }
  if (report.search.zeroResults.length > 0) {
    add()
    add('  found nothing — demand we do not stock yet')
    add(table(['query', 'times'], report.search.zeroResults.map((q) => [q.query, q.count])))
  }
  add()

  add(`PRODUCTS (${report.products.tracked} tracked — seen → opened → bagged → ordered → confirmed, ♥ likes cast in this window)`)
  add(table(['productId', 'sellerId', 'seen', 'opened', 'bagged', 'ordered', 'confirmed', '♥', '♥ from orders'], report.products.ranking.map((p) => [
    p.productId, p.sellerId || '—', p.impressions, p.views, p.bagged, p.ordered, p.confirmed, p.liked, p.likedFromOrders,
  ])))
  if (report.products.seenNotSold.length > 0) {
    add()
    add('  seen a lot, never ordered (fix the price, photo or description)')
    add(table(['productId', 'sellerId', 'seen', 'opened', 'bagged'], report.products.seenNotSold.map((p) => [
      p.productId, p.sellerId || '—', p.impressions, p.views, p.bagged,
    ])))
  }
  if (report.products.boughtNotLoved.length > 0) {
    add()
    add('  delivered three or more times and never loved — the "did you love it? — no" list')
    add(table(['productId', 'sellerId', 'confirmed', '♥'], report.products.boughtNotLoved.map((p) => [
      p.productId, p.sellerId || '—', p.confirmed, p.liked,
    ])))
  }
  add()

  add('SELLER PERFORMANCE (response time and confirmation latency, in minutes)')
  add(table(
    ['sellerId', 'slug', 'visits', 'orders', 'confirmed', 'avg confirm', 'first reply', 'o/s rate', 'orders/visit'],
    report.sellers.map((s) => [
      s.sellerId, s.slug || '—', s.visits, s.orders, s.confirmed,
      s.avgConfirmMinutes === null ? '—' : s.avgConfirmMinutes,
      s.avgResponseMinutes === null ? '—' : s.avgResponseMinutes,
      s.outOfStockRate, s.dealRate,
    ]),
  ))
  add()

  add('NEARBY (tracked as its own surface)')
  add(`  sessions: ${report.nearby.sessions}   result renders: ${report.nearby.views}   avg results shown: ${report.nearby.avgResults ?? '—'}   orders placed from Nearby: ${report.nearby.orders}`)
  add(`  area set or cleared: ${report.nearby.areaUses}   sort chips used: ${report.nearby.resorts}`)
  add(table(['sort mode', 'used'], Object.entries(report.nearby.sorts)))
  add(table(['range', 'chosen'], Object.entries(report.nearby.ranges)))
  add()

  add('SIGN-IN WALL')
  add(`  shown: ${report.signInWall.shown}   resumed after sign-in: ${report.signInWall.passed}   conversion: ${report.signInWall.conversion}`)
  add(table(['action', 'shown', 'passed'], report.signInWall.byAction.map((a) => [a.action, a.shown, a.passed])))
  add()

  add('DAILY')
  add(table(['day', 'events', 'visitors', 'orders', 'confirmed'], report.daily.map((d) => [d.day, d.events, d.visitors, d.orders, d.confirmed])))
  add()

  add('DATA HEALTH (check before trusting anything above)')
  add(table(['event', 'count'], report.health.eventNames.map((e) => [e.name, e.count])))
  add(table(['app version', 'events'], Object.entries(report.health.appVersions)))

  return out.join('\n')
}

// ─── run ───────────────────────────────────────────────────────────────────
async function main() {
  const since = new Date(SINCE_MS).toISOString().slice(0, 10)
  const until = new Date(UNTIL_MS).toISOString().slice(0, 10)
  console.log(`Reading events ${since} → ${until} ...`)

  const events = await loadEvents()
  if (events.length === 0) {
    console.log('No events in this window — nothing to report yet.')
    return
  }

  const report = buildReport(events)
  const text = AS_JSON ? JSON.stringify(report, null, 2) : render(report)
  if (OUT) {
    require('fs').writeFileSync(require('path').resolve(OUT), text)
    console.log(`Wrote ${require('path').resolve(OUT)}`)
  } else {
    console.log(text)
  }
}

// Requiring this file (tests, fixtures) must not hit Firestore — only running it does.
if (require.main === module) {
  main().catch((err) => {
    console.error('Report failed:', err && err.message ? err.message : err)
    process.exit(1)
  })
}

module.exports = { buildReport, render, flatten, table, pct, avg, dayKey, millis, visitorOf }

