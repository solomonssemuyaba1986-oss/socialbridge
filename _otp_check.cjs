/**
 * Dev-only harness for the phone-verification server (`api/_lib/otp.js`, `api/_lib/phone.js`).
 *
 *   node _otp_check.cjs
 *
 * No build step is needed: both modules under test are plain ESM and import nothing but
 * `node:crypto`. Every decision that matters — expiry, the minute, the hour, the day, the attempt
 * count, the single use — is a pure function of a record and a timestamp, which is exactly why they
 * can be proved here with no network, no database, and no waiting five minutes.
 *
 * The last checks guard the bug being fixed: one reads every file under `api/` and fails if
 * `debugOtp` — or any other route by which a code could travel back to the caller — appears in
 * one. The old server returned `{ success: true, debugOtp: '123456' }` whenever its SMS key was
 * missing (`server/index.js:99-104`). That must never come back.
 *
 * One check needs a build: that the server's per-country phone rules still agree with the app's.
 * Compile `src/phone.ts` the way `_phone_check.cjs` documents and this harness compares the two;
 * without it the check says so rather than passing quietly.
 */
const assert = require('assert')
const fs = require('fs')
const path = require('path')

let checks = 0
let skipped = 0
const check = (name, fn) => {
  try {
    fn()
  } catch (err) {
    // Say *which* check failed. A harness that only prints a stack trace makes you go looking.
    err.message = `${name}\n    ${err.message}`
    throw err
  }
  checks++
  console.log('  ok  ' + name)
}
const skip = (name, why) => { skipped++; console.log('  ..  ' + name + ' — SKIPPED: ' + why) }

/** A clock we control, so "five minutes later" costs nothing. */
const NOW = Date.UTC(2026, 2, 1, 12, 0, 0)

const OTP_SRC = fs.readFileSync(path.join(__dirname, 'api', '_lib', 'otp.js'), 'utf8')

/**
 * Source with the prose taken out.
 *
 * A comment that *names* a forbidden habit — `otp.js` says in so many words that the code is
 * generated "never with `Math.random`" — must not be mistaken for the habit itself. Every
 * source-text assertion below reads this, so what is judged is the code.
 */
function codeOnly(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

/** Every `.js` file under a directory, recursively. */
function jsFilesUnder(dir) {
  const out = []
  fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...jsFilesUnder(full))
    else if (entry.name.endsWith('.js')) out.push(full)
  })
  return out
}

;(async () => {
  const otp = await import('./api/_lib/otp.js')
  const phone = await import('./api/_lib/phone.js')

  const PEPPER = 'pepper-for-the-harness'
  const SALT = 'a'.repeat(32)

  // ── the code itself ────────────────────────────────────────────────────────────────────────

  check('a code is six digits, and a leading zero survives', () => {
    assert.strictEqual(otp.generateCode(() => 5), '000005')
    assert.strictEqual(otp.generateCode(() => 999999), '999999')
    assert.strictEqual(otp.generateCode(() => 0), '000000')
    for (let i = 0; i < 500; i++) assert.ok(/^\d{6}$/.test(otp.generateCode()), 'six digits')
  })

  check('the code comes from the CSPRNG, never Math.random', () => {
    // A guessable code is the same as no code at all, so this is asserted on the source: the one
    // function that makes a secret must not be the one function that cannot keep one.
    const source = codeOnly(OTP_SRC)
    assert.ok(/crypto\.randomInt/.test(source), 'generateCode uses crypto.randomInt')
    assert.ok(!/Math\.random/.test(source), 'nothing in the OTP core may use Math.random')
  })

  check('only the hash is ever written down', () => {
    const hash = otp.hashCode('123456', SALT, PEPPER)
    assert.notStrictEqual(hash, '123456')
    assert.ok(/^[0-9a-f]{64}$/.test(hash), 'an HMAC-SHA256 digest')
    // Same inputs, same answer — or a code could never be checked.
    assert.strictEqual(otp.hashCode('123456', SALT, PEPPER), hash)
    // A different salt or pepper makes every stored hash useless, which is what rotation buys.
    assert.notStrictEqual(otp.hashCode('123456', 'b'.repeat(32), PEPPER), hash)
    assert.notStrictEqual(otp.hashCode('123456', SALT, 'another-pepper'), hash)
    // And the record a send writes holds no plaintext anywhere in it.
    const record = otp.stampCode(otp.emptyRecord(NOW), { codeHash: hash, codeSalt: SALT, now: NOW })
    assert.ok(!JSON.stringify(record).includes('123456'), 'the plaintext code is not in the record')
  })

  check('without a pepper it refuses rather than storing a code in the open', () => {
    assert.throws(() => otp.hashCode('123456', SALT, ''), /OTP_PEPPER/)
    assert.throws(() => otp.phoneKey('+256771234567', ''), /OTP_PEPPER/)
  })

  check('the compare is strict: right, wrong, empty and rubbish all answer honestly', () => {
    const hash = otp.hashCode('123456', SALT, PEPPER)
    assert.strictEqual(otp.codeMatches('123456', hash, SALT, PEPPER), true)
    assert.strictEqual(otp.codeMatches('123457', hash, SALT, PEPPER), false)
    assert.strictEqual(otp.codeMatches('', hash, SALT, PEPPER), false)
    // A short or missing stored hash must be a false, never a throw — a timing-safe compare of two
    // different-length buffers would otherwise crash the endpoint.
    assert.strictEqual(otp.codeMatches('123456', '', SALT, PEPPER), false)
    assert.strictEqual(otp.codeMatches('123456', undefined, SALT, PEPPER), false)
  })

  check('what a person typed is read generously, and what we accept is read strictly', () => {
    assert.strictEqual(otp.readCode('123 456'), '123456')
    assert.strictEqual(otp.readCode('123-456'), '123456')
    assert.strictEqual(otp.readCode(' 123456 '), '123456')
    assert.strictEqual(otp.readCode('1234567890'), '123456')
    assert.strictEqual(otp.isCodeFormat('123456'), true)
    assert.strictEqual(otp.isCodeFormat('12345'), false)   // too short
    assert.strictEqual(otp.isCodeFormat('1234567'), false) // too long
    assert.strictEqual(otp.isCodeFormat('12345a'), false)
    assert.strictEqual(otp.isCodeFormat(123456), false)    // a number is not a string of digits
    assert.strictEqual(otp.isCodeFormat(''), false)
  })

  check('the document key is opaque, stable, and holds no phone number', () => {
    const key = otp.phoneKey('+256771234567', PEPPER)
    assert.ok(/^[0-9a-f]{32}$/.test(key), key)
    assert.strictEqual(otp.phoneKey('+256771234567', PEPPER), key, 'same number, same key')
    assert.notStrictEqual(otp.phoneKey('+256771234568', PEPPER), key, 'a different number is elsewhere')
    assert.ok(!key.includes('256771234567'), 'the key must not contain the number')
    // A leaked dump of `otpCodes` is a list of these strings and nothing else.
    assert.notStrictEqual(otp.phoneKey('+256771234567', 'other-pepper'), key, 'the pepper keys it')
  })

  check('"a code was just sent" is measured in seconds, never zero or negative', () => {
    assert.strictEqual(otp.secondsUntil(NOW + 60_000, NOW), 60)
    assert.strictEqual(otp.secondsUntil(NOW + 1, NOW), 1, 'never 0 — the screen has to say something')
    assert.strictEqual(otp.secondsUntil(NOW - 5000, NOW), 1, 'nor negative once it has passed')
  })

  // ── the minute, the hour, the day ──────────────────────────────────────────────────────────

  check('a first send is allowed, and its counters are already paid', () => {
    const first = otp.decideSend(null, NOW)
    assert.strictEqual(first.allow, true)
    // `next` is the record to commit, and it has *already* counted this send — so a caller that
    // writes `next` cannot forget to charge for it.
    assert.strictEqual(first.next.hourCount, 1)
    assert.strictEqual(first.next.dayCount, 1)
    assert.strictEqual(first.next.hourStart, NOW)
    assert.strictEqual(first.retryAfterSec, 0)
    // Nothing was sent yet, so the minute rail stays open until a code is actually stamped.
    assert.strictEqual(first.next.sentAt, 0)
  })

  check('a double-tap sends one SMS, not two — and says how long to wait', () => {
    const sent = otp.stampCode(otp.decideSend(null, NOW).next, { codeHash: 'h', codeSalt: SALT, now: NOW })
    const again = otp.decideSend(sent, NOW + 30_000)
    assert.strictEqual(again.allow, false)
    assert.strictEqual(again.reason, 'cooldown')
    assert.strictEqual(again.retryAfterSec, 30, 'the screen gets a real number of seconds')
    // The refused attempt must not have moved the counters.
    assert.strictEqual(again.next.hourCount, 1)

    assert.strictEqual(otp.decideSend(sent, NOW + 59_999).allow, false)
    assert.strictEqual(otp.decideSend(sent, NOW + 60_000).allow, true, 'exactly a minute later is fine')
  })

  check('three in an hour and the fourth is refused until the window rolls', () => {
    let record = null
    for (const at of [NOW, NOW + 61_000, NOW + 122_000]) {
      const decision = otp.decideSend(record, at)
      assert.strictEqual(decision.allow, true, 'sends 1..3 are allowed')
      record = otp.stampCode(decision.next, { codeHash: 'h', codeSalt: SALT, now: at })
    }
    const fourth = otp.decideSend(record, NOW + 183_000)
    assert.strictEqual(fourth.allow, false)
    assert.strictEqual(fourth.reason, 'hourly')
    assert.ok(fourth.retryAfterSec > 0 && fourth.retryAfterSec <= 3600, 'an hour at most')
    // A whole hour after the window opened, the allowance is back.
    const nextHour = otp.decideSend(record, NOW + 3_600_000)
    assert.strictEqual(nextHour.allow, true)
    assert.strictEqual(nextHour.next.hourCount, 1, 'the hour window reset')
    assert.strictEqual(nextHour.next.dayCount, 4, 'but the day did not')
  })

  check('the day is the ceiling under the hour, and it rolls on its own clock', () => {
    const limits = { cooldownMs: 0, maxPerHour: 100, maxPerDay: 10 }
    let record = null
    for (let i = 0; i < 10; i++) {
      const decision = otp.decideSend(record, NOW + i * 1000, limits)
      assert.strictEqual(decision.allow, true, `send ${i + 1} of the day's ten`)
      record = otp.stampCode(decision.next, { codeHash: 'h', codeSalt: SALT, now: NOW + i * 1000 })
    }
    const eleventh = otp.decideSend(record, NOW + 20_000, limits)
    assert.strictEqual(eleventh.allow, false)
    assert.strictEqual(eleventh.reason, 'daily')
    assert.ok(eleventh.retryAfterSec > 0 && eleventh.retryAfterSec <= 86_400)
    // Tomorrow.
    const tomorrow = otp.decideSend(record, NOW + 86_400_000, limits)
    assert.strictEqual(tomorrow.allow, true)
    assert.strictEqual(tomorrow.next.dayCount, 1)
  })

  check('the rails are asked in the order a person meets them', () => {
    // A record that is both inside the minute AND out of hourly allowance must report the minute:
    // "give it a moment" is the useful answer, "you have had three this hour" is not.
    const both = { codeHash: 'h', codeSalt: SALT, sentAt: NOW - 10_000, expiresAt: NOW + 290_000,
                   hourStart: NOW - 60_000, hourCount: 3, dayStart: NOW - 60_000, dayCount: 3 }
    const decision = otp.decideSend(both, NOW)
    assert.strictEqual(decision.reason, 'cooldown')
  })

  check('a half-written or missing record is a first send, never a crash', () => {
    assert.strictEqual(otp.decideSend(undefined, NOW).allow, true)
    assert.strictEqual(otp.decideSend({}, NOW).allow, true)
    // Numbers that arrived as strings (a hand-edited document, an old schema) must not smuggle a
    // NaN into the counter and turn every comparison into a lie.
    const odd = otp.decideSend({ hourCount: '3', dayCount: 'three', hourStart: null }, NOW)
    assert.strictEqual(odd.allow, true)
    assert.strictEqual(odd.next.hourCount, 1)
    assert.strictEqual(odd.next.dayCount, 1)
  })

  check('a stamped code carries its expiry, and stamping resets the tries', () => {
    const stale = { ...otp.emptyRecord(NOW), attempts: 4, codeHash: 'old', codeSalt: 'old' }
    const fresh = otp.stampCode(stale, { codeHash: 'new', codeSalt: SALT, now: NOW })
    assert.strictEqual(fresh.expiresAt, NOW + 300_000, 'five minutes, to the millisecond')
    assert.strictEqual(fresh.sentAt, NOW)
    assert.strictEqual(fresh.attempts, 0, 'a new code gets five fresh tries')
    assert.strictEqual(fresh.codeHash, 'new')
    // The counters survive the restamp — they belong to the number, not to the code.
    assert.strictEqual(fresh.hourCount, stale.hourCount)
  })

  // ── the code, answered ─────────────────────────────────────────────────────────────────────

  /** A record for `code`, live right now — the state a successful send leaves behind. */
  const liveRecord = (code, now = NOW) => otp.stampCode(
    otp.emptyRecord(now),
    { codeHash: otp.hashCode(code, SALT, PEPPER), codeSalt: SALT, now },
  )

  check('a code nobody asked for is "none" — not a crash, and not a match', () => {
    assert.strictEqual(otp.decideVerify(null, '123456', { now: NOW, pepper: PEPPER }).reason, 'none')
    assert.strictEqual(otp.decideVerify(undefined, '123456', { now: NOW, pepper: PEPPER }).reason, 'none')
    // A booking handed back after a failed SMS leaves an empty hash. That is also "none": there is
    // no code to match, so nothing can be guessed.
    const released = { ...otp.emptyRecord(NOW), codeHash: '', codeSalt: '' }
    const decision = otp.decideVerify(released, '123456', { now: NOW, pepper: PEPPER })
    assert.strictEqual(decision.reason, 'none')
    assert.strictEqual(decision.burn, false)
  })

  check('the right code verifies — and is burned on the way out', () => {
    const decision = otp.decideVerify(liveRecord('123456'), '123456', { now: NOW, pepper: PEPPER })
    assert.strictEqual(decision.ok, true)
    assert.strictEqual(decision.reason, 'match')
    assert.strictEqual(decision.burn, true, 'a matched code is single-use, so it is deleted')
  })

  check('the wrong code is refused, counted, and left alive to try again', () => {
    const decision = otp.decideVerify(liveRecord('123456'), '999999', { now: NOW, pepper: PEPPER })
    assert.strictEqual(decision.ok, false)
    assert.strictEqual(decision.reason, 'mismatch')
    assert.strictEqual(decision.attempts, 1, 'the try is counted before the answer is given')
    assert.strictEqual(decision.burn, false, 'a mistyped digit must not cost the whole code')
  })

  check('the fifth wrong guess kills the code', () => {
    const record = liveRecord('123456')
    const seen = [0, 1, 2, 3, 4].map((spent) => otp.decideVerify(
      { ...record, attempts: spent }, '999999', { now: NOW, pepper: PEPPER },
    ))
    assert.deepStrictEqual(
      seen.map((d) => d.reason),
      ['mismatch', 'mismatch', 'mismatch', 'mismatch', 'attempts'],
      'four tries to get it right, then the code is gone',
    )
    assert.deepStrictEqual(seen.map((d) => d.burn), [false, false, false, false, true])
  })

  check('a code dies at five minutes, to the millisecond', () => {
    const record = liveRecord('123456')
    assert.strictEqual(otp.decideVerify(record, '123456', { now: NOW + 300_000, pepper: PEPPER }).ok, true)
    const late = otp.decideVerify(record, '123456', { now: NOW + 300_001, pepper: PEPPER })
    assert.strictEqual(late.ok, false)
    assert.strictEqual(late.reason, 'expired', 'the right code is still refused once it is late')
    assert.strictEqual(late.burn, true, 'an expired code is cleared out, never left to linger')
  })

  check('a code can be guessed at, but never used twice', () => {
    // Burn-on-match is what makes replay impossible, and it is decided *here* rather than by the
    // caller — the store merely carries out `burn`.
    assert.strictEqual(otp.decideVerify(liveRecord('123456'), '123456', { now: NOW, pepper: PEPPER }).ok, true)
    // Once burned the record is gone, which is exactly what `consume` does with it.
    assert.strictEqual(otp.decideVerify(null, '123456', { now: NOW, pepper: PEPPER }).reason, 'none')
  })

  check('every refusal has words, and none of them narrow the search', () => {
    const verifyReasons = Object.keys(otp.VERIFY_MESSAGES)
    assert.deepStrictEqual(verifyReasons.slice().sort(), ['attempts', 'expired', 'mismatch', 'none'])
    verifyReasons.forEach((reason) => {
      const words = otp.VERIFY_MESSAGES[reason]
      assert.ok(words && words.length > 20, `${reason} says something a person can act on`)
      assert.ok(!/\d/.test(words), `${reason} must not hint at any digit`)
    })
    assert.deepStrictEqual(
      Object.keys(otp.SEND_MESSAGES).slice().sort(),
      ['cooldown', 'daily', 'global', 'hourly'],
    )
    Object.keys(otp.SEND_MESSAGES).forEach((reason) => {
      assert.ok(otp.SEND_MESSAGES[reason].length > 20, `${reason} says something a person can act on`)
    })
  })

  // ── the bug being fixed, nailed shut ───────────────────────────────────────────────────────

  const apiFiles = jsFilesUnder(path.join(__dirname, 'api'))

  check('every file under api/ is accounted for, and none of them can hand a code outward', () => {
    assert.ok(apiFiles.length >= 8, `expected the api tree, found ${apiFiles.length} files`)
    apiFiles.forEach((file) => {
      const rel = path.relative(__dirname, file).replace(/\\/g, '/')
      const text = codeOnly(fs.readFileSync(file, 'utf8'))
      // The old server answered a *failed* send with `{ success: true, debugOtp: '123456' }`
      // (server/index.js:99-104) — it printed the code instead of sending it. One match, anywhere,
      // fails this check.
      assert.ok(!/debugOtp/.test(text), `${rel} mentions debugOtp — a code must never travel outward`)
      // Anything the browser can read is public: a secret must never be named VITE_*, because Vite
      // inlines those straight into the bundle.
      assert.ok(!/VITE_/.test(text), `${rel} names a VITE_ secret — those are inlined into the bundle`)
    })
  })

  check('the send reply says "sent" — and never the code that was sent', () => {
    const sendSrc = codeOnly(fs.readFileSync(path.join(__dirname, 'api', 'otp', 'send.js'), 'utf8'))
    assert.ok(
      sendSrc.includes('ok(res, { sent: true, expiresInSec:'),
      'the only success body is { sent: true, expiresInSec }',
    )
    assert.ok(!/console\.log\s*\(/.test(sendSrc), 'the happy path logs nothing, so nothing can echo')
    assert.ok(!/\bcode:/.test(sendSrc), 'the code is never put into an object that could be serialised')
    assert.ok(sendSrc.includes('sent.failure'), 'the handler reads the failure slug, not a code')
  })

  check('the verify reply is a token and the proven number — never the digits typed', () => {
    const verifySrc = codeOnly(fs.readFileSync(path.join(__dirname, 'api', 'otp', 'verify.js'), 'utf8'))
    assert.ok(
      verifySrc.includes('ok(res, { token, uid: claim.uid, phone: check.e164, created: claim.created })'),
      'the only success body is the custom token, the uid and the number that answered',
    )
    assert.ok(!/console\.log\s*\(/.test(verifySrc), 'the happy path logs nothing, so nothing can echo')
    assert.ok(!/\bcode:/.test(verifySrc), 'the code is never put into an object that could be serialised')
  })

  check('the SMS module keeps quiet — it is the one place the code must appear', () => {
    const smsSrc = codeOnly(fs.readFileSync(path.join(__dirname, 'api', '_lib', 'sms.js'), 'utf8'))
    assert.ok(
      !/console\.(log|error|warn|info|debug)\s*\(/.test(smsSrc),
      'api/_lib/sms.js must never log: what it holds is the code',
    )
    // `failure`, never `code`: in this file `code` must only ever mean the verification code, so a
    // reader never has to stop and work out which kind of code a line means.
    assert.ok(smsSrc.includes("failure: 'not-configured'"), 'a refused send still reports a slug')
    assert.ok(smsSrc.includes("failure: timedOut ? 'timeout' : 'network'"))
  })

  // ── the same rules on both sides of the wire ───────────────────────────────────────────────

  const clientBuild = path.join(__dirname, '_dsbuild', 'phone.cjs')
  if (!fs.existsSync(clientBuild)) {
    skip(
      "the server's phone rules are still the app's phone rules",
      'build src/phone.ts first — see the tsc step in _phone_check.cjs',
    )
  } else {
    const clientPhone = require(clientBuild)

    check("the server's phone rules are still the app's phone rules", () => {
      assert.deepStrictEqual(phone.FALLBACK_LENGTHS, clientPhone.FALLBACK_LENGTHS)

      // Same countries, read from both sources so a country added on one side alone shows up here.
      const dialCodesIn = (text) => [...new Set(
        [...text.matchAll(/'(\+\d{1,3})'\s*:/g)].map((match) => match[1]),
      )].sort()
      assert.deepStrictEqual(
        Object.keys(phone.PHONE_RULES).sort(),
        dialCodesIn(fs.readFileSync(path.join(__dirname, 'src', 'phone.ts'), 'utf8')),
        'src/phone.ts and api/_lib/phone.js must list exactly the same countries',
      )

      // The same countries is not the same rule. Every length either side has an opinion about has
      // to get the same verdict from both, or the screen accepts what the server then refuses —
      // a dead button nobody can explain.
      Object.keys(phone.PHONE_RULES).forEach((dial) => {
        for (let len = 1; len <= 16; len++) {
          const typed = '7'.repeat(len)
          const mine = phone.validatePhone(dial, typed, 'Someplace')
          const theirs = clientPhone.validatePhone(dial, typed, 'Someplace')
          assert.strictEqual(mine.ok, theirs.ok, `${dial} with ${len} digits: both must agree`)
          assert.strictEqual(mine.digits, theirs.digits, `${dial} with ${len} digits: same digits out`)
          assert.strictEqual(mine.exact, theirs.exact, `${dial} with ${len} digits: same rule used`)
          assert.strictEqual(mine.message, theirs.message, `${dial} with ${len} digits: same words`)
        }
        // The habits that matter, on a nine-digit country: the trunk zero, and a pasted +code.
        assert.strictEqual(
          phone.normaliseNational('0771234567', dial),
          clientPhone.normaliseNational('0771234567', dial),
          `${dial}: the trunk zero goes the same way`,
        )
        assert.strictEqual(
          phone.normaliseNational(dial.replace('+', '') + '771234567', dial),
          clientPhone.normaliseNational(dial.replace('+', '') + '771234567', dial),
          `${dial}: a pasted country code is read the same way`,
        )
        assert.strictEqual(
          phone.formatFull(dial, phone.normaliseNational('0771234567', dial)),
          clientPhone.formatFull(dial, clientPhone.normaliseNational('0771234567', dial)),
          `${dial}: the number we store is the same number`,
        )
      })

      // A country neither of them knows falls back the same way.
      assert.strictEqual(
        phone.validatePhone('+999', '777777777', 'Nowhere').ok,
        clientPhone.validatePhone('+999', '777777777', 'Nowhere').ok,
      )
    })
  }

  // ── the verdict ────────────────────────────────────────────────────────────────────────────

  console.log('')
  console.log(`  ${checks} checks passed${skipped ? `, ${skipped} skipped` : ''}.`)
  if (skipped) console.log('  A skipped check is not a passing one — build the file to close it.')
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
