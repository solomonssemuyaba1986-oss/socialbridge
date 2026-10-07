/**
 * Fill in `sellers/{uid}/stats/main` for shops that already have history.
 *
 * The live Cloud Functions (`recomputeSellerCompletion`, `recordSellerFirstResponse`) only write
 * when something *new* happens — an order, a reply. A shop whose last order was months ago would
 * keep whatever it last had, and a shop that predates the maths would have nothing at all. This
 * walks every seller and computes the same two numbers from the same source data, using the same
 * pure functions (`sellerStats.js`), so the 💎 badge is right the moment it ships.
 *
 *   cd functions
 *   npm install
 *   node backfill-seller-stats.js                 # dry run (default) — prints, writes nothing
 *   node backfill-seller-stats.js --write
 *   node backfill-seller-stats.js --uid=<sellerUid> --write
 */
const admin = require('firebase-admin')
const sellerStats = require('./sellerStats')

const PROJECT_ID = process.env.GCLOUD_PROJECT || 'socialbridge-93ee1'
const args = process.argv.slice(2)

function flag(name, fallback = '') {
  const hit = args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return fallback
  return hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : 'true'
}

const WRITE = args.includes('--write')
const ONLY_UID = flag('uid', '')
const PAGE = 300

let _db = null
function getDb() {
  if (!_db) {
    admin.initializeApp({ projectId: PROJECT_ID })
    _db = admin.firestore()
  }
  return _db
}

function millis(value) {
  if (!value) return 0
  if (typeof value === 'number') return value
  if (typeof value.toMillis === 'function') return value.toMillis()
  if (typeof value.toDate === 'function') return value.toDate().getTime()
  if (value instanceof Date) return value.getTime()
  return 0
}

/** Completed / total / rate, from a shop's orders — every order is the denominator. */
async function completionFor(db, sellerId) {
  const snap = await db.collection('sellers').doc(sellerId).collection('orders').get()
  const orders = snap.docs.map((d) => d.data())
  const total = orders.length
  const completed = sellerStats.countCompleted(orders)
  return { completed, total, rate: sellerStats.orderCompletionRate(completed, total) }
}

/**
 * Fold every thread's first reply into one running average. Each thread is read oldest-first so
 * the result is identical to what the live trigger would have built up one reply at a time.
 */
async function responseFor(db, sellerId) {
  const convos = await db.collection('conversations').where('sellerId', '==', sellerId).get()
  let responsesMeasured = 0
  let responseTotalMinutes = 0
  for (const doc of convos.docs) {
    const convo = doc.data()
    if (!convo.buyerId) continue
    const msgs = await doc.ref.collection('messages').orderBy('createdAt', 'asc').get()
    const messages = msgs.docs.map((m) => {
      const d = m.data()
      return { senderId: d.senderId, atMillis: millis(d.createdAt) }
    })
    const minutes = sellerStats.firstResponseMinutes(messages, sellerId, convo.buyerId)
    if (minutes === null) continue
    responsesMeasured += 1
    responseTotalMinutes += minutes
  }
  return {
    responsesMeasured,
    responseTotalMinutes,
    avgResponseMinutes: responsesMeasured > 0
      ? Math.round(responseTotalMinutes / responsesMeasured)
      : null,
  }
}

async function main() {
  const db = getDb()
  console.log(
    `Scanning sellers${ONLY_UID ? ` (uid=${ONLY_UID})` : ''} — ${WRITE ? 'WRITE' : 'dry run'} ...`,
  )

  const uids = []
  if (ONLY_UID) {
    uids.push(ONLY_UID)
  } else {
    let cursor = null
    for (;;) {
      let q = db.collection('sellers').orderBy(admin.firestore.FieldPath.documentId()).limit(PAGE)
      if (cursor) q = q.startAfter(cursor)
      const snap = await q.get()
      if (snap.empty) break
      snap.docs.forEach((d) => uids.push(d.id))
      cursor = snap.docs[snap.docs.length - 1].id
      if (snap.size < PAGE) break
    }
  }

  let written = 0
  for (const uid of uids) {
    const completion = await completionFor(db, uid)
    const response = await responseFor(db, uid)
    // The two numbers are all the server reports; whether 🟢 holds is the app's question. This
    // flag is only a hint that the *measured* half passes.
    const numbersPass = sellerStats.meetsReliableCriteria({
      realSeller: true,
      orderCompletionRate: completion.rate,
      totalOrders: completion.total,
      avgResponseMinutes: response.avgResponseMinutes,
    })
    console.log(
      `${WRITE ? 'write' : 'plan '}  ${uid}  `
      + `${completion.completed}/${completion.total} (${completion.rate ?? '—'}%) · `
      + `avg reply ${response.avgResponseMinutes ?? '—'} min over ${response.responsesMeasured}`
      + `${numbersPass ? '  → numbers pass' : ''}`,
    )

    if (WRITE) {
      await db.collection('sellers').doc(uid).collection('stats').doc('main').set({
        completedOrders: completion.completed,
        totalOrders: completion.total,
        orderCompletionRate: completion.rate,
        responsesMeasured: response.responsesMeasured,
        responseTotalMinutes: response.responseTotalMinutes,
        avgResponseMinutes: response.avgResponseMinutes,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true })
      written += 1
    }
  }

  console.log(`\n${uids.length} seller(s) scanned, ${written} written.`)
  if (!WRITE) console.log('Dry run — nothing was written. Add --write to apply.')
}

// Requiring this file (tests) must not touch Firestore — only running it does.
if (require.main === module) {
  main().catch((err) => {
    console.error('Backfill failed:', err && err.message ? err.message : err)
    process.exit(1)
  })
}

module.exports = { completionFor, responseFor }
