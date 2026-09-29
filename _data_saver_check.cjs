/**
 * Dev-only harness for the data saver (`src/dataSaver.ts` + the URL rewrite in `src/cloudinaryUrl.ts`).
 *
 *   npx tsc --ignoreConfig src/dataSaver.ts src/cloudinaryUrl.ts --outDir _dsbuild --module commonjs --target es2020 --skipLibCheck
 *   Move-Item -Force _dsbuild/dataSaver.js _dsbuild/dataSaver.cjs
 *   Move-Item -Force _dsbuild/cloudinaryUrl.js _dsbuild/cloudinaryUrl.cjs
 *   node _data_saver_check.cjs
 *
 * Pins what the setting is judged on: it is **on** unless a person says otherwise, the phone's own
 * Data Saver and a 3G connection are reported as the phone's doing rather than the buyer's choice,
 * the width and quality a photo is asked for follow the setting, and every byte figure shown to
 * somebody is a computable estimate ("about") rather than an invented total.
 */
const assert = require('assert')
const path = require('path')
const {
  SAVER_STORAGE_KEY,
  SLOW_DOWNLINK_MBPS,
  FULL_PHOTO_BYTES,
  ECO_TRIM,
  FULL_BUDGET,
  SAVER_BUDGET,
  EMPTY_LEDGER,
  readSaverChoice,
  networkIsThrifty,
  resolveDataSaver,
  imageBudget,
  servedBytes,
  budgetedBytes,
  savedBytes,
  noteLedger,
  sizeWords,
  ledgerLine,
} = require(path.join(__dirname, '_dsbuild', 'dataSaver.cjs'))
const { sizedImage, budgetedImage, CARD_IMAGE_WIDTH } = require(path.join(__dirname, '_dsbuild', 'cloudinaryUrl.cjs'))

let checks = 0
const check = (name, fn) => { fn(); checks++; console.log('  ok  ' + name) }

const CLOUD = 'https://res.cloudinary.com/rachett/image/upload/v1712345678/products/chair.jpg'

check('untouched, the saver is on — the cheap path is the default, not an opt-in', () => {
  const state = resolveDataSaver(null)
  assert.strictEqual(state.on, true)
  assert.strictEqual(state.source, 'default')
  assert.ok(state.reason.includes('by default'))
})

check('a fast connection nobody complained about still gets the cheap path', () => {
  const state = resolveDataSaver(null, { effectiveType: '4g', downlink: 20 })
  assert.strictEqual(state.on, true)
  assert.strictEqual(state.source, 'default')
  assert.ok(state.reason.includes('unless you say otherwise'))
})

check('the phone\u2019s own Data Saver is reported as the phone\u2019s decision', () => {
  const state = resolveDataSaver(null, { saveData: true, effectiveType: '4g' })
  assert.strictEqual(state.on, true)
  assert.strictEqual(state.source, 'network')
  assert.ok(state.reason.includes('Data Saver'))
})

check('a slow connection is named for what it is — 2G, 3G, or just slow', () => {
  const twoG = resolveDataSaver(null, { effectiveType: '2g' })
  assert.strictEqual(twoG.source, 'network')
  assert.ok(twoG.reason.includes('2G'))
  const threeG = resolveDataSaver(null, { effectiveType: '3g' })
  assert.ok(threeG.reason.includes('3G'))
  const slow = resolveDataSaver(null, { downlink: SLOW_DOWNLINK_MBPS - 0.1 })
  assert.strictEqual(slow.source, 'network')
  assert.ok(slow.reason.includes('slow'))
})

check('a connection we cannot measure is not treated as a slow one', () => {
  assert.strictEqual(networkIsThrifty(null), false)
  assert.strictEqual(networkIsThrifty({}), false)
  assert.strictEqual(networkIsThrifty({ downlink: 0 }), false)      // Chromium reports 0 when it does not know
  assert.strictEqual(networkIsThrifty({ downlink: Number.NaN }), false)
  assert.strictEqual(networkIsThrifty({ effectiveType: '4g', downlink: 9 }), false)
})

check('"off" means off — and only ever because a person said so', () => {
  const fast = resolveDataSaver('off', { effectiveType: '4g', downlink: 20 })
  assert.strictEqual(fast.on, false)
  assert.strictEqual(fast.source, 'you')
  assert.ok(fast.reason.includes('full size'))
  // An explicit choice outranks the device: they asked for the full thing, so they get it.
  assert.strictEqual(resolveDataSaver('off', { saveData: true }).on, false)
  const on = resolveDataSaver('on', { effectiveType: '4g', downlink: 20 })
  assert.strictEqual(on.on, true)
  assert.strictEqual(on.source, 'you')
})

check('a stored value we did not write is forgotten, never obeyed', () => {
  assert.strictEqual(readSaverChoice('on'), 'on')
  assert.strictEqual(readSaverChoice(' ON '), 'on')
  assert.strictEqual(readSaverChoice('true'), 'on')
  assert.strictEqual(readSaverChoice('1'), 'on')
  assert.strictEqual(readSaverChoice('off'), 'off')
  assert.strictEqual(readSaverChoice('false'), 'off')
  assert.strictEqual(readSaverChoice('0'), 'off')
  assert.strictEqual(readSaverChoice('yes'), null)
  assert.strictEqual(readSaverChoice(''), null)
  assert.strictEqual(readSaverChoice(null), null)
  assert.strictEqual(readSaverChoice(1), null)          // a number is not something we ever wrote
  assert.strictEqual(readSaverChoice({ on: true }), null)
  assert.strictEqual(readSaverChoice(undefined), null)
  assert.strictEqual(SAVER_STORAGE_KEY, 'rachett_data_saver')
})

check('the budget is what the setting promises: narrower, lower quality, fewer at a time', () => {
  assert.strictEqual(imageBudget(true), SAVER_BUDGET)
  assert.strictEqual(imageBudget(false), FULL_BUDGET)
  assert.strictEqual(imageBudget(resolveDataSaver('on')), SAVER_BUDGET)
  assert.strictEqual(imageBudget(resolveDataSaver('off')), FULL_BUDGET)
  // Nothing handed in is the same as the default: on.
  assert.strictEqual(imageBudget(null), SAVER_BUDGET)
  assert.strictEqual(imageBudget(undefined), SAVER_BUDGET)
  assert.strictEqual(imageBudget(resolveDataSaver(null, { effectiveType: '4g' })), SAVER_BUDGET)

  assert.ok(SAVER_BUDGET.cardWidth < FULL_BUDGET.cardWidth)
  assert.ok(SAVER_BUDGET.fullWidth < FULL_BUDGET.fullWidth)
  assert.ok(SAVER_BUDGET.pageSize < FULL_BUDGET.pageSize)
  assert.ok(SAVER_BUDGET.shelfSize < FULL_BUDGET.shelfSize)
  assert.strictEqual(SAVER_BUDGET.quality, 'eco')
  // 240px still covers a card drawn ~160px wide, so the cheap path is not a blurry one.
  assert.ok(SAVER_BUDGET.cardWidth >= 200)
})

check('the weights came off real photos, and interpolate instead of guessing', () => {
  assert.strictEqual(servedBytes(240), 16_000)
  assert.strictEqual(servedBytes(400), 33_000)
  assert.strictEqual(servedBytes(200), 12_500)               // midway between 160px and 240px
  assert.strictEqual(servedBytes(10), 7_000)                 // clamped below the first point
  assert.strictEqual(servedBytes(9_999), 190_000)            // clamped above the last point
  assert.strictEqual(servedBytes(Number.NaN), 7_000)         // junk is treated as the smallest width
  // Monotonic: a wider photo is never reported as lighter than a narrower one.
  const widths = [120, 160, 200, 240, 320, 400, 520, 640, 900, 1280, 2000]
  for (let i = 1; i < widths.length; i++) {
    assert.ok(servedBytes(widths[i]) >= servedBytes(widths[i - 1]), `weight fell at ${widths[i]}px`)
  }
})

check('eco trims a further quarter at the same width', () => {
  assert.strictEqual(budgetedBytes(240, 'auto'), 16_000)
  assert.strictEqual(budgetedBytes(240, 'eco'), Math.round(16_000 * ECO_TRIM))
  assert.ok(budgetedBytes(240, 'eco') < budgetedBytes(240, 'auto'))
  assert.strictEqual(budgetedBytes(240), budgetedBytes(240, 'auto'))
})

check('the saving is measured against one full-size photo, and never goes negative', () => {
  assert.strictEqual(FULL_PHOTO_BYTES, 820_000)
  assert.strictEqual(savedBytes(240, 'auto'), FULL_PHOTO_BYTES - 16_000)
  assert.strictEqual(savedBytes(240, 'eco'), FULL_PHOTO_BYTES - Math.round(16_000 * ECO_TRIM))
  // The smallest card at the lowest quality saves the most — which is the whole point of the switch.
  const saverCard = savedBytes(SAVER_BUDGET.cardWidth, SAVER_BUDGET.quality)
  assert.ok(saverCard > savedBytes(FULL_BUDGET.cardWidth, 'auto'))
  for (const w of [0, 1, 240, 400, 900, 1280, 99_999]) {
    for (const q of ['auto', 'eco']) assert.ok(savedBytes(w, q) >= 0, `negative saving at ${w}px`)
  }
})

check('the ledger adds up, and never mutates what it was handed', () => {
  const one = noteLedger(EMPTY_LEDGER, SAVER_BUDGET.cardWidth, SAVER_BUDGET.quality)
  assert.notStrictEqual(one, EMPTY_LEDGER)
  assert.strictEqual(one.images, 1)
  assert.strictEqual(one.bytes, savedBytes(SAVER_BUDGET.cardWidth, SAVER_BUDGET.quality))
  assert.deepStrictEqual(EMPTY_LEDGER, { images: 0, bytes: 0 })   // the caller's ledger is untouched

  const two = noteLedger(one, SAVER_BUDGET.cardWidth, SAVER_BUDGET.quality)
  assert.strictEqual(two.images, 2)
  assert.strictEqual(two.bytes, one.bytes * 2)
  assert.strictEqual(one.images, 1)
})

check('the line says "about", names the visit, and never invents a lifetime total', () => {
  const nothing = ledgerLine(EMPTY_LEDGER)
  assert.ok(nothing.includes('Nothing has been shrunk'))
  assert.ok(!nothing.includes('MB'))

  const line = ledgerLine({ images: 42, bytes: 1_400_000 })
  assert.ok(line.includes('About 1.4 MB'))
  assert.ok(line.includes('42 photos'))
  assert.ok(line.includes('this visit'))
  assert.ok(line.includes('instead of full size'))

  const single = ledgerLine({ images: 1, bytes: 804_000 })
  assert.ok(single.includes('1 photo sent'))            // not "1 photos"
  assert.ok(single.includes('804 KB'))

  // Junk in, an honest line out.
  assert.ok(ledgerLine(null).includes('Nothing has been shrunk'))
  assert.ok(ledgerLine({ images: -3, bytes: Number.NaN }).includes('Nothing has been shrunk'))
})

check('sizes are said the way a person says them', () => {
  assert.strictEqual(sizeWords(0), '0 KB')
  assert.strictEqual(sizeWords(Number.NaN), '0 KB')
  assert.strictEqual(sizeWords(820_000), '820 KB')
  assert.strictEqual(sizeWords(999_000), '999 KB')
  assert.strictEqual(sizeWords(1_400_000), '1.4 MB')
  assert.strictEqual(sizeWords(150_000_000), '150 MB')
})

check('the photo a page asks for is the width and quality the setting chose', () => {
  const saver = budgetedImage(CLOUD, SAVER_BUDGET)
  assert.ok(saver.includes('w_240'), saver)
  assert.ok(saver.includes('q_auto:eco'), saver)
  assert.ok(saver.includes('f_auto'), saver)
  assert.ok(saver.includes('c_limit'), saver)
  assert.ok(saver.startsWith('https://res.cloudinary.com/rachett/image/upload/'))
  assert.ok(saver.endsWith('/v1712345678/products/chair.jpg'))     // the photo itself is never changed

  const full = budgetedImage(CLOUD, FULL_BUDGET)
  assert.ok(full.includes('w_400'), full)
  assert.ok(full.includes(',q_auto,'), full)                       // not q_auto:eco
  assert.ok(!full.includes('eco'), full)

  // A sheet that shows one product large asks for the larger of the two widths.
  assert.ok(budgetedImage(CLOUD, SAVER_BUDGET, 'full').includes('w_640'))
  assert.ok(budgetedImage(CLOUD, FULL_BUDGET, 'full').includes('w_900'))
})

check('a URL we do not own is passed through untouched', () => {
  const foreign = [
    'https://example.com/photos/chair.jpg',
    '/placeholders/product.svg',
    'data:image/png;base64,AAAA',
    'blob:http://localhost/abc-123',
    '',
  ]
  for (const url of foreign) {
    assert.strictEqual(budgetedImage(url, SAVER_BUDGET), url)
    assert.strictEqual(sizedImage(url, 240, 'eco'), url)
  }
  // Already carrying instructions: ours must not be stacked on top of somebody else's.
  const dressed = 'https://res.cloudinary.com/rachett/image/upload/q_auto:best,w_800/products/chair.jpg'
  assert.strictEqual(budgetedImage(dressed, SAVER_BUDGET), dressed)
  // Null-ish input is a mistake, not a crash.
  assert.strictEqual(budgetedImage(null, SAVER_BUDGET), null)
  assert.strictEqual(budgetedImage(undefined, SAVER_BUDGET), undefined)
})

check('the card width default still matches the phone it was chosen for', () => {
  assert.strictEqual(CARD_IMAGE_WIDTH, 400)
  assert.ok(sizedImage(CLOUD, undefined, undefined).includes('w_400'))
  // A junk width can never become w_NaN in a URL and break the image.
  assert.ok(sizedImage(CLOUD, Number.NaN).includes('w_400'))
  assert.ok(sizedImage(CLOUD, 4).includes('w_40'))          // clamped up to the smallest we allow
})

console.log(`\n${checks} data-saver checks passed`)

