/**
 * Fill in `sellers/{uid}` → `ratingAvg` / `ratingCount` for shops that already have comments.
 *
 * The live trigger (`recomputeSellerRating` in `functions/index.js`) only fires when a comment is
 * *written, edited or deleted*. Every comment that already exists — including all of them, since the
 * rating shipped after the comments did — would otherwise leave its shop with no rating at all, and
 * a shop's card would stay blank until its next customer commented. This walks every seller, adds
 * up the same comments with the same pure functions (`sellerStats.ratingFromReviews`), and writes
 * the two fields the cards read.
 *
 *   cd functions
 *   npm install
 *   node backfill-seller-ratings.js                  # dry run (default) — prints, writes nothing
 *   node backfill-seller-ratings.js --write
 *   node backfill-seller-ratings.js --uid=<sellerUid> --write
 *   node backfill-seller-ratings.js --write --write-score   # also stamp `score` on old comments
 *
 * `--write-score` writes the star onto comments that were written before stars existed (a `love`
 * becomes `score: 5`). It changes **no number** — `sellerStats.reviewScore` already reads those
 * comments as 5 · 3 · 1 — it only makes each document say what it is worth on its own, without a
 * table in the middle.
 *
 * A shop with no comments gets `ratingAvg: null, ratingCount: 0` — an honest "nobody has rated this
 * yet", which every surface renders as nothing at all rather than as a flattering 0.0.
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
const WRITE_SCORE = args.includes('--write-score')
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

/**
 * A shop's rating, read the way the trigger reads it: walk the shop's own products, then each
 * product's comments. No `collectionGroup('reviews')` — that would need an index and a `sellerId`
 * on every comment, and the products path is already there.
 */
async function ratingFor(db, sellerId) {
  const products = await db.collection('sellers').doc(sellerId).collection('products').get()
  const reviews = []
  for (const product of products.docs) {
    const snap = await product.ref.collection('reviews').get()
    snap.docs.forEach((review) => reviews.push(review.data()))
  }
  return { products: products.size, ...sellerStats.ratingFromReviews(reviews) }
}

/**
 * Stamp the star onto comments written before stars existed.
 *
 * Only ever *adds* the field the readers already infer: a comment with `reaction: 'love'` is worth
 * 5 everywhere already (`sellerStats.reviewScore`), so this moves no number on rachett. What it
 * changes is how self-describing the collection is — after it, a dump of the comments carries each
 * rating directly instead of a code that needs a table to be read.
 */
async function stampScores(db, sellerId) {
  let stamped = 0
  const products = await db.collection('sellers').doc(sellerId).collection('products').get()
  for (const product of products.docs) {
    const reviews = await product.ref.collection('reviews').get()
    for (const review of reviews.docs) {
      const data = review.data()
      if (sellerStats.isStar(data.score)) continue
      const score = sellerStats.reviewScore(data)
      // Nothing readable: leave it exactly as it is. A guessed 3 would invent a rating nobody gave.
      if (score === null) continue
      await review.ref.set({ score }, { merge: true })
      stamped += 1
    }
  }
  return stamped
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
  let stamped = 0
  for (const uid of uids) {
    const rating = await ratingFor(db, uid)
    console.log(
      `${WRITE ? 'write' : 'plan '}  ${uid}  `
      + `★ ${rating.avg === null ? '—' : rating.avg.toFixed(1)} from ${rating.count} comment(s) `
      + `across ${rating.products} product(s)`,
    )

    if (WRITE) {
      await db.collection('sellers').doc(uid).set({
        ratingAvg: rating.avg,
        ratingCount: rating.count,
        ratingUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true })
      written += 1
      if (WRITE_SCORE) {
        const count = await stampScores(db, uid)
        if (count > 0) console.log(`        stamped score on ${count} comment(s) written before stars`)
        stamped += count
      }
    }
  }

  console.log(`\n${uids.length} seller(s) scanned, ${written} written.`)
  if (WRITE_SCORE) console.log(`${stamped} comment(s) given an explicit score.`)
  if (!WRITE) console.log('Dry run — nothing was written. Add --write to apply.')
}

// Requiring this file (tests) must not touch Firestore — only running it does.
if (require.main === module) {
  main().catch((err) => {
    console.error('Backfill failed:', err && err.message ? err.message : err)
    process.exit(1)
  })
}

module.exports = { ratingFor, stampScores }
