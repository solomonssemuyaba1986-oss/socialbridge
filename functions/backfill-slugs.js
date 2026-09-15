/**
 * Find stores with a missing (or duplicated) shop link — the cause of "/store/undefined"
 * links that made buyers hit a dead end.
 *
 *   cd functions
 *   node backfill-slugs.js                  # dry run — prints what it would do
 *   node backfill-slugs.js --write          # fill in missing slugs
 *   node backfill-slugs.js --fix-duplicates --write   # also rename the later duplicate
 *
 * Credentials: point GOOGLE_APPLICATION_CREDENTIALS at a service-account JSON, or
 * run `firebase login` first so application default credentials are used.
 *
 * Careful: a slug is a public link. We only ever CREATE a missing one. Re-naming an
 * existing link breaks every link a seller has already shared, so duplicates are
 * reported by default and only changed with --fix-duplicates.
 */
const admin = require('firebase-admin')

const PROJECT_ID = process.env.GCLOUD_PROJECT || 'socialbridge-93ee1'
const WRITE = process.argv.includes('--write')
const FIX_DUPLICATES = process.argv.includes('--fix-duplicates')

admin.initializeApp({ projectId: PROJECT_ID })
const db = admin.firestore()

/** "Aisha's Fabrics & More" → "aishas-fabrics-more" (the same shape SetupStore produces). */
function slugify(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
    .replace(/-+$/g, '')
}

async function main() {
  const snap = await db.collection('sellers').get()
  console.log(`${snap.size} stores found. ${WRITE ? 'WRITING changes.' : 'DRY RUN — nothing will be written.'}`)

  const bySlug = new Map()
  const missing = []
  for (const docSnap of snap.docs) {
    const data = docSnap.data() || {}
    const slug = String(data.slug || '').trim()
    if (!slug) {
      missing.push({ ref: docSnap.ref, name: data.businessName || docSnap.id, id: docSnap.id })
      continue
    }
    const key = slug.toLowerCase()
    bySlug.set(key, [...(bySlug.get(key) || []), { ref: docSnap.ref, name: data.businessName || docSnap.id, slug }])
  }

  const duplicates = Array.from(bySlug.values()).filter(list => list.length > 1)

  console.log(`\n— missing shop link: ${missing.length} —`)
  for (const item of missing) {
    console.log(`· ${item.name} (${item.id}) → would become "${slugify(item.name) || item.id}"`)
  }

  console.log(`\n— duplicate shop links: ${duplicates.length} group(s) —`)
  for (const list of duplicates) {
    console.log(`· "${list[0].slug}" is used by: ${list.map(x => `${x.name} (${x.ref.id})`).join(', ')}`)
  }

  if (!WRITE) {
    console.log('\nRe-run with --write to fill in the missing links.')
    return
  }

  // Fill missing slugs, keeping every generated link unique across the whole project.
  const taken = new Set(bySlug.keys())
  let filled = 0
  for (const item of missing) {
    const base = slugify(item.name) || item.id.toLowerCase()
    let candidate = base
    let n = 2
    while (taken.has(candidate)) candidate = `${base}-${n++}`.slice(0, 34)
    taken.add(candidate)
    await item.ref.update({ slug: candidate })
    console.log(`✓ ${item.name} → ${candidate}`)
    filled++
  }

  if (FIX_DUPLICATES) {
    let renamed = 0
    for (const list of duplicates) {
      // Keep the first (oldest link wins), rename the rest.
      for (const item of list.slice(1)) {
        const base = slugify(item.name) || item.ref.id.toLowerCase()
        let candidate = base
        let n = 2
        while (taken.has(candidate)) candidate = `${base}-${n++}`.slice(0, 34)
        taken.add(candidate)
        await item.ref.update({ slug: candidate })
        console.log(`✓ duplicate ${item.name} (${item.slug}) → ${candidate}`)
        renamed++
      }
    }
    console.log(`\n${renamed} duplicate link(s) renamed. Their old links stop working — tell those sellers to copy the new one.`)
  } else if (duplicates.length > 0) {
    console.log('\nDuplicates left alone. Re-run with --fix-duplicates --write if you want them renamed.')
  }

  console.log(`\nDone. ${filled} link(s) added.`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
