/**
 * Dev-only harness for the SMS-code listener (`src/useSmsOtp.ts` and the origin-bound line in
 * `api/_lib/sms.js`).
 *
 *   node _sms_autofill_check.cjs
 *
 * No browser, network, keys or database. Node 25 can import the TypeScript module directly, so
 * the pure helpers and the fallback paths run for real; the screens are checked at the source
 * level because they need React to render.
 */
const assert = require('assert')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const ROOT = __dirname
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8')

let checks = 0
const check = async (name, fn) => {
  try {
    await fn()
  } catch (err) {
    err.message = `${name}\n    ${err.message}`
    throw err
  }
  checks++
  console.log('  ok  ' + name)
}

/** Run a callback with a fake browser, then put Node's own globals back. */
async function withBrowser({ secure = true, otp = true, get } = {}, fn) {
  const originalWindow = Object.prototype.hasOwnProperty.call(globalThis, 'window')
    ? globalThis.window
    : undefined
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const fakeWindow = { isSecureContext: secure }
  if (otp) fakeWindow.OTPCredential = function OTPCredential() {}
  globalThis.window = fakeWindow
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    writable: true,
    value: { credentials: get ? { get } : undefined },
  })
  try {
    return await fn()
  } finally {
    if (originalWindow === undefined) delete globalThis.window
    else globalThis.window = originalWindow
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator)
    else delete globalThis.navigator
  }
}

/** The one line Chrome reads. It must be last, and the code must be 4–8 digits. */
function parseOriginBound(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n')
  const last = lines[lines.length - 1]
  const match = /^@([^\s]+) #(\d{4,8})$/.exec(last)
  return match ? { host: match[1], code: match[2] } : null
}

;(async () => {
  const sms = await import('./api/_lib/sms.js')
  const otp = await import(pathToFileURL(path.join(ROOT, 'src/useSmsOtp.ts')).href)

  const YOOLA = {
    configured: true,
    missing: [],
    apiKey: 'yoola-key',
    apiUrl: sms.YOOLA_API_URL,
    senderId: 'Rachett',
  }
  const ESMS = {
    configured: true,
    missing: [],
    apiKey: 'esms_live_test',
    apiUrl: sms.ESMS_API_URL,
    senderId: 'Rachett',
  }
  const CONFIG = { configured: true, missing: [], yoola: YOOLA, esms: ESMS }

  // ── the origin-bound line the SMS carries ───────────────────────────────────────────────────
  await check('the code is on the last line, bound to the site host', () => {
    const text = sms.buildSmsText('123456', 'https://www.Rachett.com/store/acme?ref=1')
    const parsed = parseOriginBound(text)
    assert.deepStrictEqual(parsed, { host: 'www.rachett.com', code: '123456' })
    assert.strictEqual(text.split('\n').length, 2)
    assert.ok(text.startsWith('Your rachett code is 123456.'), 'the human sentence still leads')
  })

  await check('a bad or empty host falls back to the documented site, never an invalid line', () => {
    assert.strictEqual(sms.webOtpHost(''), sms.DEFAULT_WEB_HOST)
    assert.strictEqual(sms.webOtpHost('   '), sms.DEFAULT_WEB_HOST)
    assert.strictEqual(sms.webOtpHost('not a host'), sms.DEFAULT_WEB_HOST)
    assert.strictEqual(sms.webOtpHost('https://EXAMPLE.com/a/b'), 'example.com')
    assert.strictEqual(parseOriginBound(sms.buildSmsText('123456', 'bad host')).host, sms.DEFAULT_WEB_HOST)

    const before = process.env.OTP_WEB_HOST
    try {
      process.env.OTP_WEB_HOST = 'https://env.rachett.com/store'
      assert.deepStrictEqual(parseOriginBound(sms.buildSmsText('123456')), {
        host: 'env.rachett.com', code: '123456',
      })
    } finally {
      if (before === undefined) delete process.env.OTP_WEB_HOST
      else process.env.OTP_WEB_HOST = before
    }
  })

  await check('both providers carry the same origin-bound text', async () => {
    const calls = []
    const fetchImpl = async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) })
      return { status: 200, text: async () => '{"status":"submitted"}' }
    }
    const host = 'shop.rachett.com'

    await sms.sendSms({
      e164: '+256704487563', dial: '+256', code: '123456', config: CONFIG, fetchImpl, host,
    })
    await sms.sendSms({
      e164: '+2348012345678', dial: '+234', code: '123456', config: CONFIG, fetchImpl, host,
    })

    assert.strictEqual(calls.length, 2)
    assert.deepStrictEqual(parseOriginBound(calls[0].body.message), { host, code: '123456' })
    assert.deepStrictEqual(parseOriginBound(calls[1].body.text), { host, code: '123456' })
  })

  // ── reading a credential ─────────────────────────────────────────────────────────────────────
  await check('only a six-digit credential becomes a code', () => {
    assert.strictEqual(otp.readSmsOtpCode({ code: '123456' }), '123456')
    assert.strictEqual(otp.readSmsOtpCode({ code: ' 123 456 ' }), '123456')
    assert.strictEqual(otp.readSmsOtpCode({ code: '12345' }), '')
    assert.strictEqual(otp.readSmsOtpCode({ code: '1234567' }), '')
    assert.strictEqual(otp.readSmsOtpCode({ code: 'abcdef' }), '')
    assert.strictEqual(otp.readSmsOtpCode({ code: 123456 }), '')
    assert.strictEqual(otp.readSmsOtpCode(null), '')
  })

  // ── the feature test and every quiet fallback ────────────────────────────────────────────────
  await check('support needs a secure page, OTPCredential and credentials.get', async () => {
    assert.strictEqual(await withBrowser({ get: async () => null }, () => otp.smsOtpSupported()), true)
    assert.strictEqual(await withBrowser({ secure: false, get: async () => null }, () => otp.smsOtpSupported()), false)
    assert.strictEqual(await withBrowser({ otp: false, get: async () => null }, () => otp.smsOtpSupported()), false)
    assert.strictEqual(await withBrowser({}, () => otp.smsOtpSupported()), false)
  })

  await check('a returned credential fills the code', async () => {
    const code = await withBrowser(
      { get: async () => ({ code: '654321' }) },
      () => otp.listenForSmsOtp(),
    )
    assert.strictEqual(code, '654321')
  })

  await check('a denial, a null credential and an empty code are all just manual entry', async () => {
    assert.strictEqual(await withBrowser({ get: async () => { throw new Error('denied') } }, () => otp.listenForSmsOtp()), '')
    assert.strictEqual(await withBrowser({ get: async () => null }, () => otp.listenForSmsOtp()), '')
    assert.strictEqual(await withBrowser({ get: async () => ({ code: 'nope' }) }, () => otp.listenForSmsOtp()), '')
  })

  await check('an unsupported browser or an aborted wait never calls the API', async () => {
    let called = false
    const get = async () => { called = true; return { code: '123456' } }

    await withBrowser({ otp: false, get }, () => otp.listenForSmsOtp())
    assert.strictEqual(called, false)

    const controller = new AbortController()
    controller.abort()
    await withBrowser({ get }, () => otp.listenForSmsOtp(controller.signal))
    assert.strictEqual(called, false)
  })

  await check('the hint never promises auto-fill where the browser cannot do it', () => {
    assert.ok(otp.smsOtpHint(false, 'idle').includes('Type the code'))
    assert.ok(otp.smsOtpHint(true, 'listening').includes('fill in the code'))
    assert.ok(otp.smsOtpHint(true, 'filled').includes('filled'))
    assert.ok(otp.smsOtpHint(true, 'fallback').includes('Type the code'))
  })


  // ── the screens and the server wiring ───────────────────────────────────────────────────────
  await check('all three SMS screens listen, mark the field and can stop', () => {
    for (const file of ['src/PhoneVerifyForm.tsx', 'src/AuthModal.tsx', 'src/RecoveryModal.tsx']) {
      const source = read(file)
      assert.ok(source.includes('useSmsOtpListener'), `${file} imports the listener`)
      assert.ok(source.includes('autoComplete="one-time-code"'), `${file} marks the field for the keyboard`)
      assert.ok(source.includes('smsOtp.listen()'), `${file} starts the wait from the send tap`)
      assert.ok(source.includes('smsOtp.stop()'), `${file} can cancel the wait`)
      assert.ok(source.includes('{smsOtp.hint}'), `${file} shows the fallback sentence`)
    }
  })

  await check('the listener uses the real WebOTP shape and an abortable wait', () => {
    const source = read('src/useSmsOtp.ts')
    assert.ok(source.includes("otp: { transport: ['sms'] }"))
    assert.ok(source.includes('navigator.credentials'))
    assert.ok(source.includes('window.isSecureContext'))
    assert.ok(source.includes("'OTPCredential' in window"))
    assert.ok(source.includes('AbortController'))
    assert.ok(source.includes('signal'))
  })

  await check('the send endpoint asks for the configured host', () => {
    assert.ok(read('api/otp/send.js').includes('host: webOtpHost()'))
    assert.ok(read('.env.local.example').includes('OTP_WEB_HOST='))
    assert.ok(read('.env.local.example').includes('ESMS_API_KEY='), 'the template names the key the code reads')
  })

  console.log('')
  console.log(`  ${checks} checks passed.`)
  process.exit(0)
})().catch((err) => {
  console.error('')
  console.error('  FAILED: ' + (err && err.message ? err.message : err))
  if (err && err.code === 'ERR_ASSERTION' && err.actual !== undefined) {
    console.error('    actual:   ' + JSON.stringify(err.actual))
    console.error('    expected: ' + JSON.stringify(err.expected))
  }
  process.exit(1)
})

