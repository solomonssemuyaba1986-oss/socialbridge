/**
 * What people told us they **didn't like** — the feedback loop, read back.
 *
 *   cd functions
 *   node feedback-report.js                    # the last 30 days
 *   node feedback-report.js --since=2026-09-01
 *   node feedback-report.js --json > dislikes.json
 *
 * `feedback/` is deliberately client-unreadable (`firestore.rules`), so this script is the
 * only way to read it. It prints what was said and *where they were standing* when they said
 * it — never names or emails unless you explicitly ask with `--with-contact`.
 *
 * Credentials: point GOOGLE_APPLICATION_CREDENTIALS at a service-account JSON, or run
 * `firebase login` first so application default credentials are used.
 */
const admin = require('firebase-admin')

const PROJECT_ID = process.env.GCLOUD_PROJECT || 'socialbridge-93ee1'

const args = process.argv.slice(2)
function flag(name, fallback = '') {
  const hit = args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return fallback
  return hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : 'true'
}

const SINCE = flag('since', '')
const UNTIL = flag('until', '')
const AS_JSON = flag('json', '') !== ''
const WITH_CONTACT = flag('with-contact', '') !== ''
const LIMIT = Number(flag('limit', '1000')) || 1000

admin.initializeApp({ projectId: PROJECT_ID })
const db = admin.firestore()

function withinWindow(row) {
  const at = String(row.submittedAt || '')
  if (!at) return true
  if (SINCE && at < SINCE) return false
  if (UNTIL && at > UNTIL) return false
  return true
}

function tally(rows, pick) {
  const counts = new Map()
  for (const row of rows) {
    const key = pick(row) || '—'
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])
}

function line(text) {
  console.log(text)
}

async function main() {
  const snap = await db.collection('feedback').orderBy('submittedAt', 'desc').limit(LIMIT).get()
  const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  const rows = all.filter(withinWindow)

  const report = {
    window: { since: SINCE || 'all time', until: UNTIL || 'now' },
    total: rows.length,
    byCategory: tally(rows, (r) => r.category),
    byRole: tally(rows, (r) => r.role),
    // 'prompt' = the after-use card earned it; 'page' = they went looking for the form.
    bySource: tally(rows, (r) => r.source || 'page'),
    byPage: tally(rows, (r) => {
      try {
        return new URL(String(r.page || '')).pathname
      } catch {
        return String(r.page || '—')
      }
    }),
    newest: rows.slice(0, 15).map((r) => ({
      at: r.submittedAt || '',
      category: r.category || '',
      role: r.role || '',
      source: r.source || 'page',
      message: r.message || '',
    })),
  }

  if (AS_JSON) {
    console.log(JSON.stringify(report, null, 2))
    return
  }

  line(`WHAT PEOPLE DIDN'T LIKE — ${report.total} answer(s) · ${report.window.since} → ${report.window.until}`)
  line('')

  if (report.total === 0) {
    line('  Nothing yet. The after-use card asks once somebody has looked around, and the')
    line('  form lives at /feedback for anyone who goes looking.')
    return
  }

  line('  WHERE IT CAME FROM         (a prompt answer is worth more than a form answer)')
  report.bySource.forEach(([source, count]) => {
    line(`    ${source.padEnd(10)} ${String(count).padStart(4)}  ${Math.round((count / report.total) * 100)}%`)
  })
  line('')

  line('  WHAT KIND')
  report.byCategory.forEach(([category, count]) => {
    line(`    ${category.padEnd(18)} ${String(count).padStart(4)}`)
  })
  line('')

  line('  WHO')
  report.byRole.forEach(([role, count]) => {
    line(`    ${role.padEnd(10)} ${String(count).padStart(4)}`)
  })
  line('')

  line('  WHICH SCREEN THEY WERE ON  (fix the screen, not just the sentence)')
  report.byPage.forEach(([page, count]) => {
    line(`    ${page.padEnd(24)} ${String(count).padStart(4)}`)
  })
  line('')

  line('  THE NEWEST 15, VERBATIM')
  report.newest.forEach((r, i) => {
    const when = String(r.at).slice(0, 16).replace('T', ' ')
    line('')
    line(`  ${String(i + 1).padStart(2)}. ${when}  [${r.category}]  ${r.role} via ${r.source}`)
    line(`      “${String(r.message).replace(/\s+/g, ' ').trim()}”`)
  })

  if (WITH_CONTACT) {
    line('')
    line('  CONTACT DETAILS (only because --with-contact was passed)')
    rows.filter((r) => r.contact || r.name || r.userEmail).slice(0, 15).forEach((r) => {
      line(`    ${r.name || '—'} · ${r.contact || '—'} · ${r.userEmail || '—'}`)
    })
  } else {
    line('')
    line('  (names and emails are hidden — pass --with-contact to see them)')
  }
}

main().catch((err) => {
  console.error('Feedback report failed:', err.message || err)
  process.exit(1)
})
