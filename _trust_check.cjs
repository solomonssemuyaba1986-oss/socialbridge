/**
 * Dev-only harness for the client half of the phone-proof contract (`src/trust.ts`).
 *
 *   npx tsc --ignoreConfig src/trust.ts --outDir _dsbuild --module commonjs --target es2020 --skipLibCheck
 *   Move-Item -Force _dsbuild/trust.js _dsbuild/trust.cjs
 *   node _trust_check.cjs
 *
 * `_rules_check.cjs` proves the server's half: a seller may not write `phoneVerified`, and the
 * proof lives in `trust/{uid}` — public to read, closed to write. This file proves the app keeps
 * its end of the same bargain, which is the half that broke silently:
 *
 *   1. the 🟢 badge is decided by `isPhoneProven`, and only an exact `true` in one of the two
 *      right documents counts — a truthy impostor (`'true'`, `1`, an empty object) must never
 *      draw a badge, because that looseness is what made the old one forgeable;
 *   2. the collection the client reads is the one the server writes — the failure mode with no
 *      error message: rename either side and every badge on the site goes quietly blank;
 *   3. no browser write to a seller document carries the old field at all. `firestore.rules`
 *      refuses a write that so much as *mentions* it, so one stray line took shop creation down;
 *   4. no code can reach the browser. The old dev server answered a failed send with
 *      `{ success: true, debugOtp: '123456' }` (`server/index.js:99-104`), and `RecoveryModal`
 *      still logged it on the client long after the server stopped sending it;
 *   5. the two endpoints are posted in exactly one shape, from exactly one file (`src/otpClient.ts`).
 *      `{ phone, code }` is the shape `api/otp/verify` reads; an `otp` key is a 400 every time, and
 *      it only ever shows up when a real person is waiting for a real text message;
 *   6. the wizard proves the number with *our* server — never with a third-party sign-in behind a
 *      widget — and the gate in front of Create My Shop reads that proof from `trust/{uid}`, the
 *      same record the badge reads. A widget in the middle, or a gate that trusts a stale render,
 *      puts the whole thing back in the browser's hands.
 */
const assert = require('assert')
const fs = require('fs')
const path = require('path')

let checks = 0
const check = (name, fn) => {
  try {
    fn()
  } catch (err) {
    // Say *which* check failed, on a line of its own. The name cannot ride on `err.message`: Node
    // captures an AssertionError's stack when it is built, so a message changed afterwards never
    // reaches the trace that gets printed — and `_probe_trust.ps1` matches on this line.
    console.error(`FAIL  ${name}`)
    err.message = `${name}\n    ${err.message}`
    throw err
  }
  checks++
  console.log('  ok  ' + name)
}

/** The compiled module under test — the build is the one `_phone_check.cjs` documents. */
const BUILD = path.join(__dirname, '_dsbuild', 'trust.cjs')
if (!fs.existsSync(BUILD)) {
  console.error('\n  _dsbuild/trust.cjs is missing. Build it first:\n')
  console.error('    npx tsc --ignoreConfig src/trust.ts --outDir _dsbuild --module commonjs --target es2020 --skipLibCheck')
  console.error('    Move-Item -Force _dsbuild/trust.js _dsbuild/trust.cjs\n')
  process.exit(1)
}
const { TRUST_COLLECTION, isPhoneProven } = require(BUILD)

/**
 * Source with the prose taken out.
 *
 * Every source-text assertion below reads this, so a comment that merely *explains* a forbidden
 * habit — `firestore.rules` quotes `phoneVerified: true` to say why it is refused, and this
 * harness does the same — is not mistaken for the habit itself.
 */
function codeOnly(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

/** Every `.ts`/`.tsx` file under a directory, recursively — the browser's half of the app. */
function tsFilesUnder(dir) {
  const out = []
  fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...tsFilesUnder(full))
    else if (/\.tsx?$/.test(entry.name)) out.push(full)
  })
  return out
}

/** Path as the reader sees it in the failure message. */
const rel = (file) => path.relative(__dirname, file).replace(/\\/g, '/')

/**
 * The object literal handed to a Firestore write, braces matched.
 *
 * A plain search for `phoneVerified:` cannot tell a write from a local variable — the hook has a
 * parameter of that name and a state field of that name, both legitimate. So this finds the
 * *payload* of each `setDoc`/`updateDoc`/`addDoc` call and it is that object the checks below
 * judge, exactly as `_rules_check.cjs` brace-matches a `match` block.
 */
function writePayloads(text) {
  const out = []
  const call = /(?:setDoc|updateDoc|addDoc)\s*\(/g
  let match
  while ((match = call.exec(text))) {
    const brace = text.indexOf('{', match.index + match[0].length)
    if (brace === -1) continue
    let depth = 0
    for (let i = brace; i < text.length; i++) {
      if (text[i] === '{') depth += 1
      else if (text[i] === '}') {
        depth -= 1
        if (depth === 0) {
          out.push(text.slice(brace, i + 1))
          call.lastIndex = i + 1
          break
        }
      }
    }
  }
  return out
}

const srcFiles = tsFilesUnder(path.join(__dirname, 'src'))

// ── the badge, from the only two documents that may carry the proof ──────────────────────────

check('the badge rests on the record the server writes', () => {
  assert.strictEqual(isPhoneProven({ trust: { phoneProven: true }, seller: null }), true)
  assert.strictEqual(isPhoneProven({ trust: { phoneProven: true }, seller: { phoneVerified: false } }), true)
  // The record wins outright: a shop proved after the move never needs the old field read.
  assert.strictEqual(isPhoneProven({ trust: { phoneProven: true }, seller: {} }), true)
})

check('an older shop keeps the badge it earned', () => {
  // The move cannot take a badge away from a shop that proved its number before it — and these
  // shops have no `trust` document at all, so the fallback is the *only* thing drawing their badge.
  assert.strictEqual(isPhoneProven({ trust: null, seller: { phoneVerified: true } }), true)
  assert.strictEqual(isPhoneProven({ trust: undefined, seller: { phoneVerified: true } }), true)
  assert.strictEqual(isPhoneProven({ trust: {}, seller: { phoneVerified: true } }), true)
  assert.strictEqual(isPhoneProven({ trust: { phoneProven: false }, seller: { phoneVerified: true } }), true)
})

check('a shop that proved nothing gets nothing', () => {
  assert.strictEqual(isPhoneProven({}), false)
  assert.strictEqual(isPhoneProven({ trust: null, seller: null }), false)
  assert.strictEqual(isPhoneProven({ trust: {}, seller: {} }), false)
  assert.strictEqual(isPhoneProven({ trust: { phoneProven: false }, seller: { phoneVerified: false } }), false)
})

check('a value that merely looks true is not a proof', () => {
  // This is the bug in one line. The old badge read a field whose value the seller controlled, and
  // a badge that appears for `'true'`, `1` or `{}` is a badge that appears for the wrong reason.
  const impostors = ['true', '1', 'false', 1, 0, {}, [], { value: true }]
  impostors.forEach((impostor) => {
    assert.strictEqual(
      isPhoneProven({ trust: { phoneProven: impostor }, seller: null }),
      false,
      `trust.phoneProven=${JSON.stringify(impostor)} must not draw a badge`,
    )
    assert.strictEqual(
      isPhoneProven({ trust: null, seller: { phoneVerified: impostor } }),
      false,
      `sellers.phoneVerified=${JSON.stringify(impostor)} must not draw a badge either`,
    )
  })
})

check('the collection the client reads is the one the server writes', () => {
  // The failure with no error message: rename either side and every badge on the site goes blank,
  // with nothing in the console to say why. So the two names are compared here, not assumed.
  const identity = codeOnly(fs.readFileSync(path.join(__dirname, 'api', '_lib', 'identity.js'), 'utf8'))
  const written = identity.match(/export const TRUST = '([^']+)'/)
  assert.ok(written, 'api/_lib/identity.js no longer names the collection it writes')
  assert.strictEqual(
    TRUST_COLLECTION,
    written[1],
    'the badge reads a different collection than the server writes — every badge would go blank',
  )
})

check("the badge is decided in one place, and asked for under the seller's own key", () => {
  const hook = codeOnly(fs.readFileSync(path.join(__dirname, 'src', 'useSellerStats.ts'), 'utf8'))
  // The key is the point: the server writes `trust/{uid}` and a seller document is `sellers/{uid}`
  // — the same uid, which is what lets a visitor who is not signed in read the proof at all.
  assert.ok(
    /doc\(\s*db,\s*TRUST_COLLECTION,\s*sellerId\s*\)/.test(hook),
    'useSellerStats must read trust/<sellerId>, the uid the server wrote under',
  )
  assert.ok(/isPhoneProven\(/.test(hook), 'the hook must ask src/trust.ts rather than decide for itself')
  // And the old expression must not come back — it counted values that are not proofs.
  assert.ok(
    !/phoneVerified\s*\?\?\s*false/.test(hook),
    'the badge is being decided from the raw seller field again',
  )
  assert.ok(
    /phoneVerified:\s*data\.phoneVerified\s*===\s*true/.test(hook),
    'the legacy fallback must be read strictly, so a truthy impostor cannot reach it',
  )
})

// ── the write the rules refuse, and the code that must never come back ────────────────────────

check('the shop the wizard creates carries no badge of its own', () => {
  const setup = codeOnly(fs.readFileSync(path.join(__dirname, 'src', 'SetupStore.tsx'), 'utf8'))
  const creates = writePayloads(setup).filter((payload) => /businessName/.test(payload))
  assert.strictEqual(creates.length, 1, 'the wizard must still create exactly one seller document')
  assert.ok(
    !/phoneVerified/.test(creates[0]),
    'the create payload names phoneVerified — firestore.rules refuses the whole document, so no shop can be created',
  )
})

check('the contact number the recovery flow changes is the only thing it writes', () => {
  const recovery = codeOnly(fs.readFileSync(path.join(__dirname, 'src', 'RecoveryModal.tsx'), 'utf8'))
  const updates = writePayloads(recovery).filter((payload) => /whatsapp/.test(payload))
  assert.strictEqual(updates.length, 1, 'recovery must still update the store contact number')
  assert.ok(
    !/phoneVerified/.test(updates[0]),
    'the rules check the keys a write *touches*, so this one field refuses the whole update — recovery would stop working',
  )
  // The request itself is no longer written here: both screens ask `src/otpClient.ts`, so the shape
  // exists once and the checks below are the only place that has to know what it is.
  assert.ok(
    /await verifyOtp\(getFullNewPhone\(\),\s*phoneCode\)/.test(recovery),
    'recovery must verify the number through src/otpClient.ts, the one client that posts the endpoints',
  )
})

// ── the two endpoints, and the one place that posts them ──────────────────────────────────────

check('the code is posted under the name the endpoint reads', () => {
  // `api/otp/verify` reads `field(body, 'code')`. An `otp` key is a 400 every time, and a 400 here
  // only ever shows up when a real person is waiting for a real text message — so the shape is
  // asserted where it is written down.
  const client = codeOnly(fs.readFileSync(path.join(__dirname, 'src', 'otpClient.ts'), 'utf8'))
  assert.ok(
    /\{\s*phone,\s*code\s*\}/.test(client),
    'verify must post `{ phone, code }` — `otp` is the same request with a 400 stuck on the end of it',
  )
  assert.ok(/\{\s*phone\s*\}/.test(client), 'send must be asked with the number alone')

  const recovery = codeOnly(fs.readFileSync(path.join(__dirname, 'src', 'RecoveryModal.tsx'), 'utf8'))
  assert.ok(/await sendOtp\(getFullNewPhone\(\)\)/.test(recovery), 'recovery must send through src/otpClient.ts')
  assert.ok(
    !/api\/otp/.test(recovery),
    'recovery must not name the endpoints itself — that is the shape living in two places',
  )
})

check('the phone API has one door, and only src/otpClient.ts knocks on it', () => {
  // Two screens posting the same two endpoints in their own shapes is exactly how the code ends up
  // under `otp` in one of them, where no test can tell which. So the endpoints are named in one
  // file, and this says which file that is.
  const callers = srcFiles.filter((file) => /\/api\/otp\//.test(codeOnly(fs.readFileSync(file, 'utf8'))))
  assert.deepStrictEqual(callers.map(rel), ['src/otpClient.ts'])
})

check('the wizard proves the number with our server, not with a third-party sign-in', () => {
  // What used to be here: the wizard handed the number to Firebase (`signInWithPhoneNumber`) behind a
  // reCAPTCHA widget, and the proof of the number lived in the browser's own session — which is why
  // the badge could be had without an SMS ever being sent. The code now comes from our server *and*
  // is checked by our server, and our server is the only thing that records the proof.
  const setup = codeOnly(fs.readFileSync(path.join(__dirname, 'src', 'SetupStore.tsx'), 'utf8'))
  assert.ok(
    !/signInWithPhoneNumber|linkWithPhoneNumber|PhoneAuthProvider/.test(setup),
    'the wizard must not sign the number in with a third party — a code that never left the server is the proof',
  )
  assert.ok(
    !/RecaptchaVerifier|recaptcha-container|setup-recaptcha/.test(setup),
    'a reCAPTCHA widget has no place in this flow: /api/otp/send is the send',
  )
  assert.ok(/await sendOtp\(/.test(setup), 'the wizard must ask our server for the code')
  assert.ok(/await verifyOtp\(/.test(setup), 'the wizard must have our server check the code')
  // A phone sign-up *becomes* the account the server minted the token for — the browser never
  // decides this about itself.
  assert.ok(
    /await signInWithCustomToken\(auth,\s*verified\.token\)/.test(setup),
    'the phone path must sign in with the token the server minted',
  )
})

check('the gate in front of Create My Shop reads the proof the server wrote', () => {
  const setup = codeOnly(fs.readFileSync(path.join(__dirname, 'src', 'SetupStore.tsx'), 'utf8'))
  // `trust/{uid}` — the one collection the server writes the proof into, and the one the badge
  // reads. A shop cannot be created on a number the server has not proved.
  assert.ok(
    /getDoc\(doc\(db,\s*TRUST_COLLECTION,\s*uid\)\)/.test(setup),
    'the wizard must read the proof from trust/{uid}, under the uid the server wrote it for',
  )
  assert.ok(/await readPhoneProof\(/.test(setup), 'the gate must ask the server-written record, not a local flag')
  // One decision, not two: the proof the phone step shows and the proof the gate demands are the same
  // expression, so "verified" on screen can never be refused by the button below it.
  assert.ok(
    /const liveProven = [\s\S]{0,200}phoneIsProven/.test(setup),
    'the gate must consult the same derived proof the phone step shows',
  )
})

check('no browser write anywhere in src/ carries the old field', () => {
  assert.ok(srcFiles.length >= 40, `expected the app's source tree, found ${srcFiles.length} files`)
  srcFiles.forEach((file) => {
    writePayloads(codeOnly(fs.readFileSync(file, 'utf8'))).forEach((payload) => {
      assert.ok(
        !/phoneVerified/.test(payload),
        `${rel(file)} writes phoneVerified — the proof is the server's to record, in trust/{uid}`,
      )
    })
  })
})

check('no code can reach the browser', () => {
  // The other half of the same story: the old dev server answered a failed send with
  // `{ success: true, debugOtp: '123456' }`, and the client kept logging that key long after the
  // server stopped sending it. `_otp_check.cjs` guards `api/`; this guards the files that ship.
  srcFiles.forEach((file) => {
    assert.ok(
      !/debugOtp/.test(codeOnly(fs.readFileSync(file, 'utf8'))),
      `${rel(file)} mentions debugOtp — a code must never be handed to the browser`,
    )
  })
})

console.log(`\n${checks} trust checks passed`)

