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

/**
 * How many numbers one rail may hold.
 *
 * A seller often has a shop till and a personal wallet on the same network — two, but not
 * twenty. The cap lives here so the endpoint, the phone and `_payout_check.cjs` all read the
 * same number instead of each remembering their own.
 */
export const MAX_NUMBERS_PER_METHOD = 2

const E164 = /^\+[1-9]\d{7,14}$/

/**
 * The stable id of one proved number, e.g. `mtn-256771234567`.
 *
 * Derived from the rail and the number rather than minted at random, so proving the same number
 * twice updates one entry instead of filling the seller's two slots with the same phone. Two
 * devices verifying at once therefore converge on the same document.
 */
export function payoutNumberId(method, number) {
  if (!isPayoutMethod(method)) return ''
  const e164 = typeof number === 'string' ? number.trim() : ''
  if (!E164.test(e164)) return ''
  return `${method}-${e164.slice(1)}`
}

/**
 * The numbers this account has proved, keyed by id — tolerating a document an older server wrote.
 *
 * Anything malformed is dropped rather than passed on: a half-written entry is not a proof, and
 * the next server write replaces the map with this cleaned copy.
 *
 * A legacy top-level `mtn`/`airtel` entry is folded in as a number of its own. Documents written
 * before `numbers` existed must not lose their proof the first time a second rail is verified —
 * the seller's existing wallet is still theirs, and it still counts against the cap.
 */
export function storedNumbers(account) {
  const out = {}
  const raw = account && typeof account === 'object' ? account.numbers : null
  if (raw && typeof raw === 'object') {
    for (const [id, entry] of Object.entries(raw)) {
      if (!entry || typeof entry !== 'object') continue
      if (!isPayoutMethod(entry.method)) continue
      const number = typeof entry.number === 'string' ? entry.number.trim() : ''
      const at = Number(entry.verifiedAt)
      if (!E164.test(number)) continue
      if (!Number.isFinite(at) || at <= 0) continue
      out[id] = { method: entry.method, number, verifiedAt: at }
    }
  }
  for (const method of PAYOUT_METHODS) {
    const legacy = verifiedNumberFor(account, method)
    if (!legacy) continue
    const id = payoutNumberId(method, legacy)
    if (!id || out[id]) continue
    out[id] = { method, number: legacy, verifiedAt: Number(account[method].verifiedAt) }
  }
  return out
}

/** The numbers proved for one rail, oldest proof first. */
export function numbersForMethod(account, method) {
  if (!isPayoutMethod(method)) return []
  return Object.entries(storedNumbers(account))
    .filter(([, entry]) => entry.method === method)
    .sort((a, b) => a[1].verifiedAt - b[1].verifiedAt)
    .map(([id, entry]) => ({ id, ...entry }))
}

/**
 * The id of the number that is live for a rail, or ''.
 *
 * `active` wins when it still points at a proved number. An account written before `active`
 * existed falls back to the legacy top-level `mtn`/`airtel` entry, then to the oldest proof — so
 * a seller who verified one number years ago keeps paying out to that same one.
 */
export function activeNumberId(account, method) {
  if (!isPayoutMethod(method)) return ''
  const numbers = storedNumbers(account)
  const claimed = account && typeof account === 'object' && account.active
    ? account.active[method]
    : null
  if (typeof claimed === 'string' && numbers[claimed] && numbers[claimed].method === method) {
    return claimed
  }
  const legacy = verifiedNumberFor(account, method)
  if (legacy) {
    const legacyId = payoutNumberId(method, legacy)
    if (numbers[legacyId]) return legacyId
  }
  const proved = numbersForMethod(account, method)
  return proved.length ? proved[0].id : ''
}

/** The `active` map with every id that no longer points at a proved number removed. */
export function activeMap(account) {
  const numbers = storedNumbers(account)
  const out = {}
  for (const method of PAYOUT_METHODS) {
    const id = activeNumberId(account, method)
    if (id && numbers[id]) out[method] = id
  }
  return out
}

/**
 * The private account document as it should be written: the proved numbers, which one is live
 * per rail, and the legacy top-level entry mirroring that live number.
 *
 * The mirror is what lets `src/PaymentSetup.tsx`, pawaPay and everything written before this
 * field existed read the document unchanged: `account.mtn` always names the number that is
 * actually live, even once a seller has two.
 */
export function accountPatch(account) {
  const numbers = storedNumbers(account)
  const active = activeMap(account)
  const patch = { numbers, active }
  for (const method of PAYOUT_METHODS) {
    const entry = numbers[active[method]]
    if (entry) patch[method] = verifiedEntry(entry.number, entry.verifiedAt)
  }
  return patch
}

/** Can one more number be proved for this rail? A number already proved is not a new one. */
export function canAddNumber(account, method, number) {
  if (!isPayoutMethod(method)) return false
  const id = payoutNumberId(method, number)
  if (!id) return false
  if (storedNumbers(account)[id]) return true
  return numbersForMethod(account, method).length < MAX_NUMBERS_PER_METHOD
}

/** The refusal a seller reads when both slots on a rail are already taken. */
export function tooManyNumbersMessage(method) {
  const name = isPayoutMethod(method) ? PAYOUT_METHOD_NAMES[method] : 'payout'
  return `You already have ${MAX_NUMBERS_PER_METHOD} ${name} numbers verified. rachett keeps `
    + `${MAX_NUMBERS_PER_METHOD}, so this one was not added.`
}

/**
 * The private account document after a code proved `number` for `method`, or null when the rail
 * is already holding its two.
 *
 * A number proved for the first time becomes the live one only when the rail had none — a seller
 * adding a second wallet must not silently move tomorrow's money off the wallet that works.
 */
export function applyVerifiedNumber(account, { method, number, now }) {
  const id = payoutNumberId(method, number)
  if (!id) return null
  if (!canAddNumber(account, method, number)) return null
  const numbers = storedNumbers(account)
  numbers[id] = { method, number, verifiedAt: now }
  const active = activeMap(account)
  if (!active[method]) active[method] = id
  return accountPatch({ ...(account || {}), numbers, active })
}

/** The private account document with another proved number made live, or null if it is not one. */
export function applyActivation(account, { method, numberId }) {
  if (!isPayoutMethod(method)) return null
  const numbers = storedNumbers(account)
  if (typeof numberId !== 'string' || !numbers[numberId]) return null
  if (numbers[numberId].method !== method) return null
  return accountPatch({ ...(account || {}), active: { ...activeMap(account), [method]: numberId } })
}
