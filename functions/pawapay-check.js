/**
 * Talk to pawaPay from the command line — the mobile money rail, without the app.
 *
 *   cd functions
 *   $env:PAWAPAY_API_TOKEN='...'      # PowerShell; or put it in functions/.env (gitignored)
 *   $env:PAWAPAY_ENV='sandbox'        # the default IS sandbox; 'live' is a deliberate word
 *
 *   node pawapay-check.js --config                  # what our account can do: providers, limits, callback URL
 *   node pawapay-check.js --config --country=UGA    # one market only
 *   node pawapay-check.js --config --raw            # the untouched payload, if a summariser ever lies
 *   node pawapay-check.js --sandbox-numbers         # the sandbox numbers and what each one does
 *   node pawapay-check.js --predict --phone=256783456789
 *   node pawapay-check.js --deposit --phone=256783456789 --amount=1000
 *   node pawapay-check.js --status=<depositId>
 *   node pawapay-check.js --resend=<depositId>
 *   node pawapay-check.js --wallets
 *   node pawapay-check.js --keys                    # the keys our callback verifies signatures with
 *
 * What it is for: proving the rail before the app is wired to it, and proving *why* something failed
 * when it does. It prints which environment it is talking to on every run, so a sandbox test can
 * never be mistaken for a live one — and it never prints the token.
 */
const pawapay = require('./pawapay')
const rules = require('./pawapayRules')
const { toAmountString } = require('./money')
const { safeSummary } = require('./pawapayConfig')

const args = process.argv.slice(2)

function flag(name, fallback = '') {
  const hit = args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return fallback
  return hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : 'true'
}

const wanted = (name) => args.some((a) => a === `--${name}` || a.startsWith(`--${name}=`))

const credentials = {
  apiToken: process.env.PAWAPAY_API_TOKEN || '',
  env: process.env.PAWAPAY_ENV || 'sandbox',
}

/** The Uganda sandbox numbers, so a test is aimed rather than guessed. */
const UG_SANDBOX = [
  ['256783456789', 'MTN', 'COMPLETED — the happy path'],
  ['256783456129', 'MTN', 'stays SUBMITTED — the "waiting for you" state'],
  ['256783456019', 'MTN', 'FAILED — PAYER_LIMIT_REACHED'],
  ['256783456029', 'MTN', 'FAILED — PAYER_NOT_FOUND'],
  ['256783456069', 'MTN', 'FAILED — UNSPECIFIED_FAILURE'],
  ['256753456789', 'Airtel', 'COMPLETED — the second rail'],
]

function line(label, value) {
  console.log(`${String(label).padEnd(20)} ${value}`)
}

/* The summary itself lives in `pawapayConfig.js` now: it reads arrays *and* maps, keeps a key as a
   name when the value has none, and reports a surprise instead of throwing. `--config` calls it
   through `safeSummary`, so an unexpected shape prints the raw payload rather than a stack trace. */

function printSandboxNumbers() {
  console.log('Uganda sandbox numbers (sandbox only — no real wallets, no PIN prompt):\n')
  for (const [number, network, what] of UG_SANDBOX) {
    console.log(`  ${number}  ${network.padEnd(7)} ${what}`)
  }
  console.log('\nUsage: node pawapay-check.js --deposit --phone=256783456789 --amount=1000')
}

async function withEnv(work) {
  if (!pawapay.isConfigured(credentials)) {
    console.error('Missing PAWAPAY_API_TOKEN.')
    console.error("Set it first (PowerShell: $env:PAWAPAY_API_TOKEN='...'), or use --env-file=.env.")
    process.exitCode = 1
    return
  }
  const environment = pawapay.isLive(credentials.env) ? 'LIVE' : 'sandbox'
  console.log(`pawaPay: ${environment} — ${pawapay.baseUrl(credentials.env)}`)
  if (pawapay.isLive(credentials.env)) {
    console.log('⚠️  This is LIVE: a deposit here asks a real wallet for real money.\n')
  }
  await work()
}

async function main() {
  await withEnv(async () => {
    if (wanted('sandbox-numbers')) return printSandboxNumbers()

    if (wanted('keys')) {
      const keys = await pawapay.getPublicKeys(credentials)
      for (const key of keys || []) line(rules.text(key.id), `${String(key.key).split('\n')[0]} …`)
      return
    }

    if (wanted('wallets')) {
      console.log(JSON.stringify(await pawapay.walletBalances(credentials), null, 2))
      return
    }

    if (wanted('config')) {
      const payload = await pawapay.activeConfiguration({ ...credentials, country: flag('country', '') })
      if (wanted('raw')) {
        console.log(JSON.stringify(payload, null, 2))
        return
      }
      const summary = safeSummary(payload)
      if (summary.error) {
        // A diagnostic must never die on an unexpected shape: say what happened, then show the truth.
        console.log(`(could not summarise that response: ${summary.error})`)
        console.log('Here is the raw payload instead — that is what the summary was trying to read:\n')
        console.log(JSON.stringify(payload, null, 2))
        return
      }
      console.log(summary.text)
      return
    }

    const status = flag('status', '')
    if (status) {
      const result = await pawapay.checkDepositStatus({ ...credentials, depositId: status })
      console.log(JSON.stringify(result.raw, null, 2))
      line('our reading', JSON.stringify(result.reading))
      const raw = result.raw || {}
      if (raw.status !== 'COMPLETED') line('in plain words', result.failureWords)
      return
    }

    const resend = flag('resend', '')
    if (resend) {
      console.log(JSON.stringify(await pawapay.resendDepositCallback({ ...credentials, depositId: resend }), null, 2))
      return
    }

    if (wanted('predict') || wanted('deposit')) {
      const phone = flag('phone', '')
      if (!phone) {
        console.error('Add --phone=<msisdn>, e.g. --phone=256783456789')
        process.exitCode = 1
        return
      }

      const prediction = await pawapay.predictProvider({ ...credentials, phoneNumber: phone })
      line('network', prediction.provider || '(pawaPay did not say)')
      line('msisdn', prediction.msisdn)
      line('country', prediction.country)
      if (!wanted('deposit')) {
        console.log('\nraw:', JSON.stringify(prediction.raw))
        return
      }

      const provider = flag('provider', '') || prediction.provider
      const currency = flag('currency', 'UGX')
      const amount = flag('amount', '1000')
      const depositId = flag('id', '') || rules.buildDepositId()
      line('amount', `${toAmountString(amount, currency)} ${currency}`)
      line('depositId', depositId)
      console.log('')

      const result = await pawapay.initiateDeposit({
        ...credentials,
        depositId,
        amount,
        currency,
        provider,
        phoneNumber: prediction.msisdn,
        customerMessage: flag('message', 'rachett test'),
      })
      console.log(JSON.stringify(result.raw, null, 2))
      line('our reading', JSON.stringify(result.reading))
      const raw = result.raw || {}
      if (raw.status !== 'ACCEPTED') line('in plain words', result.failureWords)
      console.log('')
      console.log(`Check it:  node pawapay-check.js --status=${depositId}`)
      return
    }

    console.log('Nothing to do. Try --config, --sandbox-numbers, --predict, --deposit, --status, --wallets or --keys.')
  })
}

main().catch((err) => {
  console.error('Failed:', (err && err.message) || err)
  if (err && err.details) console.error(JSON.stringify(err.details, null, 2))
  process.exitCode = 1
})
