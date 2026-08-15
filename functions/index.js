const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { defineSecret } = require('firebase-functions/params')
const admin = require('firebase-admin')
const { Resend } = require('resend')
const crypto = require('crypto')

admin.initializeApp()
const db = admin.firestore()

const RESEND_API_KEY = defineSecret('RESEND_API_KEY')
const RESEND_FROM_EMAIL = defineSecret('RESEND_FROM_EMAIL')

const CODE_TTL_MS = 10 * 60 * 1000 // 10 minutes

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function docIdForEmail(email) {
  return sha256(email).slice(0, 32)
}

/**
 * Send a 6-digit recovery code to a seller's recovery email.
 * The code is stored hashed with a 10-minute expiry.
 */
exports.sendRecoveryCode = onCall(
  { secrets: [RESEND_API_KEY, RESEND_FROM_EMAIL] },
  async (request) => {
    const email = typeof request.data?.email === 'string'
      ? request.data.email.trim().toLowerCase()
      : ''
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new HttpsError('invalid-argument', 'Enter a valid email address')
    }

    // Only allow recovery for a real account: a seller store OR a Firebase Auth user
    const sellers = await db.collection('sellers').where('recoveryEmail', '==', email).limit(1).get()
    let accountFound = !sellers.empty

    if (!accountFound) {
      try {
        await admin.auth().getUserByEmail(email)
        accountFound = true
      } catch (err) {
        // user doesn't exist in auth — accountFound stays false
      }
    }

    if (!accountFound) {
      throw new HttpsError('not-found', 'No account found with that email.')
    }

    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0')

    await db.collection('recoveries').doc(docIdForEmail(email)).set({
      email,
      codeHash: sha256(code),
      expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + CODE_TTL_MS),
      verified: false,
      attempts: 0,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    })

    const resend = new Resend(RESEND_API_KEY.value())
    await resend.emails.send({
      from: RESEND_FROM_EMAIL.value(),
      to: email,
      subject: 'Your rachett recovery code',
      text: `Your rachett recovery code is ${code}.\n\nIt expires in 10 minutes. If you didn't request this, you can ignore this email.`,
    })

    return { ok: true }
  }
)

/**
 * Verify a recovery code entered by the user.
 */
exports.verifyRecoveryCode = onCall(async (request) => {
  const email = typeof request.data?.email === 'string'
    ? request.data.email.trim().toLowerCase()
    : ''
  const code = typeof request.data?.code === 'string' ? request.data.code.trim() : ''

  if (!email || !/^\d{6}$/.test(code)) {
    throw new HttpsError('invalid-argument', 'Enter the 6-digit code')
  }

  const ref = db.collection('recoveries').doc(docIdForEmail(email))
  const snap = await ref.get()
  if (!snap.exists) {
    throw new HttpsError('not-found', 'No recovery request found. Request a new code.')
  }

  const data = snap.data()
  const expiresAt = data.expiresAt?.toMillis?.() || 0
  if (expiresAt < Date.now()) {
    throw new HttpsError('deadline-exceeded', 'This code expired. Request a new one.')
  }

  if (sha256(code) !== data.codeHash) {
    await ref.update({ attempts: admin.firestore.FieldValue.increment(1) })
    throw new HttpsError('unauthenticated', 'Incorrect code. Try again.')
  }

  await ref.update({ verified: true })
  return { ok: true, email }
})
