/**
 * Give older stores a real creation date.
 *
 * `createdAt` has always been written by SetupStore, but stores created before that
 * (or by an early build) can be missing it — which makes a storefront look
 * dateless and hides the "Selling since …" trust line.
 *
 * This script only uses **real evidence**, in this order:
 *   1. the store's earliest product (`sellers/{uid}/products`)
 *   2. its earliest order   (`sellers/{uid}/orders`)
 *   3. its earliest visit   (`sellers/{uid}/visits`)
 * and records where the date came from in `createdAtSource`, so nobody mistakes a
 * derived date for a recorded one. If there is no evidence at all, **nothing is
 * written** — a made-up date would be worse than a missing one.
 *
 *   cd functions
 *   npm install                          # once — firebase-admin
 *   node backfill-store-dates.js                 # dry run (default)
 *   node backfill-store-dates.js --write
 *   node backfill-store-dates.js --uid=<sellerUid> --write
 */
const admin = require('firebase-admin')

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

/** Earliest document in a subcollection by createdAt, or null. */
async function earliestIn(collectionRef) {
  try {
    const snap = await collectionRef.orderBy('createdAt', 'asc').limit(1).get()
    if (snap.empty) return null
    const data = snap.docs[0].data()
    const ms = millis(data.createdAt)
    return ms > 0 ? new Date(ms) : null
  } catch (err) {
    // Missing index or a denied read — treat as "no evidence" rather than guessing.
    return null
  }
}

async function findEvidence(uid) {
  const db = getDb()
  const products = await earliestIn(db.collection('sellers').doc(uid).collection('products'))
  if (products) return { date: products, source: 'first-product' }

  const orders = await earliestIn(db.collection('sellers').doc(uid).collection('orders'))
  if (orders) return { date: orders, source: 'first-order' }

  const visits = await earliestIn(db.collection('sellers').doc(uid).collection('visits'))
  if (visits) return { date: visits, source: 'first-visit' }

  return null
}

async function run() {
  const db = getDb()
  const sellers = ONLY_UID
    ? [await db.collection('sellers').doc(ONLY_UID).get()].filter(s => s.exists)
    : (await db.collection('sellers').limit(PAGE).get()).docs

  console.log(`${WRITE ? 'WRITING' : 'DRY RUN'} — ${sellers.length} store(s) checked\n`)

  let haveDate = 0
  let fixed = 0
  let unknown = 0

  for (const snap of sellers) {
    const data = snap.data() || {}
    const name = data.businessName || snap.id

    if (millis(data.createdAt) > 0) {
      haveDate++
      continue
    }

    const evidence = await findEvidence(snap.id)
    if (!evidence) {
      unknown++
      console.log(`  ✗ ${name} (${snap.id}) — no evidence of when it started; left alone`)
      continue
    }

    const iso = evidence.date.toISOString().slice(0, 10)
    console.log(`  ${WRITE ? '→' : '·'} ${name} (${snap.id}) — ${iso} from ${evidence.source}`)
    if (WRITE) {
      try {
        await db.collection('sellers').doc(snap.id).set(
          { createdAt: admin.firestore.Timestamp.fromDate(evidence.date), createdAtSource: evidence.source },
          { merge: true },
        )
        fixed++
      } catch (err) {
        console.log(`      failed: ${err && err.message ? err.message : err}`)
      }
    } else {
      fixed++
    }
  }

  console.log(`\nalready dated: ${haveDate}   ${WRITE ? 'dated now' : 'would date'}: ${fixed}   no evidence: ${unknown}`)
  if (!WRITE && fixed > 0) console.log('Re-run with --write to apply.')
}

if (require.main === module) {
  run().catch((err) => {
    console.error('Backfill failed:', err && err.message ? err.message : err)
    process.exit(1)
  })
}

module.exports = { millis, earliestIn, findEvidence, flag }
