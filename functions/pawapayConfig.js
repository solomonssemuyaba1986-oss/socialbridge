/**
 * Turning pawaPay's `active-configuration` into something a person can read — without ever throwing.
 *
 * The bug this file exists to kill: their API docs show `countries` and `providers` as arrays, the
 * live response returns objects keyed by code, and `for...of` over an object throws
 * `object is not iterable`. Their own note is the lesson — *"should not be strictly verified against
 * the schema as backwards compatible changes might be introduced"* — so a strict parser is a parser
 * that breaks the moment they reshape a field, and the one thing a diagnostic must never do is fail
 * in the hands of the person debugging.
 *
 * Three rules:
 *   1. read arrays *and* maps, at every level
 *   2. when a value has no name of its own, keep the key it was filed under
 *   3. if anything at all goes wrong, hand back the reason so the caller can print the raw payload
 *      instead of an exception
 */

/** Anything → a list of `[name, value]`. An array loses its index (an index was never a name). */
function entriesOf(value) {
  if (Array.isArray(value)) return value.map((item) => ['', item])
  if (value && typeof value === 'object') return Object.keys(value).map((key) => [key, value[key]])
  return []
}

/** The first of these keys that actually carries something. */
function pick(source, keys) {
  const s = source || {}
  for (const key of keys) {
    const value = s[key]
    if (value !== undefined && value !== null && value !== '') return value
  }
  return ''
}

/** `DEPOSIT 1000-5000000 · auth:PROVIDER_AUTH · decimals:TWO_PLACES · callback:https://…` */
function operationBits(operationTypes) {
  const bits = []
  for (const [name, detail] of entriesOf(operationTypes)) {
    const d = detail || {}
    const min = pick(d, ['minAmount', 'min'])
    const max = pick(d, ['maxAmount', 'max'])
    const label = String(name || pick(d, ['operationType', 'type']) || 'operation')
    bits.push(`${label}${min || max ? ` ${min || '?'}-${max || '?'}` : ''}`)
    if (d.authType) bits.push(`auth:${d.authType}`)
    if (d.decimalsInAmount) bits.push(`decimals:${d.decimalsInAmount}`)
    const callback = pick(d, ['callbackUrl'])
    if (callback) bits.push(`callback:${callback}`)
  }
  return bits
}

function providerLines(providers) {
  const out = []
  for (const [key, provider] of entriesOf(providers)) {
    const p = provider || {}
    const name = String(pick(p, ['provider', 'code', 'displayName', 'name']) || key || '?')
    const status = String(pick(p, ['status', 'availability', 'providerStatus']) || '')
    out.push(`  ${name}${status ? ` [${status}]` : ''}`)
    const bits = []
    for (const [codeKey, currency] of entriesOf(p.currencies)) {
      const c = currency || {}
      bits.push(String(pick(c, ['currency', 'code']) || codeKey || ''))
      bits.push(...operationBits(c.operationTypes || c.operations))
    }
    out.push(`    ${bits.filter(Boolean).join(' · ')}`)
  }
  return out
}

function countryLines(countries) {
  const out = []
  for (const [key, country] of entriesOf(countries)) {
    const c = country || {}
    const code = String(pick(c, ['country', 'code', 'countryCode']) || key || '')
    const display = c.displayName
    const name = typeof display === 'string' ? display : String(pick(display || {}, ['en']) || '')
    const prefix = pick(c, ['prefix', 'dialCode'])
    out.push('')
    out.push(`${code}${name ? ` ${name}` : ''}${prefix ? ` (prefix +${prefix})` : ''}`)
    out.push(...providerLines(c.providers))
  }
  return out
}

/**
 * The whole thing, in words. Never throws — and when it finds nothing, it says so and points at
 * `--raw`, because the raw payload is the only way anyone ever discovers what changed.
 */
function summariseConfig(response) {
  const c = response || {}
  const sig = c.signatureConfiguration || {}
  const lines = [
    `company:            ${pick(c, ['companyName', 'company']) || '(not set)'}`,
    `signed requests:    ${sig.signedRequestsOnly ? 'ON' : 'off'}`,
    `signed callbacks:   ${sig.signedCallbacks ? 'ON' : 'off'}`,
    ...countryLines(c.countries || c.configuredCountries || c.configuration),
  ]
  if (lines.length <= 3) {
    lines.push('', 'Nothing to list: no countries in this response. Run again with --raw to see its shape.')
  }
  return lines.join('\n')
}

/** `{ text, error }` — an empty `error` means it worked. On a surprise, the caller prints the payload. */
function safeSummary(response) {
  try {
    return { text: summariseConfig(response), error: '' }
  } catch (err) {
    return { text: '', error: (err && err.message) || 'could not read that response' }
  }
}

module.exports = { entriesOf, pick, operationBits, providerLines, countryLines, summariseConfig, safeSummary }
