/**
 * Dev-only harness for the two SMS rails (`api/_lib/sms.js`).
 *
 *   node _sms_check.cjs
 *
 * No network, no keys and no database: every request is built by a pure function, and the one
 * function that would touch the network is driven with a fake `fetchImpl`. The checks that matter
 * most are the boring ones — the right rail for the right dial code, the number in the shape each
 * provider documents, and a failure that never carries the code back.
 */
const assert = require('assert')

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

;(async () => {
  const sms = await import('./api/_lib/sms.js')

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

  // ── which rail carries which country ───────────────────────────────────────────────────────

  await check('Yoola carries the six countries it was chosen for', () => {
    for (const dial of sms.YOOLA_DIALS) {
      assert.strictEqual(sms.providerForDial(dial), 'yoola', dial)
    }
    assert.deepStrictEqual(sms.YOOLA_DIALS, ['+256', '+254', '+255', '+250', '+265', '+260'])
  })

  await check('every other dial code goes to eSMS Africa', () => {
    for (const dial of ['+257', '+211', '+243', '+234', '+233', '+27', '+212', '+20', '+1', '+44', '+91']) {
      assert.strictEqual(sms.providerForDial(dial), 'esms', dial)
    }
    // A missing dial is not a Yoola country; the caller should have refused before this point.
    assert.strictEqual(sms.providerForDial(''), 'esms')
  })

  // ── the two request shapes ────────────────────────────────────────────────────────────────

  await check('each provider gets the number in the shape it documents', () => {
    assert.strictEqual(sms.yoolaPhone('+256704487563'), '256704487563')
    assert.strictEqual(sms.esmsPhone('+256704487563'), '+256704487563')
    assert.strictEqual(sms.esmsPhone('256704487563'), '+256704487563')
    assert.strictEqual(sms.esmsPhone(''), '')
  })

  await check('the Yoola request is the documented JSON, with no plus', () => {
    const request = sms.buildYoolaRequest({ e164: '+256704487563', code: '123456', config: YOOLA })
    assert.strictEqual(request.url, sms.YOOLA_API_URL)
    assert.strictEqual(request.headers.Authorization, undefined)
    assert.deepStrictEqual(JSON.parse(request.body), {
      api_key: 'yoola-key',
      phone: '256704487563',
      message: sms.buildSmsText('123456'),
      sender_id: 'Rachett',
    })
  })

  await check('the eSMS request is Bearer + E.164 + idempotency', () => {
    const request = sms.buildEsmsRequest({
      e164: '+2348012345678',
      code: '123456',
      config: ESMS,
      idempotencyKey: 'idem-1',
    })
    assert.strictEqual(request.url, sms.ESMS_API_URL)
    assert.strictEqual(request.headers.Authorization, 'Bearer esms_live_test')
    assert.strictEqual(request.headers['Idempotency-Key'], 'idem-1')
    assert.deepStrictEqual(JSON.parse(request.body), {
      to: '+2348012345678',
      text: sms.buildSmsText('123456'),
      sender_id: 'Rachett',
    })
  })

  await check('without an approved sender ID neither request invents one', () => {
    const yoola = JSON.parse(sms.buildYoolaRequest({
      e164: '+256704487563',
      code: '123456',
      config: { ...YOOLA, senderId: '' },
    }).body)
    const esms = JSON.parse(sms.buildEsmsRequest({
      e164: '+2348012345678',
      code: '123456',
      config: { ...ESMS, senderId: '' },
      idempotencyKey: 'idem-2',
    }).body)
    assert.ok(!('sender_id' in yoola))
    assert.ok(!('sender_id' in esms))
  })

  // ── configuration is per rail, not all-or-nothing ─────────────────────────────────────────
  await check('one missing key does not switch off the other rail', () => {
    const onlyYoola = sms.smsConfig({ YOOLA_API_KEY: 'y' })
    assert.strictEqual(onlyYoola.configured, true)
    assert.strictEqual(onlyYoola.yoola.configured, true)
    assert.strictEqual(onlyYoola.esms.configured, false)
    assert.strictEqual(sms.smsForDial('+256', onlyYoola).config.configured, true)
    assert.strictEqual(sms.smsForDial('+234', onlyYoola).config.configured, false)

    const onlyEsms = sms.smsConfig({ ESMS_API_KEY: 'e' })
    assert.strictEqual(onlyEsms.configured, true)
    assert.strictEqual(sms.smsForDial('+256', onlyEsms).config.configured, false)
    assert.strictEqual(sms.smsForDial('+234', onlyEsms).config.configured, true)

    const neither = sms.smsConfig({})
    assert.strictEqual(neither.configured, false)
    assert.deepStrictEqual(neither.missing.sort(), ['ESMS_API_KEY', 'YOOLA_API_KEY'])
  })

  // ── reading the answers ───────────────────────────────────────────────────────────────────

  await check('a 2xx that says success is a success on both providers', () => {
    assert.strictEqual(sms.interpretSend(200, '{"status":"success"}').ok, true)
    assert.strictEqual(sms.interpretSend(200, '{"id":"msg_1","status":"submitted","route":"ESMS_NG"}').ok, true)
    assert.strictEqual(sms.interpretSend(200, '').ok, true)
  })

  await check('an error is read from either envelope, never as [object Object]', () => {
    const esms = sms.interpretSend(402, JSON.stringify({
      error: { code: 'insufficient_balance', message: 'Insufficient balance. Required USD 0.0192' },
      detail: { code: 'insufficient_balance' },
    }))
    assert.strictEqual(esms.ok, false)
    assert.ok(esms.message.includes('Insufficient balance'))
    assert.ok(!esms.message.includes('[object Object]'))

    const yoola = sms.interpretSend(400, JSON.stringify({ status: 'error', error: 'Bad number' }))
    assert.strictEqual(yoola.ok, false)
    assert.strictEqual(yoola.message, 'Bad number')

    const polite200 = sms.interpretSend(200, JSON.stringify({ status: 'failed', message: 'Carrier rejected' }))
    assert.strictEqual(polite200.ok, false)
    assert.strictEqual(polite200.message, 'Carrier rejected')

    const codeOnly = sms.interpretSend(200, JSON.stringify({ error: { code: 'recipient_opted_out' } }))
    assert.strictEqual(codeOnly.ok, false)
    assert.strictEqual(codeOnly.message, 'recipient_opted_out')
  })

  // ── the one function that talks to the network ───────────────────────────────────────────
  await check('a missing key refuses before a request is made', async () => {
    let called = false
    const result = await sms.sendSms({
      e164: '+2348012345678',
      dial: '+234',
      code: '123456',
      config: { yoola: YOOLA, esms: { ...ESMS, configured: false, missing: ['ESMS_API_KEY'] } },
      fetchImpl: () => { called = true; throw new Error('must not run') },
    })
    assert.strictEqual(called, false)
    assert.strictEqual(result.ok, false)
    assert.strictEqual(result.provider, 'esms')
    assert.strictEqual(result.failure, 'not-configured')
    assert.ok(result.message.includes('ESMS_API_KEY'))
  })

  await check('a Ugandan number leaves by Yoola; a Nigerian one by eSMS', async () => {
    const calls = []
    const fetchImpl = async (url, init) => {
      calls.push({ url, init })
      return { status: 200, text: async () => '{"status":"submitted"}' }
    }

    const ug = await sms.sendSms({
      e164: '+256704487563',
      dial: '+256',
      code: '123456',
      config: CONFIG,
      fetchImpl,
    })
    const ng = await sms.sendSms({
      e164: '+2348012345678',
      dial: '+234',
      code: '123456',
      config: CONFIG,
      fetchImpl,
    })

    assert.deepStrictEqual(ug, { ok: true, provider: 'yoola' })
    assert.deepStrictEqual(ng, { ok: true, provider: 'esms' })
    assert.strictEqual(calls.length, 2)

    assert.strictEqual(calls[0].url, sms.YOOLA_API_URL)
    assert.strictEqual(JSON.parse(calls[0].init.body).phone, '256704487563')
    assert.strictEqual(calls[0].init.headers.Authorization, undefined)

    assert.strictEqual(calls[1].url, sms.ESMS_API_URL)
    assert.strictEqual(calls[1].init.headers.Authorization, 'Bearer esms_live_test')
    assert.ok(calls[1].init.headers['Idempotency-Key'])
    assert.strictEqual(JSON.parse(calls[1].init.body).to, '+2348012345678')

    // The success body is not a place a code can hide.
    assert.ok(!JSON.stringify(ug).includes('123456'))
    assert.ok(!JSON.stringify(ng).includes('123456'))
  })

  await check('a provider failure is reported, and never carries the code', async () => {
    const code = '654321'
    const result = await sms.sendSms({
      e164: '+2348012345678',
      dial: '+234',
      code,
      config: CONFIG,
      fetchImpl: async () => ({
        status: 402,
        text: async () => JSON.stringify({
          error: {
            code: 'insufficient_balance',
            message: `Top up needed. Request text: ${sms.buildSmsText(code)}`,
          },
        }),
      }),
    })
    assert.strictEqual(result.ok, false)
    assert.strictEqual(result.provider, 'esms')
    assert.strictEqual(result.failure, 'provider')
    assert.ok(result.message.includes('Top up needed'))
    assert.ok(result.message.includes('[code]'), 'a quoted text is redacted')
    assert.ok(!JSON.stringify(result).includes(code), 'the code must not travel outward')
  })

  await check('a network failure and a timeout are named honestly', async () => {
    const network = await sms.sendSms({
      e164: '+2348012345678',
      dial: '+234',
      code: '123456',
      config: CONFIG,
      fetchImpl: async () => { throw new Error('offline') },
    })
    assert.strictEqual(network.failure, 'network')

    const aborted = new Error('aborted')
    aborted.name = 'AbortError'
    const timeout = await sms.sendSms({
      e164: '+2348012345678',
      dial: '+234',
      code: '123456',
      config: CONFIG,
      fetchImpl: async () => { throw aborted },
    })
    assert.strictEqual(timeout.failure, 'timeout')
  })

  // ── the verdict ────────────────────────────────────────────────────────────────────────────

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
