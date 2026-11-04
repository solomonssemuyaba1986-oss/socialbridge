import { existsSync, readFileSync } from 'node:fs'
for (const f of ['.env.local', '.env']) {
  if (!existsSync(f)) continue
  for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq < 1) continue
    const k = t.slice(0, eq).trim()
    let v = t.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (process.env[k] === undefined) process.env[k] = v
  }
}
const { adminAuth, adminDb } = await import('./api/_lib/admin.js')
try {
  const u = await adminAuth().getUserByPhoneNumber('+256770000123')
  console.log('AUTH ok, user:', u.uid)
} catch (e) {
  console.log('AUTH ERROR:', e.code, '|', String(e.message).split('\n')[0])
}
try {
  const s = await adminDb().collection('sellers').limit(1).get()
  console.log('FIRESTORE ok, docs:', s.size)
} catch (e) {
  console.log('FIRESTORE ERROR:', e.code, '|', String(e.message).split('\n')[0])
}
