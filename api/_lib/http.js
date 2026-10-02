/**
 * The little that every OTP handler needs, and nothing more.
 *
 * These are Vercel Node functions, so `req`/`res` are the plain Node objects (Vercel adds a
 * parsed `req.body` for JSON). Both handlers must behave identically whether they are reached
 * through Vercel in production or through `server/dev.js` on a laptop, so all the framing lives
 * here rather than in either handler.
 */

/**
 * Who may call us from another origin.
 *
 * Production needs none of this — the site and the API share a domain, so the browser never
 * sends a preflight. It exists for the one case that would otherwise be impossible to test
 * locally: the Vite dev server on :5173 calling the API on :3001. Local hostnames are allowed
 * outright; anything else must be named in `ALLOWED_ORIGINS`.
 */
export function allowedOrigin(origin, host, env = process.env) {
  if (!origin) return ''
  let parsed
  try { parsed = new URL(origin) } catch { return '' }

  const { hostname } = parsed
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname.endsWith('.localhost')) {
    return origin
  }

  const named = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)
  if (named.includes(origin)) return origin
  if (host && origin === `https://${host}`) return origin
  return ''
}

/** Sets CORS headers when they are warranted, and answers `OPTIONS` with a no-content reply. */
export function applyCors(req, res) {
  const origin = allowedOrigin(String(req.headers?.origin || ''), String(req.headers?.host || ''))
  if (!origin) return false
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Vary', 'Origin')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Access-Control-Max-Age', '86400')
  return true
}

export function sendJson(res, status, payload) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  // Nothing here is cacheable — a code's status must be read fresh, every time.
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(payload))
}

/** The success shape. Every handler answers with `{ ok: true, ... }` or `{ ok: false, ... }`. */
export function ok(res, payload = {}) {
  sendJson(res, 200, { ok: true, ...payload })
}

/** The failure shape. `error` is always safe to show a person verbatim. */
export function fail(res, status, error, extra = {}) {
  sendJson(res, status, { ok: false, error, ...extra })
}

/** Vercel parses a JSON body for us; a stream or a stray string is read here instead. */
export async function readJsonBody(req) {
  const raw = req.body
  if (raw !== undefined && raw !== null && typeof raw === 'object') return raw
  if (typeof raw === 'string' && raw.trim()) {
    try { return JSON.parse(raw) } catch { return null }
  }

  const chunks = []
  try {
    for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  } catch {
    return null
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (!text.trim()) return null
  try { return JSON.parse(text) } catch { return null }
}

/** One field off a body, as a trimmed string — never a number, never an object. */
export function field(body, name) {
  const value = body ? body[name] : undefined
  return typeof value === 'string' ? value.trim() : ''
}
