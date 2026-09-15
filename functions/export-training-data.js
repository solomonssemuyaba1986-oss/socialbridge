/**
 * Export rachett data as JSONL for machine learning / AI training.
 *
 *   cd functions
 *   npm install                                       # once — installs firebase-admin
 *   node export-training-data.js --out=../training-data
 *   node export-training-data.js --only=events --since=2026-01-01 --pii=hash
 *   node export-training-data.js --dry-run
 *
 * Credentials: point GOOGLE_APPLICATION_CREDENTIALS at a service-account JSON,
 * or run `firebase login` first so application default credentials are used.
 *
 * PRIVACY — read DATA_COLLECTION.md §10 first:
 *   · National ID paths are always stripped, and the image files are never exported.
 *   · Phone numbers, emails and names are DROPPED by default (--pii=drop).
 *   · Exports are git-ignored. Keep them off shared drives, and delete them when done.
 *   · For a stronger hash, set EXPORT_SALT (otherwise a shared default salt is used,
 *     which still keeps raw numbers out of the file but is not a real secret).
 */
const admin = require('firebase-admin')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const PROJECT_ID = process.env.GCLOUD_PROJECT || 'socialbridge-93ee1'
const SCRUB_SALT = process.env.EXPORT_SALT || 'rachett-export'
const PAGE = 500
const DEFAULT_TARGETS = ['events', 'orders', 'products', 'messages', 'conversations']

// ─── flags ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)

function flag(name, fallback = '') {
  const hit = args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return fallback
  const value = hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : 'true'
  return value
}

const DRY_RUN = args.includes('--dry-run')
const OUT_DIR = path.resolve(flag('out', 'training-data'))
const ONLY = flag('only', DEFAULT_TARGETS.join(','))
const SINCE = flag('since', '')
const LIMIT = Math.max(0, Number(flag('limit', '0')) || 0)
const PII = flag('pii', 'drop')

if (!['drop', 'hash', 'keep'].includes(PII)) {
  console.error(`--pii must be drop, hash or keep (got "${PII}")`)
  process.exit(1)
}

const SINCE_MS = SINCE ? Date.parse(SINCE) : 0
if (SINCE && Number.isNaN(SINCE_MS)) {
  console.error(`--since must look like 2026-01-31 (got "${SINCE}")`)
  process.exit(1)
}

admin.initializeApp({ projectId: PROJECT_ID })
const db = admin.firestore()

// ─── what to export ────────────────────────────────────────────────────────
/** Never leaves the database, whatever the flags say. */
const NEVER_EXPORT = ['idDocumentPath', 'idStatus']

/** PII columns per target — dropped, hashed or kept according to --pii. */
const PII_FIELDS = {
  events: [],
  orders: ['buyerName', 'buyerPhone'],
  products: [],
  messages: ['senderName', 'senderPhone'],
  conversations: ['sellerName', 'buyerName'],
  sellers: ['whatsapp', 'email', 'recoveryEmail'],
  feedback: ['name', 'contact', 'userEmail'],
}

const TARGETS = {
  events: { label: 'behavioural event lake', ref: () => db.collection('events') },
  orders: { label: 'orders (all stores)', ref: () => db.collectionGroup('orders') },
  products: { label: 'products (all stores)', ref: () => db.collectionGroup('products') },
  messages: { label: 'chat messages (both systems)', ref: () => db.collectionGroup('messages') },
  conversations: { label: 'conversation headers', ref: () => db.collection('conversations') },
  sellers: { label: 'store profiles', ref: () => db.collection('sellers') },
  feedback: { label: 'user feedback', ref: () => db.collection('feedback') },
}

// ─── helpers ───────────────────────────────────────────────────────────────

/** Firestore Timestamp / Date / GeoPoint → plain JSON-friendly values. */
function normalise(value) {
  if (value === null || value === undefined) return value
  if (value instanceof admin.firestore.Timestamp) return value.toDate().toISOString()
  if (value instanceof admin.firestore.GeoPoint) return { lat: value.latitude, lng: value.longitude }
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(normalise)
  if (typeof value === 'object') {
    const out = {}
    for (const [key, inner] of Object.entries(value)) out[key] = normalise(inner)
    return out
  }
  return value
}

/** Deterministic so the same phone number groups together across rows. */
function hashValue(value) {
  const text = String(value ?? '').trim().toLowerCase()
  if (!text) return ''
  return crypto.createHash('sha256').update(`${SCRUB_SALT}${text}`).digest('hex').slice(0, 32)
}

function toRow(docSnap) {
  const raw = { ...(docSnap.data() || {}) }

  for (const field of NEVER_EXPORT) delete raw[field]

  const piiFields = PII_FIELDS[pathTarget(docSnap.ref.path)] || []
  for (const field of piiFields) {
    if (!(field in raw)) continue
    if (PII === 'keep') continue
    if (PII === 'hash') raw[field] = hashValue(raw[field])
    else delete raw[field]
  }

  return { _id: docSnap.id, _path: docSnap.ref.path, ...normalise(raw) }
}

/** Which PII list applies, based on the document path. */
function pathTarget(docPath) {
  const parts = docPath.split('/')
  if (parts[0] === 'sellers' && parts.length === 2) return 'sellers'
  if (parts[0] === 'events') return 'events'
  if (parts[0] === 'feedback') return 'feedback'
  if (parts[0] === 'conversations' && parts.length === 2) return 'conversations'
  if (parts[0] === 'conversations') return 'messages'
  if (parts.includes('orders')) return 'orders'
  if (parts.includes('products')) return 'products'
  if (parts.includes('messages')) return 'messages'
  return ''
}

/** Milliseconds for --since, or null when the document has no usable timestamp. */
function createdMs(data) {
  const value = data.createdAt
  if (!value) return null
  if (typeof value.toDate === 'function') return value.toDate().getTime()
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? null : parsed
  }
  if (typeof value === 'number') return value
  return null
}

// ─── export ────────────────────────────────────────────────────────────────

async function exportTarget(name) {
  const target = TARGETS[name]
  const file = DRY_RUN ? null : path.join(OUT_DIR, `${name}.jsonl`)
  const stream = file ? fs.createWriteStream(file, { flags: 'w' }) : null

  let cursor = null
  let rows = 0
  let skipped = 0
  let bytes = 0

  while (true) {
    let page = target.ref().limit(PAGE)
    if (cursor) page = page.startAfter(cursor)

    const snap = await page.get()
    if (snap.empty) break

    const lines = []
    for (const docSnap of snap.docs) {
      cursor = docSnap
      if (SINCE_MS) {
        const ms = createdMs(docSnap.data() || {})
        if (ms === null || ms < SINCE_MS) {
          skipped++
          continue
        }
      }
      const line = `${JSON.stringify(toRow(docSnap))}\n`
      lines.push(line)
      bytes += Buffer.byteLength(line)
      rows++
      if (LIMIT && rows >= LIMIT) break
    }

    if (stream && lines.length) stream.write(lines.join(''))
    if (snap.size < PAGE) break
    if (LIMIT && rows >= LIMIT) break
  }

  if (stream) await new Promise((resolve) => stream.end(resolve))
  return { rows, skipped, bytes, file }
}

async function main() {
  const wanted = ONLY.split(',').map((s) => s.trim()).filter(Boolean)
  const unknown = wanted.filter((name) => !TARGETS[name])
  if (unknown.length) {
    console.error(`Unknown target(s): ${unknown.join(', ')}`)
    console.error(`Available: ${Object.keys(TARGETS).join(', ')}`)
    process.exit(1)
  }

  console.log(`Project : ${PROJECT_ID}`)
  console.log(`Targets : ${wanted.join(', ')}`)
  console.log(`PII     : ${PII}${PII === 'drop' ? ' (phones, emails and names removed)' : ''}`)
  console.log(`Since   : ${SINCE || 'all time'}${LIMIT ? ` | limit ${LIMIT} per target` : ''}`)
  if (DRY_RUN) console.log('DRY RUN — counting only, nothing will be written.')
  else console.log(`Output  : ${OUT_DIR}`)
  console.log('')

  const summary = []
  for (const name of wanted) {
    process.stdout.write(`· ${name} … `)
    const result = await exportTarget(name)
    summary.push({ name, ...result })
    const size = result.file ? ` → ${path.relative(process.cwd(), result.file)} (${(result.bytes / 1024).toFixed(0)} KB)` : ''
    console.log(
      `${result.rows} rows${result.skipped ? ` (${result.skipped} skipped by --since)` : ''}${size}`,
    )
  }

  const total = summary.reduce((sum, item) => sum + item.rows, 0)
  console.log(`\nDone. ${total} rows across ${summary.length} target(s).`)
  if (DRY_RUN) console.log('')
  else console.log('Delete the output directory when you are finished — it is git-ignored and holds user data.')
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err)
      process.exit(1)
    })
}

// Exported so the transform rules (PII stripping, normalising) can be checked in isolation.
module.exports = { normalise, hashValue, pathTarget, createdMs, toRow, PII_FIELDS, NEVER_EXPORT }

