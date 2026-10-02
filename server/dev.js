/**
 * The local stand-in for Vercel's `/api`.
 *
 * Vercel turns `api/otp/send.js` into `/api/otp/send` on its own. On a laptop there is no Vercel,
 * so this file mounts *the very same handler modules* onto `node:http` — no second copy of the
 * logic, which is the mistake that let the old `server/index.js` drift into being a debug build
 * nobody shipped.
 *
 *     npm run otp                     # in one terminal  (http://localhost:3001)
 *     npm run dev                     # in another       (Vite proxies /api/* here)
 *
 * Environment comes from `.env.local` (git-ignored), with anything already set in the shell
 * winning — so `OTP_DAILY_CAP=5 npm run otp` is a one-line way to test the ceiling.
 */
import http from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import sendOtp from '../api/otp/send.js'
import verifyOtp from '../api/otp/verify.js'

const PORT = Number(process.env.PORT) || 3001

const ROUTES = {
  '/api/otp/send': sendOtp,
  '/api/otp/verify': verifyOtp,
}

/** A `.env` file, parsed without a dependency (and never overwriting the shell). */
function loadEnvFile(name) {
  const path = fileURLToPath(new URL(`../${name}`, import.meta.url))
  if (!existsSync(path)) return 0
  let loaded = 0
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined) { process.env[key] = value; loaded += 1 }
  }
  return loaded
}

loadEnvFile('.env.local')
loadEnvFile('.env')

const sendJson = (res, status, payload) => {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(payload))
}

/** Vercel hands a parsed `req.body` to a JSON request; Vite's proxy does not, so we do. */
async function readBody(req) {
  if (req.method !== 'POST') return
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const text = Buffer.concat(chunks).toString('utf8')
  if (!text) return
  if (String(req.headers['content-type'] || '').includes('json')) {
    try { req.body = JSON.parse(text) } catch { req.body = undefined }
  }
}

const server = http.createServer(async (req, res) => {
  const path = new URL(req.url || '/', `http://localhost:${PORT}`).pathname.replace(/(.)\/+$/, '$1')

  if (path === '/api/health') return sendJson(res, 200, { ok: true, status: 'ok' })

  const handler = ROUTES[path]
  if (!handler) return sendJson(res, 404, { ok: false, error: `No such endpoint: ${path}` })

  try {
    await readBody(req)
    await handler(req, res)
  } catch (err) {
    // The handlers answer their own failures; getting here means something unexpected broke.
    console.error(`[dev] ${path} threw:`, err)
    if (!res.headersSent) sendJson(res, 500, { ok: false, error: 'Something went wrong on the server.' })
    else res.end()
  }
})

server.listen(PORT, () => {
  const ready = []
  const missing = []
  ;(process.env.OTP_PEPPER ? ready : missing).push('OTP_PEPPER')
  ;(process.env.YOOLA_API_KEY ? ready : missing).push('YOOLA_API_KEY')
  ;(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 || process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_APPLICATION_CREDENTIALS ? ready : missing).push('Firebase service account')

  console.log(`rachett OTP api on http://localhost:${PORT}`)
  console.log(`  ready:   ${ready.join(', ') || 'nothing yet'}`)
  console.log(`  missing: ${missing.join(', ') || 'nothing — you are fully switched on'}`)
  if (missing.length) {
    console.log('  Missing values make /api/otp/send answer 503 on purpose — it will not fake a send.')
  }
})
