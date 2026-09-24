/**
 * Register rachett's IPN URL with Pesapal — once, and then never again.
 *
 *   cd functions
 *   $env:PESAPAL_CONSUMER_KEY='...'          # PowerShell, or put both keys in functions/.env
 *   $env:PESAPAL_CONSUMER_SECRET='...'
 *   node pesapal-register-ipn.js                 # registers the Cloud Functions IPN URL
 *   node pesapal-register-ipn.js --list          # what is registered right now
 *   node pesapal-register-ipn.js --status=<id>   # look up one transaction
 *
 * Or keep the keys in `functions/.env` (gitignored) and use Node's own env-file support:
 *
 *   node --env-file=.env pesapal-register-ipn.js
 *
 * The `ipn_id` it prints is what Pesapal needs as `notification_id` on every order, so it is stored
 * as a function secret:
 *
 *   npx firebase functions:secrets:set PESAPAL_IPN_ID
 *
 * Pesapal cannot whitelist their IPs, so the URL must simply be publicly reachable — a Cloud
 * Functions URL is. Nothing here writes to Firestore, and no key is ever printed.
 */
const pesapal = require('./pesapal')

const PROJECT_ID = process.env.GCLOUD_PROJECT || 'socialbridge-93ee1'
const REGION = process.env.FUNCTIONS_REGION || 'us-central1'
const DEFAULT_IPN_URL = `https://${REGION}-${PROJECT_ID}.cloudfunctions.net/pesapalIpn`

const args = process.argv.slice(2)
function flag(name, fallback = '') {
  const hit = args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return fallback
  return hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : 'true'
}

const credentials = {
  consumerKey: process.env.PESAPAL_CONSUMER_KEY || '',
  consumerSecret: process.env.PESAPAL_CONSUMER_SECRET || '',
  env: process.env.PESAPAL_ENV || 'live',
}

async function main() {
  if (!pesapal.isConfigured(credentials)) {
    console.error('Missing PESAPAL_CONSUMER_KEY and/or PESAPAL_CONSUMER_SECRET.')
    console.error("Set them first (PowerShell: $env:PESAPAL_CONSUMER_KEY='...'), or use --env-file=.env.")
    process.exitCode = 1
    return
  }

  console.log(`Pesapal: ${credentials.env} — ${pesapal.baseUrl(credentials.env)}`)

  const status = flag('status', '')
  if (status) {
    const payload = await pesapal.getTransactionStatus({ ...credentials, orderTrackingId: status })
    console.log(JSON.stringify({ ...payload, _ourReading: pesapal.mapPesapalStatus(payload) }, null, 2))
    return
  }

  if (flag('list', '') !== '') {
    console.log(JSON.stringify(await pesapal.listIpns(credentials), null, 2))
    return
  }

  const url = flag('url', DEFAULT_IPN_URL)
  const method = flag('method', 'POST').toUpperCase() === 'GET' ? 'GET' : 'POST'
  const result = await pesapal.registerIpn({ ...credentials, url, method })
  console.log(JSON.stringify(result, null, 2))

  if (result && result.ipn_id) {
    console.log('')
    console.log(`Registered ${method} ${url}`)
    console.log(`ipn_id: ${result.ipn_id}`)
    console.log('')
    console.log('Store it as a function secret (it is required before a payment can be confirmed):')
    console.log('  npx firebase functions:secrets:set PESAPAL_IPN_ID')
  }
}

main().catch((err) => {
  console.error('Failed:', (err && err.message) || err)
  if (err && err.details) console.error(JSON.stringify(err.details, null, 2))
  process.exitCode = 1
})
