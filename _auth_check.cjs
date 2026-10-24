/**
 * Dev-only harness for the sign-in surface: **Google + phone only**.
 *
 *   node _auth_check.cjs
 *
 * Why this exists: Facebook and Apple were shown on six different screens but neither API is
 * configured in this project, so every tap was a dead end. The check is static on purpose — it
 * pins the product decision (no provider we cannot support) and the one-number-one-account rule
 * that the phone path depends on.
 */
const assert = require('assert')
const fs = require('fs')
const path = require('path')

let checks = 0
const check = (name, fn) => { fn(); checks++; console.log('  ok  ' + name) }
const src = file => fs.readFileSync(path.join(__dirname, 'src', file), 'utf8')
const server = file => fs.readFileSync(path.join(__dirname, 'api', file), 'utf8')

check('no Facebook or Apple provider is even constructed', () => {
  const firebase = src('firebase.ts')
  assert.ok(!/FacebookAuthProvider|OAuthProvider|facebookProvider|appleProvider/.test(firebase))
  assert.ok(/GoogleAuthProvider/.test(firebase))
})

check('no screen offers Facebook or Apple sign-in', () => {
  const files = ['SignIn.tsx', 'AuthModal.tsx', 'TopNav.tsx', 'ContinueAs.tsx', 'SetupStore.tsx', 'StorePage.tsx', 'SignInPrompt.tsx', 'ProfilePage.tsx', 'RecoveryModal.tsx']
  for (const file of files) {
    const text = src(file)
    assert.ok(!/Continue with (Facebook|Apple)/.test(text), `${file} still shows a removed provider button`)
    assert.ok(!/Google \/ Apple \/ Facebook/.test(text), `${file} still names a removed provider`)
    assert.ok(!/FacebookAuthProvider|OAuthProvider\('apple\.com'\)|facebookProvider|appleProvider/.test(text), `${file} still imports a removed provider`)
    assert.ok(!/\bfrom ['"]firebase\/auth['"][^\n]*\b(Apple|Facebook)\b/.test(text), `${file} still imports a removed auth type`)
  }
})

check('Google and phone are both still reachable', () => {
  const signIn = src('SignIn.tsx')
  assert.ok(/Continue with Google/.test(signIn))
  assert.ok(/Sign in with phone number/.test(signIn))
  // The phone path asks *our* server for the code and verifies it there, so the same proof feeds
  // the 🟢 badge and the sign-in. It must not fall back to Firebase's browser SMS.
  assert.ok(/await sendOtp\(/.test(signIn), 'the sign-in phone path must ask our server for the code')
  assert.ok(/await verifyOtp\(/.test(signIn), 'the sign-in phone path must have our server check the code')
  assert.ok(/await signInWithCustomToken\(auth,\s*verified\.token\)/.test(signIn), 'the server-minted token must become the session')
  assert.ok(!/signInWithPhoneNumber|RecaptchaVerifier|recaptcha-container/.test(signIn), 'no browser-side SMS widget belongs in the phone path')
  // A shop can hand over to the same phone flow and come back to the shop.
  assert.ok(/Continue with phone number/.test(src('TopNav.tsx')), 'the login modal must offer phone directly')
  const store = src('StorePage.tsx')
  assert.ok(/Continue with phone number/.test(store))
  assert.ok(/navigate\('\/signin', \{ state: \{ returnTo: `\/store\/\$\{slugParam\}` \} \}\)/.test(store))
  assert.ok(!/Phone sign-up coming soon/.test(store))
})

check('a remembered Facebook/Apple account cannot open the wrong popup', () => {
  const continueAs = src('ContinueAs.tsx')
  assert.ok(/pid === 'facebook\.com' \|\| pid === 'apple\.com'/.test(continueAs))
  assert.ok(/return null/.test(continueAs))
  // And the one-tap banner is Google-only, never offered to a remembered phone account.
  const signIn = src('SignIn.tsx')
  assert.ok(/savedUserIsGoogle/.test(signIn))
  assert.ok(/savedUser\.providerId === 'google\.com'/.test(signIn))
})

check('one number, one account — said in the UI and enforced by the server', () => {
  const signIn = src('SignIn.tsx')
  assert.ok(/One number, one rachett account/.test(signIn))
  const identity = server('_lib/identity.js')
  assert.ok(/getUserByPhoneNumber/.test(identity), 'the server must find an existing phone account')
  assert.ok(/phone-number-already-exists/.test(identity), 'the server must refuse a number owned by another account')
  assert.ok(/PHONES/.test(identity) && /holder && holder !== uid/.test(identity), 'the phone ledger must be a second guard')
  const verify = server('otp/verify.js')
  assert.ok(/claimNumber/.test(verify), 'phone sign-in must go through the one claim path')
  assert.ok(/already belongs to a rachett account/.test(verify), 'the refusal must explain itself')
})

console.log(`\n${checks} checks passed — sign-in: Google + phone only, no dead provider buttons, and one number to one account.`)
