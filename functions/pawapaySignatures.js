/**
 * pawaPay signs its callbacks; this is how we check the signature before believing one.
 *
 * Cloud Functions cannot IP-allowlist pawaPay, so the signature is the only proof that a callback
 * really came from them — and it is what makes a public callback endpoint safe.
 *
 * pawaPay follows RFC-9421. A signed callback carries:
 *   Content-Digest   `sha-512=:…:`  — a hash of the exact request body
 *   Signature        `sig-pp=:…:`   — base64 DER signature
 *   Signature-Input  `sig-pp=("@method" "@authority" "@path" "signature-date" "content-digest"
 *                      "content-type");alg="ecdsa-p256-sha256";keyid="…";created=…;expires=…`
 *   Signature-Date, Content-Type
 *
 * Two independent questions, and both must be answered yes:
 *   1. does the digest match the body we actually received? (nothing changed in transit)
 *   2. does the signature verify against the rebuilt base, with pawaPay's public key?
 *
 * It fails closed: anything it cannot fully verify is refused, never waved through. A callback that
 * fails here is not a payment — the caller must throw it away, not "handle it anyway".
 */
const crypto = require('crypto')

/** Cloud Functions hands us lower-cased header names; be tolerant anyway. */
function headerBag(headers) {
  const out = {}
  const source = headers || {}
  for (const key of Object.keys(source)) {
    const value = source[key]
    out[String(key).toLowerCase()] = Array.isArray(value) ? value[0] : value
  }
  return out
}

/** `sig-pp=("@method" …);alg="ecdsa-p256-sha256";keyid="k";created=1;expires=2` */
function parseSignatureInput(value) {
  const raw = String(value || '').trim()
  const open = raw.indexOf('(')
  const close = raw.indexOf(')', open + 1)
  if (open < 1 || close < 0) return null
  const label = raw.slice(0, open).replace(/=$/, '').trim()
  const components = raw
    .slice(open + 1, close)
    .split(/\s+/)
    .map((c) => c.replace(/^"|"$/g, '').trim())
    .filter(Boolean)
  const params = {}
  for (const part of raw.slice(close + 1).split(';')) {
    const at = part.indexOf('=')
    if (at < 1) continue
    params[part.slice(0, at).trim().toLowerCase()] = part.slice(at + 1).trim().replace(/^"|"$/g, '')
  }
  return { label, components, params, raw }
}

/**
 * The exact string that was signed — one line per component, in the order `Signature-Input` lists
 * them, then the params line, joined with newlines and with no trailing newline.
 */
function signatureBase(input, request) {
  const r = request || {}
  const headers = headerBag(r.headers)
  const values = {
    '@method': String(r.method || 'POST').toUpperCase(),
    '@authority': String(r.authority || headers.host || ''),
    '@path': String(r.path || ''),
    'signature-date': headers['signature-date'],
    'content-digest': headers['content-digest'],
    'content-type': headers['content-type'],
  }
  const lines = []
  for (const name of input.components) {
    const key = name.toLowerCase()
    const value = values[key]
    if (value === undefined || value === null) return null
    lines.push(`"${key}": ${value}`)
  }
  lines.push(`"@signature-params": ${input.raw}`)
  return lines.join('\n')
}

/** `sha-512=:BASE64:` → does it match this exact body? (timing-safe: nobody should be measuring) */
function digestMatches(contentDigest, rawBody) {
  const raw = String(contentDigest || '').trim()
  const match = raw.match(/^(sha-256|sha-512)=:(.+):$/)
  if (!match) return false
  const algorithm = match[1] === 'sha-512' ? 'sha512' : 'sha256'
  const body = rawBody === undefined ? '' : String(rawBody)
  const actual = crypto.createHash(algorithm).update(body, 'utf8').digest('base64')
  const a = Buffer.from(actual)
  const b = Buffer.from(match[2])
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

/** pawaPay's algorithms mapped to what Node needs. An unknown algorithm is refused, not guessed. */
function verifyWith(key, signature, base, alg) {
  const upper = String(alg || '').toLowerCase()
  const data = Buffer.from(base, 'utf8')
  if (upper === 'ed25519') return crypto.verify(null, data, key, signature)
  if (upper.includes('pss')) {
    return crypto.verify('sha512', data, {
      key,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
    }, signature)
  }
  if (upper.includes('384')) return crypto.verify('sha384', data, key, signature)
  if (upper.includes('256')) return crypto.verify('sha256', data, key, signature)
  return false
}

/**
 * `{ ok, reason }` — and `reason` is for our logs, never for a buyer.
 *
 *   'unsigned' · 'bad-digest' · 'bad-base' · 'bad-signature' · 'no-public-key' · 'not-verified'
 */
function verifyCallbackSignature({ headers, rawBody, method, authority, path, publicKeys }) {
  const bag = headerBag(headers)
  const input = parseSignatureInput(bag['signature-input'])
  const signatureHeader = String(bag.signature || '').trim()
  if (!input || !signatureHeader) return { ok: false, reason: 'unsigned' }

  if (!digestMatches(bag['content-digest'], rawBody)) return { ok: false, reason: 'bad-digest' }

  const base = signatureBase(input, { headers: bag, method, authority, path })
  if (!base) return { ok: false, reason: 'bad-base' }

  const match = signatureHeader.match(/^[^=]+=:(.+):$/)
  if (!match) return { ok: false, reason: 'bad-signature' }
  const signature = Buffer.from(match[1], 'base64')

  const keys = (Array.isArray(publicKeys) ? publicKeys : []).filter((k) => k && k.key)
  if (!keys.length) return { ok: false, reason: 'no-public-key' }
  const wanted = input.params.keyid
  const ordered = wanted
    ? keys.filter((k) => k.id === wanted).concat(keys.filter((k) => k.id !== wanted))
    : keys

  for (const entry of ordered) {
    try {
      if (verifyWith(entry.key, signature, base, input.params.alg)) {
        return { ok: true, reason: 'verified', keyId: entry.id || '' }
      }
    } catch {
      // A key we cannot even parse is not permission to trust the next one blindly — keep trying,
      // and let the caller refuse if nothing verifies.
    }
  }
  return { ok: false, reason: 'not-verified' }
}

module.exports = {
  headerBag,
  parseSignatureInput,
  signatureBase,
  digestMatches,
  verifyCallbackSignature,
}
