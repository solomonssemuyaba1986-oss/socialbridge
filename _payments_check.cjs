/**
 * Dev-only harness for the payment layer — everything provable without a key.
 *
 *   node _payments_check.cjs
 *
 * Two processors now share one set of promises, and every one of these rules is easy to get subtly
 * wrong: rounding a currency that has no minor unit, telling a buyer their payment failed while it is
 * still moving, believing a callback body, or un-paying an order because a late failure arrived.
 * None of that needs pawaPay or Pesapal to test — it is all decidable from strings, and this file
 * decides it.
 */
const assert = require('assert')
const path = require('path')

const money = require(path.join(__dirname, 'functions', 'money.js'))
const rules = require(path.join(__dirname, 'functions', 'pawapayRules.js'))
const sigs = require(path.join(__dirname, 'functions', 'pawapaySignatures.js'))
const pawapay = require(path.join(__dirname, 'functions', 'pawapay.js'))
const decider = require(path.join(__dirname, 'functions', 'paymentRules.js'))
const pesapal = require(path.join(__dirname, 'functions', 'pesapal.js'))

let checks = 0
const laterChecks = []
const check = (name, fn) => { fn(); checks++; console.log('  ok  ' + name) }
const acheck = (name, fn) => laterChecks.push({ name, fn })

check('an amount never grows a tail', () => {
  assert.strictEqual(money.toAmountString(45000, 'UGX'), '45000')
  assert.strictEqual(money.toAmountString('45000', 'UGX'), '45000')
  assert.strictEqual(money.toAmountString(45000.4, 'UGX'), '45000')
  assert.strictEqual(money.toAmountString(10.5, 'USD'), '10.5')
  assert.strictEqual(money.toAmountString(10.555, 'USD'), '10.56')
  assert.strictEqual(money.toAmountString(0, 'UGX'), null)
  assert.strictEqual(money.toAmountString(-5, 'UGX'), null)
  assert.strictEqual(money.toAmountString('free', 'UGX'), null)
  assert.strictEqual(money.isZeroDecimalCurrency('ugx'), true)
  assert.strictEqual(money.isZeroDecimalCurrency('USD'), false)
})

check('the two amount rules agree, so a shilling cannot vanish between them', () => {
  const cases = [
    [45000, 'UGX'], [1000, 'TZS'], [500.5, 'KES'], [99.994, 'USD'],
    [1, 'RWF'], [2000, 'XOF'], [123456789, 'UGX'], [0.004, 'USD'],
  ]
  for (const [amount, currency] of cases) {
    assert.strictEqual(money.toAmount(amount, currency), pesapal.toPesapalAmount(amount, currency),
      `${amount} ${currency} disagreed between money.js and pesapal.js`)
  }
})

check('a status is never invented, and never final when it is not', () => {
  assert.deepStrictEqual(rules.mapDepositStatus('COMPLETED'), { status: 'completed', final: true, label: 'Paid' })
  assert.strictEqual(rules.mapDepositStatus('FAILED').status, 'failed')
  assert.strictEqual(rules.mapDepositStatus('REJECTED').status, 'failed')
  assert.strictEqual(rules.mapDepositStatus('ACCEPTED').status, 'initiated')
  assert.strictEqual(rules.mapDepositStatus('ACCEPTED').final, false)
  assert.strictEqual(rules.mapDepositStatus('SUBMITTED').status, 'initiated')
  // Not a status at all: pawaPay saying "I have seen this depositId before". Nothing may change.
  assert.strictEqual(rules.mapDepositStatus('DUPLICATE_IGNORED'), null)
  // Their own words for UNKNOWN_ERROR: "check the status of this payment over API before considering
  // failed" — so it is never final, and never 'failed'.
  assert.strictEqual(rules.mapDepositStatus('UNKNOWN_ERROR').status, 'unknown')
  assert.strictEqual(rules.mapDepositStatus('UNKNOWN_ERROR').final, false)

  for (const raw of ['COMPLETED', 'FAILED', 'ACCEPTED', 'SUBMITTED', 'REJECTED', 'UNKNOWN_ERROR', '', 'WHAT']) {
    const reading = rules.mapDepositStatus(raw)
    if (!reading) continue
    assert.ok(rules.OUR_STATUSES.includes(reading.status), `${raw} → ${reading.status}`)
    assert.ok(reading.label.length > 0)
    assert.strictEqual(reading.label.includes('_'), false, reading.label)
  }
})

check('every failure is said in words, never as a code', () => {
  for (const code of Object.keys(rules.FAILURE_WORDS)) {
    const words = rules.FAILURE_WORDS[code]
    assert.ok(words.length > 10, code)
    assert.strictEqual(words.includes('_'), false, words)
    assert.strictEqual(words.includes(code), false, words)
  }
  assert.strictEqual(
    rules.depositFailureWords({ failureReason: { failureCode: 'PAYER_NOT_FOUND' } }),
    'That phone number is not registered with this network.')
  assert.strictEqual(rules.failureCodeFrom({ failureReason: { failureCode: 'X' } }), 'X')
  assert.strictEqual(rules.failureCodeFrom(null), '')
  const unknown = rules.depositFailureWords({ failureReason: { failureCode: 'SOMETHING_NEW' } })
  assert.ok(unknown.length > 0)
  assert.strictEqual(unknown.includes('SOMETHING_NEW'), false)
})

check('a phone number is only a number when it is the whole number', () => {
  assert.strictEqual(rules.sanitiseMsisdn('+256 771 234 567'), '256771234567')
  assert.strictEqual(rules.sanitiseMsisdn('0771 234 567'), '771234567')
  assert.strictEqual(rules.sanitiseMsisdn('+260 763-456789'), '260763456789')
  assert.strictEqual(rules.isMsisdn('256771234567'), true)
  assert.strictEqual(rules.isMsisdn('0771234567'), false)
  assert.strictEqual(rules.isMsisdn('123'), false)
  assert.strictEqual(rules.isMsisdn('+256771234567'), false)
  assert.strictEqual(rules.isMsisdn(''), false)
})

check('a deposit id is ours, and a collision could not be silent', () => {
  assert.strictEqual(rules.isDepositId(rules.buildDepositId()), true)
  assert.strictEqual(rules.isDepositId('abc'), false)
  assert.strictEqual(rules.isDepositId('RT-4K2M9-7QWZ'), true)
  assert.strictEqual(rules.isDepositId('has spaces here'), false)
  assert.strictEqual(rules.isDepositId('a'.repeat(65)), false)
  assert.notStrictEqual(rules.buildDepositId(), rules.buildDepositId())
  assert.strictEqual(rules.isProviderCode('MTN_MOMO_UGA'), true)
  assert.strictEqual(rules.isProviderCode('AIRTEL_OAPI_UGA'), true)
  assert.strictEqual(rules.isProviderCode('mtn momo'), false)
})

check('sandbox is the default, and a typo can never mean live', () => {
  assert.strictEqual(pawapay.isLive('live'), true)
  assert.strictEqual(pawapay.isLive('LIVE'), true)
  assert.strictEqual(pawapay.isLive(' sandbox '), false)
  assert.strictEqual(pawapay.isLive('production'), false)
  assert.strictEqual(pawapay.isLive('Livee'), false)
  assert.strictEqual(pawapay.isLive(undefined), false)
  assert.strictEqual(pawapay.isLive(null), false)
  assert.strictEqual(pawapay.baseUrl('live'), pawapay.LIVE_BASE)
  assert.strictEqual(pawapay.baseUrl('sandbox'), pawapay.SANDBOX_BASE)
  assert.strictEqual(pawapay.baseUrl(undefined), pawapay.SANDBOX_BASE)
  assert.strictEqual(pawapay.isConfigured({ apiToken: '' }), false)
  assert.strictEqual(pawapay.isConfigured(null), false)
})

check('the three decisions both processors must make identically', () => {
  const paid = { providerStatus: 'completed', paid: true, amountMatches: true, orderStatus: 'pending', paymentStatus: 'initiated' }
  assert.deepStrictEqual(decider.decideOutcome(paid), {
    resolved: 'completed', note: '', alreadyPaid: false, mismatch: false, applied: true, nextOrderStatus: 'paid',
  })

  // A completed payment for the wrong amount is ours to flag, not theirs to hide.
  const wrongAmount = decider.decideOutcome({ ...paid, amountMatches: false })
  assert.strictEqual(wrongAmount.resolved, 'review')
  assert.strictEqual(wrongAmount.applied, false)
  assert.strictEqual(wrongAmount.mismatch, true)

  // Applying the same status twice changes nothing.
  assert.strictEqual(decider.decideOutcome({ ...paid, orderStatus: 'paid' }).applied, false)
  assert.strictEqual(decider.decideOutcome({ ...paid, paymentStatus: 'completed' }).applied, false)

  // A late FAILED never un-pays an order, and money arriving late never undoes a seller's work.
  const lateFailure = decider.decideOutcome({ ...paid, providerStatus: 'failed', paid: false, orderStatus: 'paid' })
  assert.strictEqual(lateFailure.resolved, 'completed')
  assert.strictEqual(lateFailure.note.includes('already paid'), true)
  const delivered = decider.decideOutcome({ ...paid, orderStatus: 'fulfilled' })
  assert.strictEqual(delivered.applied, true)
  assert.strictEqual(delivered.nextOrderStatus, null)

  // Still moving: nothing is applied, and nothing is claimed.
  const moving = decider.decideOutcome({ providerStatus: 'initiated', paid: false, amountMatches: null, orderStatus: 'pending', paymentStatus: 'initiated' })
  assert.strictEqual(moving.resolved, 'initiated')
  assert.strictEqual(moving.applied, false)
})

check('an amount is compared, not assumed', () => {
  assert.strictEqual(decider.amountAgrees({ amount: 1000, currency: 'UGX' }, 1000, 'UGX'), true)
  assert.strictEqual(decider.amountAgrees({ amount: 1000, currency: 'UGX' }, '1000', 'UGX'), true)
  assert.strictEqual(decider.amountAgrees({ amount: 1000, currency: 'UGX' }, 500, 'UGX'), false)
  assert.strictEqual(decider.amountAgrees({ amount: 1000, currency: 'UGX' }, 1000, 'KES'), false)
  assert.strictEqual(decider.amountAgrees({ amount: 1000 }, 0, 'UGX'), null)
  assert.strictEqual(decider.amountAgrees({ amount: 1000 }, 'what', 'UGX'), null)
  assert.strictEqual(decider.amountAgrees({}, 1000, 'UGX'), null)
})

check('a signed callback verifies — and a tampered one does not', () => {
  const crypto = require('crypto')
  const write = (msg) => console.log('        ' + msg)

  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const pem = publicKey.export({ type: 'spki', format: 'pem' })
  const body = JSON.stringify({
    depositId: 'd6df5c10-bd43-408c-b622-f10f9eaa568b',
    status: 'COMPLETED',
    amount: '1000',
    currency: 'UGX',
    country: 'UGA',
    payer: { type: 'MMO', accountDetails: { provider: 'MTN_MOMO_UGA', phoneNumber: '256783456789' } },
  })
  const digest = `sha-256=:${crypto.createHash('sha256').update(body, 'utf8').digest('base64')}:`
  const headers = {
    'content-type': 'application/json; charset=UTF-8',
    'content-digest': digest,
    'signature-date': '2026-09-26T20:00:00Z',
  }
  const signatureInput = 'sig-pp=("@method" "@authority" "@path" "signature-date" "content-digest" "content-type");alg="ecdsa-p256-sha256";keyid="TEST_KEY";created=1;expires=2'
  const authority = 'us-central1-socialbridge-93ee1.cloudfunctions.net'
  const context = { headers, method: 'POST', authority, path: '/pawapayCallback' }

  // The base has to be exactly what pawaPay signs: one line per component, then the params line.
  const base = sigs.signatureBase(sigs.parseSignatureInput(signatureInput), context)
  assert.strictEqual(base.split('\n').length, 7)
  assert.ok(base.includes('"@method": POST'), base)
  assert.ok(base.includes(`"@authority": ${authority}`), base)
  assert.ok(base.includes('"@path": /pawapayCallback'), base)
  assert.ok(base.endsWith(`"@signature-params": ${signatureInput}`), base)

  const signature = crypto.sign('sha256', Buffer.from(base, 'utf8'), privateKey).toString('base64')
  const signed = { ...headers, 'signature-input': signatureInput, signature: `sig-pp=:${signature}:` }
  const keys = [{ id: 'TEST_KEY', key: pem }]

  const ok = sigs.verifyCallbackSignature({ ...context, headers: signed, rawBody: body, publicKeys: keys })
  assert.strictEqual(ok.ok, true, `a genuine callback must verify (${ok.reason})`)
  assert.strictEqual(ok.keyId, 'TEST_KEY')

  // One digit changed in the body: the digest no longer matches, so we refuse before even looking.
  const tamperedBody = sigs.verifyCallbackSignature({
    ...context, headers: signed, rawBody: body.replace('1000', '1'), publicKeys: keys,
  })
  assert.strictEqual(tamperedBody.ok, false)
  assert.strictEqual(tamperedBody.reason, 'bad-digest')

  // Somebody else's key, with everything else correct.
  const other = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const otherPem = other.publicKey.export({ type: 'spki', format: 'pem' })
  const wrongKey = sigs.verifyCallbackSignature({
    ...context, headers: signed, rawBody: body, publicKeys: [{ id: 'TEST_KEY', key: otherPem }],
  })
  assert.strictEqual(wrongKey.ok, false)

  // No signature at all, and no key to check with: both refused, for their own reason.
  assert.strictEqual(sigs.verifyCallbackSignature({ ...context, rawBody: body }).reason, 'unsigned')
  assert.strictEqual(
    sigs.verifyCallbackSignature({ ...context, headers: signed, rawBody: body, publicKeys: [] }).reason,
    'no-public-key')

  // A digest that is not shaped like a digest is not a digest.
  assert.strictEqual(sigs.digestMatches('nonsense', body), false)
  assert.strictEqual(sigs.digestMatches(digest, body), true)
  assert.strictEqual(sigs.digestMatches(digest, `${body} `), false)
  write('a P-256 callback round-trips; a tampered body, a wrong key and an unsigned call are all refused')
})

check('the callback never believes a body, and never writes a status from one', () => {
  const fs = require('fs')
  const source = fs.readFileSync(path.join(__dirname, 'functions', 'index.js'), 'utf8')
  assert.ok(source.includes('exports.pawapayCallback'), 'the callback must exist')
  assert.ok(source.includes('exports.pawapayStartDeposit'), 'the deposit callable must exist')
  assert.ok(source.includes('exports.pawapayPaymentStatus'), 'the status callable must exist')
  assert.ok(source.includes('verifyCallbackSignature'), 'the callback must verify signatures')
  assert.ok(source.includes('verifyPawaPayDeposit'), 'and the status must come from our own check')
  // The body may name a deposit, but the status must come from pawaPay's answer.
  const callbackBlock = source.slice(source.indexOf('exports.pawapayCallback'), source.indexOf('exports.pawapayPaymentStatus'))
  assert.strictEqual(callbackBlock.includes('callback.rawStatus'), false, 'a callback status must never be trusted')
  assert.strictEqual(callbackBlock.includes("status: callback."), false, 'nor written from the body')
  assert.ok(callbackBlock.includes('status(200)'), 'pawaPay needs a plain 200 to stop retrying')
})

check('the config summary survives every shape pawaPay might send', () => {
  const cfg = require(path.join(__dirname, 'functions', 'pawapayConfig.js'))

  // The shape their docs show: arrays all the way down.
  const documented = {
    companyName: 'Merchant Inc.',
    signatureConfiguration: { signedRequestsOnly: false, signedCallbacks: true },
    countries: [{
      country: 'UGA',
      displayName: { en: 'Uganda' },
      prefix: '256',
      providers: [{
        provider: 'MTN_MOMO_UGA',
        status: 'OPERATIONAL',
        currencies: [{
          currency: 'UGX',
          operationTypes: [{
            DEPOSIT: {
              minAmount: 500, maxAmount: 5000000, authType: 'PROVIDER_AUTH',
              decimalsInAmount: 'NONE', callbackUrl: 'https://x.test/pawapayCallback',
            },
          }],
        }],
      }],
    }],
  }
  const one = cfg.summariseConfig(documented)
  assert.ok(one.includes('Merchant Inc.'), one)
  assert.ok(one.includes('Uganda'), one)
  assert.ok(one.includes('MTN_MOMO_UGA'), one)
  assert.ok(one.includes('UGX'), one)
  assert.ok(one.includes('DEPOSIT'), one)
  assert.ok(one.includes('500-5000000'), one)
  assert.ok(one.includes('callback:https://x.test/pawapayCallback'), one)

  // The shape that crashed it: objects keyed by code, at every level. This is the whole point of
  // the file — `for...of` over an object is `object is not iterable`, and it took down --config.
  const mapped = {
    companyName: 'Merchant Inc.',
    signatureConfiguration: { signedCallbacks: true },
    countries: {
      UGA: {
        displayName: { en: 'Uganda' },
        prefix: '256',
        providers: {
          MTN_MOMO_UGA: {
            status: 'OPERATIONAL',
            currencies: { UGX: { operationTypes: { DEPOSIT: { minAmount: 500, maxAmount: 5000000 } } } },
          },
        },
      },
    },
  }
  const two = cfg.summariseConfig(mapped)
  assert.ok(two.includes('UGA'), two)
  assert.ok(two.includes('MTN_MOMO_UGA'), two) // the key carried the name
  assert.ok(two.includes('UGX'), two) // and so did the currency key
  assert.ok(two.includes('DEPOSIT'), two)

  // Rubbish must not throw, and must not pretend it found something.
  for (const junk of [null, undefined, {}, 'nonsense', 42, { countries: 'nope' }, { countries: [] }, { countries: [null] }]) {
    const out = cfg.summariseConfig(junk)
    assert.strictEqual(typeof out, 'string')
    assert.ok(out.includes('company:'), out)
  }

  // And the guard the CLI leans on: a summary that cannot be built reports why instead of dying.
  assert.strictEqual(cfg.safeSummary(null).error, '')
  const broken = cfg.safeSummary({
    get countries() { throw new Error('boom') },
  })
  assert.strictEqual(broken.text, '')
  assert.ok(broken.error.length > 0)
})

check('the CLI no longer keeps a second, stricter copy of that summary', () => {
  const fs = require('fs')
  const cli = fs.readFileSync(path.join(__dirname, 'functions', 'pawapay-check.js'), 'utf8')
  assert.strictEqual(cli.includes('function summariseConfig'), false, 'the buggy local copy must be gone')
  assert.ok(cli.includes("require('./pawapayConfig')"), 'and the safe one must be used')
  assert.ok(cli.includes('safeSummary'), 'so a surprise shape cannot take --config down')
})

;(async () => {
  for (const { name, fn } of laterChecks) {
    await fn()
    checks++
    console.log('  ok  ' + name)
  }
  console.log('\n' + checks + ' payment checks passed')
})().catch((err) => {
  console.error('\n  FAILED: ' + ((err && err.message) || err))
  process.exitCode = 1
})


