const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https')
const { defineSecret } = require('firebase-functions/params')
const admin = require('firebase-admin')
const { Resend } = require('resend')
const pesapal = require('./pesapal')
const { orderTotal } = require('./orderAmount')
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

/* ─── Pesapal payments ───────────────────────────────────────────────────────────────────────
 *
 * Three functions, and the shape of a payment is:
 *
 *   pesapalStartPayment   the buyer taps Pay        → a redirect link to Pesapal
 *   pesapalIpn            Pesapal tells *us*        → the source of truth (server to server)
 *   pesapalPaymentStatus  "did it actually work?"   → what the page a buyer returns to asks
 *
 * The keys never leave here: `functions/pesapal.js` reads them from secrets and talks to Pesapal.
 * Nothing in the app can mark an order paid — only these, and only from what Pesapal says.
 */

const PESAPAL_CONSUMER_KEY = defineSecret('PESAPAL_CONSUMER_KEY')
const PESAPAL_CONSUMER_SECRET = defineSecret('PESAPAL_CONSUMER_SECRET')
const PESAPAL_IPN_ID = defineSecret('PESAPAL_IPN_ID')

/** Live unless something says otherwise — Pesapal's sandbox is a deliberate opt-in. */
const PESAPAL_ENV = process.env.PESAPAL_ENV || 'live'
const PAYMENT_CURRENCY = process.env.PESAPAL_CURRENCY || 'UGX'
const PAYMENT_COUNTRY = process.env.PESAPAL_COUNTRY || 'UG'
/** Billing is invoice detail only; the buyer's own email/phone is used whenever we have it. */
const PAYMENT_BILLING_EMAIL = process.env.PESAPAL_BILLING_EMAIL || 'rachettcommerce@gmail.com'
const PAYMENT_BILLING_PHONE = process.env.PESAPAL_BILLING_PHONE || '0700000000'
/** Where Pesapal sends the buyer back. Only this path matters — the origin comes from the request. */
const PAYMENT_RETURN_PATH = '/pay/return'
/** One document per payment attempt. Server-only: `firestore.rules` never mentions it. */
const PAYMENTS = 'payments'
const PAYMENT_NOT_CONFIGURED = 'Payment is not configured yet. Contact support.'

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function pesapalCredentials() {
  return {
    consumerKey: PESAPAL_CONSUMER_KEY.value(),
    consumerSecret: PESAPAL_CONSUMER_SECRET.value(),
    env: PESAPAL_ENV,
  }
}

/** Keys *and* the registered IPN — without the IPN id a payment could never be confirmed. */
function paymentsConfigured() {
  return pesapal.isConfigured(pesapalCredentials()) && Boolean(PESAPAL_IPN_ID.value())
}

/**
 * Where the buyer comes back to. The origin is taken from the request itself (a browser sets it and
 * page scripts cannot forge it) or from `APP_URL`, never from anything the caller sent — otherwise
 * a payment could be pointed at somebody else's page.
 */
function paymentReturnUrl(request, cancelled) {
  const configured = text(process.env.APP_URL)
  const headers = (request && request.rawRequest && request.rawRequest.headers) || {}
  const origin = (configured || text(headers.origin)).replace(/\/+$/, '')
  if (!/^https?:\/\/[^/]+$/i.test(origin)) {
    throw new HttpsError('failed-precondition', 'We could not work out where to send you back.')
  }
  return `${origin}${PAYMENT_RETURN_PATH}${cancelled ? '?cancelled=1' : ''}`
}

/** What Pesapal wants as `billing_address`. Invoice detail — never a card number. */
function billingAddressFor(order, buyerEmail) {
  const name = text(order && order.buyerName)
  const parts = name.split(/\s+/).filter(Boolean)
  const firstName = parts[0] || 'rachett buyer'
  return {
    email_address: text(buyerEmail) || PAYMENT_BILLING_EMAIL,
    phone_number: text(order && order.buyerPhone) || PAYMENT_BILLING_PHONE,
    country_code: PAYMENT_COUNTRY,
    first_name: firstName,
    middle_name: '',
    last_name: parts.slice(1).join(' ') || firstName,
    line_1: '',
    line_2: '',
    city: '',
    state: '',
    postal_code: '',
    zip_code: '',
  }
}

/**
 * Start a payment for one of the buyer's own orders. The order decides the amount, the order decides
 * who may pay it, and Pesapal decides where the buyer goes next.
 */
exports.pesapalStartPayment = onCall(
  { secrets: [PESAPAL_CONSUMER_KEY, PESAPAL_CONSUMER_SECRET, PESAPAL_IPN_ID] },
  async (request) => {
    const uid = request.auth && request.auth.uid
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in to pay for an order.')
    if (!paymentsConfigured()) throw new HttpsError('failed-precondition', PAYMENT_NOT_CONFIGURED)

    const sellerId = text(request.data && request.data.sellerId)
    const orderId = text(request.data && request.data.orderId)
    if (!sellerId || !orderId) {
      throw new HttpsError('invalid-argument', 'We could not find that order.')
    }

    const orderRef = db.collection('sellers').doc(sellerId).collection('orders').doc(orderId)
    const snap = await orderRef.get()
    if (!snap.exists) throw new HttpsError('not-found', 'We could not find that order.')

    const order = snap.data()
    if (order.buyerUid !== uid) {
      throw new HttpsError('permission-denied', 'That order belongs to someone else.')
    }
    if (order.status === 'paid' || order.paymentStatus === 'completed') {
      throw new HttpsError('failed-precondition', 'This order is already paid.')
    }

    // The amount comes from the order's own arithmetic (`orderAmount.js`), never from the browser.
    const totals = orderTotal(order)
    const amount = totals ? pesapal.toPesapalAmount(totals.total, PAYMENT_CURRENCY) : null
    if (!amount) throw new HttpsError('failed-precondition', 'This order has no price we can charge.')

    const reference = pesapal.buildPaymentReference()
    const callbackUrl = paymentReturnUrl(request, false)
    const buyerEmail = request.auth.token && request.auth.token.email

    const created = await pesapal.submitOrder({
      ...pesapalCredentials(),
      id: reference,
      amount,
      currency: PAYMENT_CURRENCY,
      description: `rachett order ${text(order.orderId) || orderId}`,
      callbackUrl,
      cancellationUrl: paymentReturnUrl(request, true),
      notificationId: PESAPAL_IPN_ID.value(),
      billing: billingAddressFor(order, buyerEmail),
    })

    const orderTrackingId = text(created.order_tracking_id)
    const now = admin.firestore.FieldValue.serverTimestamp()

    await db.collection(PAYMENTS).doc(reference).set({
      reference,
      orderTrackingId,
      sellerId,
      orderId,
      buyerUid: uid,
      buyerName: text(order.buyerName),
      amount,
      currency: PAYMENT_CURRENCY,
      status: 'initiated',
      callbackUrl,
      createdAt: now,
      updatedAt: now,
    })

    // The order is *not* paid — this only records that a payment exists. `status` is left exactly as
    // the seller had it (still `pending`), so nothing in the app can read a payment as a delivery.
    await orderRef.set({
      paymentStatus: 'initiated',
      paymentReference: reference,
      paymentTrackingId: orderTrackingId,
      paymentMethod: 'Pesapal',
      paymentAmount: amount,
      paymentCurrency: PAYMENT_CURRENCY,
      paymentInitiatedAt: now,
      paymentUpdatedAt: now,
      paymentAttempts: admin.firestore.FieldValue.increment(1),
    }, { merge: true })

    return {
      redirectUrl: text(created.redirect_url),
      orderTrackingId,
      reference,
      amount,
      currency: PAYMENT_CURRENCY,
    }
  }
)

/**
 * The one place a payment is ever decided. Both the IPN and the "did it work?" check come through
 * here, so the two can never disagree — and four rules hold, whatever arrives:
 *
 *   1. the status always comes from Pesapal itself, never from a URL or a request body
 *   2. a completed payment for the wrong amount is flagged for a person, not applied
 *   3. applying the same status twice changes nothing (Pesapal retries IPNs by design)
 *   4. a late FAILED after a COMPLETED never un-pays an order
 */
async function verifyPaymentStatus(payment, reference) {
  const orderTrackingId = text(payment && payment.orderTrackingId)
  if (!orderTrackingId) {
    throw new HttpsError('failed-precondition', 'That payment has no tracking id yet.')
  }

  const status = await pesapal.getTransactionStatus({ ...pesapalCredentials(), orderTrackingId })
  const mapped = pesapal.mapPesapalStatus(status)

  const orderRef = db.collection('sellers').doc(text(payment.sellerId))
    .collection('orders').doc(text(payment.orderId))
  const orderSnap = await orderRef.get()
  const order = orderSnap.exists ? orderSnap.data() : {}

  const alreadyPaid = order.status === 'paid' || order.paymentStatus === 'completed'
  const mismatch = mapped.paid
    && !pesapal.amountMatches({ amount: payment.amount, currency: payment.currency }, status)

  let resolved = mismatch ? 'review' : mapped.status
  let note = ''
  if (alreadyPaid && resolved !== 'completed') {
    note = `A later ${resolved} status was ignored: this order was already paid.`
    resolved = 'completed'
  }

  const now = admin.firestore.FieldValue.serverTimestamp()
  const method = text(status.payment_method) || 'Pesapal'
  const amountPaid = Number(status.amount) || 0
  const applied = mapped.paid && !mismatch && !alreadyPaid

  await db.collection(PAYMENTS).doc(text(payment.reference) || reference).set({
    status: resolved,
    orderTrackingId,
    method,
    amountPaid,
    currencyPaid: text(status.currency),
    account: text(status.payment_account),
    confirmationCode: text(status.confirmation_code),
    description: text(mapped.description),
    statusCode: mapped.code,
    note,
    checkedAt: now,
    updatedAt: now,
    ...(applied ? { completedAt: now } : {}),
  }, { merge: true })

  if (!orderSnap.exists) {
    return { mapped, status, resolved, applied, alreadyPaid, mismatch, method, amountPaid, orderStatus: null }
  }

  const orderPatch = {
    paymentStatus: resolved,
    paymentMethod: method,
    paymentAmount: amountPaid || Number(payment.amount) || 0,
    paymentCurrency: text(status.currency) || PAYMENT_CURRENCY,
    paymentConfirmationCode: text(status.confirmation_code),
    paymentUpdatedAt: now,
    ...(mismatch ? { paymentNote: 'The amount paid did not match this order.' } : {}),
    ...(note ? { paymentNote: note } : {}),
  }
  if (applied) {
    orderPatch.paidAt = now
    // Only an order still waiting to be dealt with moves to `paid`. A seller who has already
    // delivered keeps their status — money arriving late must not undo their work.
    if (!order.status || order.status === 'pending' || order.status === 'awaiting_payment') {
      orderPatch.status = 'paid'
    }
  }

  await orderRef.set(orderPatch, { merge: true })
  return {
    mapped,
    status,
    resolved,
    applied,
    alreadyPaid,
    mismatch,
    method,
    amountPaid,
    orderStatus: orderPatch.status || order.status || null,
  }
}

/**
 * The IPN: Pesapal calling *us*, server to server — the reason a payment survives a buyer closing
 * the browser. Registered as POST (`pesapal-register-ipn.js`), but a GET is answered as well.
 *
 * The reply is the exact JSON Pesapal documents: `status: 200` means "received and processed",
 * `500` means "we could not process it" — which is what makes Pesapal send it again rather than
 * letting a payment quietly disappear.
 */
exports.pesapalIpn = onRequest(
  { secrets: [PESAPAL_CONSUMER_KEY, PESAPAL_CONSUMER_SECRET] },
  async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {}
    const params = { ...(req.query || {}), ...body }

    let ipn
    try {
      ipn = pesapal.parseIpnParams(params)
    } catch (err) {
      // Not a shape Pesapal documents — somebody else is knocking. Say so, and never retry-loop.
      console.error('[pesapal] IPN we cannot read:', err && err.message)
      res.status(400).send(pesapal.ipnResponse({ ok: false }))
      return
    }

    try {
      const snap = await db.collection(PAYMENTS).doc(ipn.merchantReference).get()
      if (!snap.exists) {
        // Nothing of ours has that reference, and retrying will not change that: accept and move on.
        console.warn('[pesapal] IPN for a reference we do not know:', ipn.merchantReference)
        res.status(200).send(pesapal.ipnResponse({ ...ipn, ok: true }))
        return
      }

      const result = await verifyPaymentStatus(
        { ...snap.data(), reference: ipn.merchantReference },
        ipn.merchantReference
      )
      console.log(
        `[pesapal] IPN ${ipn.merchantReference}: ${result.resolved}`
        + (result.applied ? ' — order marked paid' : '')
      )
      res.status(200).send(pesapal.ipnResponse({ ...ipn, ok: true }))
    } catch (err) {
      // Telling Pesapal it failed is the honest answer: it will send this again.
      console.error('[pesapal] IPN could not be processed:', err && err.message)
      res.status(500).send(pesapal.ipnResponse({ ...ipn, ok: false }))
    }
  }
)

/** An order nobody has tried to pay yet — an honest answer, not an error. */
function noPaymentCheck(order) {
  return {
    status: text(order && order.paymentStatus) || 'none',
    paid: false,
    orderStatus: text(order && order.status) || null,
    amount: null,
    currency: text(order && order.paymentCurrency),
    method: '',
    confirmationCode: '',
    description: '',
    pending: false,
  }
}

/**
 * "Did it actually work?" — asked by the page a buyer returns to, by any later "check my payment"
 * button, and by whoever is on the phone with a buyer. The URL Pesapal returns them on carries no
 * status, so this asks Pesapal directly; it also *applies* the answer, which means a payment still
 * lands correctly even if the IPN never arrived.
 */
exports.pesapalPaymentStatus = onCall(
  { secrets: [PESAPAL_CONSUMER_KEY, PESAPAL_CONSUMER_SECRET] },
  async (request) => {
    const uid = request.auth && request.auth.uid
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in to check a payment.')
    if (!pesapal.isConfigured(pesapalCredentials())) {
      throw new HttpsError('failed-precondition', PAYMENT_NOT_CONFIGURED)
    }

    const reference = text(request.data && request.data.reference)
    let payment = null

    if (reference) {
      const snap = await db.collection(PAYMENTS).doc(reference).get()
      if (!snap.exists) throw new HttpsError('not-found', 'We could not find that payment.')
      payment = { ...snap.data(), reference }
    } else {
      // No reference yet — the order knows the last one it started, if there was one.
      const sellerId = text(request.data && request.data.sellerId)
      const orderId = text(request.data && request.data.orderId)
      if (!sellerId || !orderId) {
        throw new HttpsError('invalid-argument', 'We could not find that order.')
      }
      const orderSnap = await db.collection('sellers').doc(sellerId)
        .collection('orders').doc(orderId).get()
      if (!orderSnap.exists) throw new HttpsError('not-found', 'We could not find that order.')

      const order = orderSnap.data()
      const known = text(order.paymentReference)
      if (!known) return noPaymentCheck(order)

      const snap = await db.collection(PAYMENTS).doc(known).get()
      if (!snap.exists) return noPaymentCheck(order)
      payment = { ...snap.data(), reference: known }
    }

    // The buyer who paid it, or the seller it was paid for. Nobody else — not even by guessing.
    if (payment.buyerUid !== uid && payment.sellerId !== uid) {
      throw new HttpsError('permission-denied', 'That payment belongs to someone else.')
    }

    const result = await verifyPaymentStatus(payment, payment.reference)
    return {
      status: result.resolved,
      paid: result.resolved === 'completed',
      orderStatus: result.orderStatus,
      amount: result.amountPaid || null,
      currency: text(result.status.currency) || text(payment.currency),
      method: result.method,
      confirmationCode: text(result.status.confirmation_code),
      description: text(result.mapped.description),
      pending: result.resolved === 'initiated' || result.resolved === 'unknown',
    }
  }
)
