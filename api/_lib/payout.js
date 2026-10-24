/**
 * The rules around a seller's payout numbers, in one pure place.
 *
 * A number typed into the Payouts page is only a hope until the person holding that phone
 * enters the code we texted to it. The endpoint (`api/payout/methods.js`) owns the network and
 * Firestore work; this file owns the decisions, so `_payout_check.cjs` can prove them without a
 * database, an SMS credit or a browser:
 *
 *  - which rails may be saved (`mtn`, `airtel` — card is not live yet);
 *  - what counts as a verified account (a number **and** the timestamp the code proved it);
 *  - which enabled rails still have no proof, so a save can be refused before it reaches
 *    Firestore.
 *
 * A payout number is more sensitive than the shop's public phone number: it is where money goes.
 * So the verified copy lives in `payoutAccounts/{uid}` (owner-read, server-write) and the public
 * seller document carries only the fact that the rail is on — never the number.
 */

/** The rails a seller may verify today. Card is display-only until cards are live. */
export const PAYOUT_METHODS = ['mtn', 'airtel']

/** The words a screen can use without learning the number. */
export const PAYOUT_METHOD_NAMES = {
  mtn: 'MTN MoMo',
  airtel: 'Airtel Money',
}

export function isPayoutMethod(value) {
  return typeof value === 'string' && PAYOUT_METHODS.includes(value)
}

/**
 * The number this seller proved for a rail, or ''.
 *
 * Both parts matter. A number alone could have been copied into the document by hand; a
 * `verifiedAt` that is not a positive number is not a proof. Returning '' rather than throwing
 * keeps the endpoint's refusal a sentence instead of a 500.
 */
export function verifiedNumberFor(account, method) {
  if (!isPayoutMethod(method) || !account || typeof account !== 'object') return ''
  const entry = account[method]
  if (!entry || typeof entry !== 'object') return ''
  const number = typeof entry.number === 'string' ? entry.number.trim() : ''
  const at = Number(entry.verifiedAt)
  if (!/^\+[1-9]\d{7,14}$/.test(number)) return ''
  if (!Number.isFinite(at) || at <= 0) return ''
  return number
}

/** What the private account document holds for one rail after a code came back correct. */
export function verifiedEntry(number, now) {
  return { number, verifiedAt: now }
}

/** What the browser asked to switch on. Only an exact `true` counts. */
export function flagsFrom(body) {
  return {
    mtn: Boolean(body && body.mtn === true),
    airtel: Boolean(body && body.airtel === true),
  }
}

/** The enabled rails that have no proved number — what makes a save impossible. */
export function methodsMissingProof(flags, account) {
  return PAYOUT_METHODS.filter(
    method => flags && flags[method] === true && !verifiedNumberFor(account, method),
  )
}

/** A short, safe sentence naming the rails that still need a code. */
export function missingProofMessage(missing) {
  const names = (Array.isArray(missing) ? missing : [])
    .filter(isPayoutMethod)
    .map(method => PAYOUT_METHOD_NAMES[method])
  if (names.length === 0) return ''
  const list = names.length === 1
    ? names[0]
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  return `Verify your ${list} number with the code first.`
}

/** What the public seller document may say about a rail: that it is on, never the number. */
export function publicRailPatch(now) {
  return {
    enabled: true,
    verified: true,
    verifiedAt: now,
  }
}
