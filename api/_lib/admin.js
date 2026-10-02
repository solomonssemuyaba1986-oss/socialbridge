/**
 * `firebase-admin`, initialised once and only when it is actually needed.
 *
 * The server holds the only key that can set a user's `phoneNumber` and mint a custom token — the
 * two things that make a proved number *unforgeable* from the browser. That key arrives as one of
 * three environment shapes, most conveniently `FIREBASE_SERVICE_ACCOUNT_BASE64` (a whole JSON file
 * on one line, which is the only form a Vercel environment variable takes happily).
 *
 * Nothing here is imported by `src/` — the admin SDK bundles a private key's worth of weight and
 * must never reach the browser (`eslint.config.js` and `_otp_check.cjs` both say so).
 */
import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app'
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'

export { FieldValue, Timestamp }

let cachedApp = null
let settingsApplied = false

/**
 * Reads the service account out of the environment.
 *
 * `FIREBASE_SERVICE_ACCOUNT_BASE64` is preferred because a raw multi-line private key does not
 * survive most dashboards intact. `FIREBASE_SERVICE_ACCOUNT_JSON` is accepted too, including the
 * common case where the newlines were escaped twice on the way in. Returning `null` means "fall
 * back to Application Default Credentials" (the local `GOOGLE_APPLICATION_CREDENTIALS` file).
 */
export function serviceAccountFrom(env = process.env) {
  if (env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
    const decoded = Buffer.from(env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8')
    try {
      return JSON.parse(decoded)
    } catch {
      throw new Error('FIREBASE_SERVICE_ACCOUNT_BASE64 does not decode to JSON')
    }
  }

  if (env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    const raw = String(env.FIREBASE_SERVICE_ACCOUNT_JSON).trim()
    try {
      return JSON.parse(raw)
    } catch {
      try {
        // Escaped newlines, unescaped for the private key.
        return JSON.parse(raw.replace(/\\n/g, '\n'))
      } catch {
        throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON')
      }
    }
  }

  return null
}

/** Whether the server has credentials at all — checked before doing work, so the refusal is clear. */
export function adminConfigured(env = process.env) {
  return Boolean(
    env.FIREBASE_SERVICE_ACCOUNT_BASE64
    || env.FIREBASE_SERVICE_ACCOUNT_JSON
    || env.GOOGLE_APPLICATION_CREDENTIALS,
  )
}

export function adminApp() {
  if (cachedApp) return cachedApp
  const already = getApps()
  if (already.length) {
    cachedApp = already[0]
    return cachedApp
  }
  const account = serviceAccountFrom()
  cachedApp = account
    ? initializeApp({ credential: cert(account) })
    : initializeApp({ credential: applicationDefault() })
  return cachedApp
}

export function adminDb() {
  const db = getFirestore(adminApp())
  if (!settingsApplied) {
    // Fields we do not set should stay absent, not become `undefined` — which Firestore refuses.
    db.settings({ ignoreUndefinedProperties: true })
    settingsApplied = true
  }
  return db
}

export function adminAuth() {
  return getAuth(adminApp())
}
