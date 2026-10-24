/**
 * Dev-only harness for account strength, the nine-day reminder and contact discovery.
 *
 *   npx tsc src/africa.ts src/accountStrength.ts --ignoreConfig --outDir _dsbuild --module commonjs --target es2020 --skipLibCheck
 *   node _account_strength_check.cjs
 *
 * The important claims:
 *  - an account with a phone + an email is "strong", one key is "phone only" / "email only";
 *  - only email-only accounts in phone-first territory are reminded;
 *  - the first reminder is nine days after the account was made, then every nine days;
 *  - contact numbers are normalised, deduplicated and turned into the *same* one-way keys the
 *    phone ledger uses — never stored or returned;
 *  - the API requires a signed-in account with a proved phone, and rate-limits lookups.
 */
const assert = require('assert')
const fs = require('fs')
const path = require('path')

let checks = 0
const check = (name, fn) => { fn(); checks++; console.log('  ok  ' + name) }
const src = file => fs.readFileSync(path.join(__dirname, 'src', file), 'utf8')
const server = file => fs.readFileSync(path.join(__dirname, 'api', file), 'utf8')

const DAY = 24 * 60 * 60 * 1000
const CREATED = Date.UTC(2026, 9, 1, 12, 0, 0)
const NOW = CREATED + 12 * DAY

function compiled(name) {
  const file = path.join(__dirname, '_dsbuild', `${name}.js`)
  assert.ok(fs.existsSync(file), `missing ${path.basename(file)} — run the compile command in this file's header`)
  return require(file)
}

;(async () => {
  const africa = compiled('africa')
  const account = compiled('accountStrength')
  const contacts = await import('./api/_lib/contacts.js')

  check('the phone-first map covers Africa, not the whole world', () => {
    assert.strictEqual(africa.isAfricanPhone('+256771234567'), true)
    assert.strictEqual(africa.isAfricanPhone('+254712345678'), true)
    assert.strictEqual(africa.isAfricanPhone('+2348012345678'), true)
    assert.strictEqual(africa.isAfricanPhone('+447700900123'), false)
    assert.strictEqual(africa.isAfricanPhone('+14155550123'), false)
    assert.strictEqual(africa.africanDialCodeFor('+256771234567'), '+256')
  })

  check('without a number, the device zone and locale decide', () => {
    assert.strictEqual(africa.isAfricanTimeZone('Africa/Kampala'), true)
    assert.strictEqual(africa.isAfricanTimeZone('Europe/London'), false)
    assert.strictEqual(africa.isAfricanLocale('en-UG'), true)
    assert.strictEqual(africa.isAfricanLocale('en_US'), false)
    assert.strictEqual(africa.localeRegion('zh-Hant-TW'), 'TW')
    assert.strictEqual(africa.isAfricanAccount({ timeZone: 'Africa/Nairobi', language: 'en-KE' }), true)
    assert.strictEqual(africa.isAfricanAccount({ timeZone: 'America/Toronto', language: 'en-CA' }), false)
  })

  check('one method is a state, two methods are strong, guests are guests', () => {
    const guest = account.accountStrength({ anonymous: true })
    assert.strictEqual(guest.guest, true)
    assert.strictEqual(guest.strong, false)
    assert.deepStrictEqual(guest.methods, [])

    const googleOnly = account.accountStrength({
      email: 'a@example.com', providers: ['google.com'], timeZone: 'Africa/Kampala',
    })
    assert.strictEqual(googleOnly.hasEmail, true)
    assert.strictEqual(googleOnly.hasPhone, false)
    assert.deepStrictEqual(googleOnly.missing, ['phone'])
    assert.strictEqual(googleOnly.african, true)

    const phoneOnly = account.accountStrength({
      phoneNumber: '+256771234567', providers: ['phone'], timeZone: 'Africa/Kampala',
    })
    assert.strictEqual(phoneOnly.hasPhone, true)
    assert.strictEqual(phoneOnly.hasEmail, false)
    assert.deepStrictEqual(phoneOnly.missing, ['email'])

    const strong = account.accountStrength({
      phoneNumber: '+256771234567', email: 'a@example.com', providers: ['phone', 'google.com'],
    })
    assert.strictEqual(strong.strong, true)
    assert.deepStrictEqual(strong.methods, ['phone', 'email'])
    assert.strictEqual(account.strengthLabel(strong), 'Strong account')
    assert.strictEqual(account.methodsLabel(strong), 'phone|email')
  })

  check('the server-written phone proof counts before Auth refreshes', () => {
    const justLinked = account.accountStrength({
      email: 'a@example.com', providers: ['google.com'], phoneProven: true,
    })
    assert.strictEqual(justLinked.hasPhone, true, 'trust/{uid} is the server’s word and must be enough')
  })

  check('the reminder is nine days after creation, then nine days after the last one', () => {
    const dueAt = account.nextPhoneNudgeAt({ createdAtMs: CREATED })
    assert.strictEqual(dueAt, CREATED + 9 * DAY)
    assert.strictEqual(account.nextPhoneNudgeAt({ createdAtMs: CREATED, lastNudgeAt: NOW }), NOW + 9 * DAY)
    assert.strictEqual(account.nextPhoneNudgeAt({ createdAtMs: 0 }), 0, 'no creation time means no invented nag')
  })

  check('only email-only accounts in phone-first territory are reminded, on schedule', () => {
    const facts = { email: 'a@example.com', providers: ['google.com'], createdAtMs: CREATED, timeZone: 'Africa/Kampala' }
    const strength = account.accountStrength(facts)
    assert.strictEqual(account.phoneNudgeDue({ strength, facts, now: CREATED + 8 * DAY }), false)
    assert.strictEqual(account.phoneNudgeDue({ strength, facts, now: CREATED + 9 * DAY }), true)
    assert.strictEqual(account.phoneNudgeDue({ strength, facts, now: NOW, lastNudgeAt: NOW - DAY }), false)
    assert.strictEqual(account.phoneNudgeDue({ strength, facts, now: NOW, lastNudgeAt: NOW - 9 * DAY }), true)

    const outside = { email: 'a@example.com', providers: ['google.com'], createdAtMs: CREATED, timeZone: 'Europe/London' }
    assert.strictEqual(account.phoneNudgeDue({ strength: account.accountStrength(outside), facts: outside, now: NOW }), false)

    const hasPhone = { ...facts, phoneNumber: '+256771234567' }
    assert.strictEqual(account.phoneNudgeDue({ strength: account.accountStrength(hasPhone), facts: hasPhone, now: NOW }), false)
  })

  check('contact discovery is only offered once, and only after a phone is proved', () => {
    const strong = account.accountStrength({ phoneNumber: '+256771234567', email: 'a@example.com' })
    assert.strictEqual(account.shouldOfferContacts({ strength: strong }), true)
    assert.strictEqual(account.shouldOfferContacts({ strength: strong, contactsAskedAt: 1 }), false)
    assert.strictEqual(account.shouldOfferContacts({ strength: strong, contactsConsentAt: 1 }), false)
    const googleOnly = account.accountStrength({ email: 'a@example.com', providers: ['google.com'] })
    assert.strictEqual(account.shouldOfferContacts({ strength: googleOnly }), false)
  })

  check('contact numbers are normalised, deduplicated and never read back', () => {
    assert.strictEqual(contacts.normaliseContact('+256 771 234 567'), '+256771234567')
    assert.strictEqual(contacts.normaliseContact('0771234567', '+256'), '+256771234567')
    assert.strictEqual(contacts.normaliseContact('00256771234567'), '+256771234567')
    assert.strictEqual(contacts.normaliseContact('+447700900123', '+256'), '+447700900123')
    assert.strictEqual(contacts.normaliseContact('not a number', '+256'), '')
    assert.strictEqual(contacts.normaliseContact('', '+256'), '')

    const keys = contacts.contactKeys(
      ['+256771234567', '+256 771 234 567', '0771234567', 'rubbish'],
      '+256',
      'pepper',
    )
    assert.strictEqual(keys.checked, 1, 'three spellings of one number are one contact')
    assert.strictEqual(keys.keys.length, 1)
    assert.ok(/^[0-9a-f]{32}$/.test(keys.keys[0]), 'the ledger key is an opaque HMAC')
    assert.ok(!keys.keys[0].includes('256771'), 'the key cannot contain the number')
    assert.ok(!JSON.stringify(keys).includes('+256771234567'), 'no plain number is in the lookup')
  })

  check('one lookup at a time, three an hour, three a day', () => {
    const limits = contacts.CONTACT_LIMITS
    const first = contacts.decideContactLookup(null, NOW, limits)
    assert.strictEqual(first.allow, true)

    const tooSoon = contacts.decideContactLookup({ ...first.next, lastAt: NOW }, NOW + 5_000, limits)
    assert.strictEqual(tooSoon.allow, false)
    assert.strictEqual(tooSoon.reason, 'cooldown')

    const third = { lastAt: NOW - limits.cooldownMs, hourStart: NOW, hourCount: 3, dayStart: NOW, dayCount: 3 }
    assert.strictEqual(contacts.decideContactLookup(third, NOW, limits).reason, 'hourly')

    const daily = { lastAt: NOW - limits.cooldownMs, hourStart: NOW, hourCount: 0, dayStart: NOW, dayCount: 3 }
    assert.strictEqual(contacts.decideContactLookup(daily, NOW, limits).reason, 'daily')
    assert.strictEqual(contacts.decideContactLookup(daily, NOW + limits.dayMs + 1, limits).allow, true, 'the day resets')
  })

  check('a match returns a name and a shop link, never a number or email', () => {
    const profile = contacts.publicContactProfile(
      'uid-1',
      { displayName: 'Aisha N.', email: 'aisha@example.com', phoneNumber: '+256771234567' },
      { businessName: 'Aisha Fabrics', slug: 'aisha-fabrics', whatsapp: '+256771234567' },
    )
    assert.deepStrictEqual(profile, {
      uid: 'uid-1', name: 'Aisha N.', businessName: 'Aisha Fabrics', slug: 'aisha-fabrics',
    })
    assert.ok(!JSON.stringify(profile).includes('+256'))
    assert.ok(!JSON.stringify(profile).includes('@'))

    const numberNotName = contacts.publicContactProfile('uid-2', { displayName: '+256771234567' }, null)
    assert.strictEqual(numberNotName.name, 'On rachett')
    const noShop = contacts.publicContactProfile('uid-3', { displayName: 'Brian' }, null)
    assert.strictEqual(noShop.slug, '')
  })


  check('the contact endpoint is authenticated, phone-gated, capped and HMAC-keyed', () => {
    const match = server('contacts/match.js')
    assert.ok(/uidFromIdToken\(bearerToken\(req\)\)/.test(match), 'an ID token is required')
    assert.ok(/caller\.phoneNumber/.test(match), 'only a proved phone may look up contacts')
    // A helper that is called but not imported is a 500 on the one request that matters. The file
    // is plain JS, so neither `tsc -b` nor the Vite build would notice; this does.
    const adminImport = match.match(/import \{([^}]+)\} from '\.\.\/_lib\/admin\.js'/)
    assert.ok(adminImport, 'the endpoint must import its admin helpers')
    const adminCalls = new Set([...match.matchAll(/\b(admin[A-Z]\w*)\s*\(/g)].map(entry => entry[1]))
    for (const helper of adminCalls) {
      assert.ok(adminImport[1].includes(helper), `${helper} is called but not imported`)
    }
    assert.ok(/MAX_CONTACTS/.test(match), 'the batch has a ceiling')
    assert.ok(/contactKeys\(body\.phones/.test(match), 'numbers must go through the shared normaliser')
    assert.ok(/reserveContactLookup/.test(match), 'the per-account rate limit must be called')
    assert.ok(/publicContactProfile/.test(match), 'only the allowlisted profile shape may leave')
    assert.ok(!/console\.(log|error|warn|info|debug)\s*\([^)]*body\.phones/.test(match), 'never log the contacts')
    assert.ok(!/recordContactConsent\([^)]*phones/.test(match), 'contacts must not be written to the account')

    const lib = server('_lib/contacts.js')
    assert.ok(/phoneKey\(e164, pepper\)/.test(lib), 'the lookup must use the same HMAC as the phone ledger')
    assert.ok(/MAX_MATCHES/.test(lib), 'there is a ceiling on results')
    assert.ok(!/collection\(|localStorage/.test(lib), 'the pure contact logic stores nothing')
  })

  check('the new collections are closed to the browser', () => {
    const rules = fs.readFileSync(path.join(__dirname, 'firestore.rules'), 'utf8')
    assert.ok(/match \/contactLookups\/\{userId\} \{ allow read, write: if false; \}/.test(rules))
    assert.ok(/match \/trust\/\{userId\}[\s\S]{0,400}allow write: if false;/.test(rules))
  })

  check('the browser never uploads contacts on its own', () => {
    const client = src('contactsClient.ts')
    assert.ok(/contacts\?: ContactsManager/.test(client), 'the browser contact picker is the only source')
    assert.ok(/manager\.select\(\['tel'\], \{ multiple: true \}\)/.test(client), 'the person must open the picker')
    assert.ok(/Authorization: `Bearer \$\{idToken\}`/.test(client))
    assert.ok(!/localStorage|sessionStorage/.test(client), 'contacts never touch device storage')
    const finder = src('ContactFinder.tsx')
    assert.ok(/Your contacts are never stored/.test(finder))
    assert.ok(/pickContactPhones\(\)/.test(finder), 'only a tap starts the picker')
  })

  check('the news page, profile card, buyer/seller nav and prompt are wired', () => {
    const app = src('App.tsx')
    assert.ok(/<Route path="\/news" element=\{<NewsPage \/>\}/.test(app))
    assert.ok(/<ContactPrompt \/>/.test(app))
    const profile = src('ProfilePage.tsx')
    assert.ok(/<AccountNewsCard \/>/.test(profile))
    const nav = src('sellerNav.ts')
    assert.ok(/label: 'News & Updates', path: '\/news'/.test(nav), 'a seller is an account holder too')
    const top = src('TopNav.tsx')
    assert.ok(/navigate\('\/news'\)/.test(top))
    const news = src('NewsPage.tsx')
    assert.ok(/PhoneVerifyForm/.test(news) && /Add Google email/.test(news))
    assert.ok(/nine-day reminder/i.test(news))
    assert.ok(/strength\.african/.test(news), 'outside phone-first markets no reminder is claimed')
  })

  check('sign-in keeps our OTP server and drops the browser SMS widget', () => {
    for (const file of ['SignIn.tsx', 'AuthModal.tsx']) {
      const text = src(file)
      assert.ok(/await sendOtp\(/.test(text), `${file} must ask our server for the code`)
      assert.ok(/await verifyOtp\(/.test(text), `${file} must have our server check the code`)
      assert.ok(/signInWithCustomToken\(auth, verified\.token\)/.test(text), `${file} must sign in with the server token`)
      assert.ok(!/signInWithPhoneNumber|RecaptchaVerifier|recaptcha-container/.test(text), `${file} must not use browser SMS`)
    }
    const firebase = src('firebase.ts')
    assert.ok(!/RecaptchaVerifier/.test(firebase))
  })

  check('the new events are in the taxonomy and the docs, with no person in the props', () => {
    const taxonomy = src('analytics/taxonomy.ts')
    assert.ok(/account_strength_viewed: \['methods', 'hasPhone', 'hasEmail', 'african', 'nudgeDue'\]/.test(taxonomy))
    assert.ok(/contacts_lookup_finished: \['surface', 'checked', 'matched', 'consent'\]/.test(taxonomy))
    assert.ok(!/account_strength_viewed[^\n]*(phone|email)[^\n]*:/.test(taxonomy), 'no raw number/email property')
    const analytics = fs.readFileSync(path.join(__dirname, 'ANALYTICS.md'), 'utf8')
    assert.ok(/account_strength_viewed/.test(analytics) && /contacts_lookup_finished/.test(analytics))
    const data = fs.readFileSync(path.join(__dirname, 'DATA_COLLECTION.md'), 'utf8')
    assert.ok(/contactsConsentAt/.test(data) && /contactLookups/.test(data))
  })

  console.log(`\n${checks} account-strength checks passed — two keys where possible, nine-day reminders only where they belong.`)
})().catch(err => {
  console.error(err.message || err)
  process.exit(1)
})

