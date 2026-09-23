/**
 * Dev-only harness for the product details sheet's rules (`src/productSheetUtils.ts`).
 *
 *   npx tsc --ignoreConfig src/productSheetUtils.ts --outDir _dsbuild --module commonjs --target es2020 --skipLibCheck
 *   Move-Item -Force _dsbuild/productSheetUtils.js _dsbuild/productSheetUtils.cjs
 *   node _sheet_check.cjs
 *
 * Why this exists: these five functions decide what a buyer sees at the moment of buying —
 * which colour pill is "on", whether Buy is allowed to fire at all, whether "Only 3 left" is
 * true, and what the seller's order line says. A wrong answer here is a wrong order, and no
 * build log would ever mention it.
 */
const assert = require('assert')
const path = require('path')
const {
  clampQty,
  defaultChoice,
  lineTotal,
  listVariants,
  orderBubbleText,
  parsePrice,
  resolveSheetAction,
  stockLine,
  variantComplete,
  variantLabel,
  variantPrompt,
} = require(path.join(__dirname, '_dsbuild', 'productSheetUtils.cjs'))

let checks = 0
const check = (name, fn) => { fn(); checks++; console.log('  ok  ' + name) }

// -- the options a seller actually typed --------------------------------------------------

check('colours and sizes are cleaned up, not shown raw', () => {
  assert.deepStrictEqual(listVariants(['Black', ' White ', 'Beige']), ['Black', 'White', 'Beige'])
  assert.deepStrictEqual(listVariants(['  XL ', 'xl', 'XL']), ['XL'])
  assert.deepStrictEqual(listVariants(['Black  and   White']), ['Black and White'])
})

check('junk on the product doc never becomes a pill', () => {
  assert.deepStrictEqual(listVariants(undefined), [])
  assert.deepStrictEqual(listVariants(null), [])
  assert.deepStrictEqual(listVariants('Black, White'), [])   // a string is not an array
  assert.deepStrictEqual(listVariants([1, '', '  ', null, 'M']), ['M'])
  assert.deepStrictEqual(listVariants(['Black', 7, {}]), ['Black'])
})

check('a runaway list is capped — the sheet is a chooser, not a catalogue', () => {
  const many = Array.from({ length: 60 }, (_, i) => 'Option ' + i)
  assert.strictEqual(listVariants(many).length, 24)
  assert.strictEqual(listVariants(many, 3).length, 3)
})

// -- the one label, everywhere ------------------------------------------------------------

check('the variant label is one wording for the order, the bag and the bubble', () => {
  assert.strictEqual(variantLabel('Black', 'M'), 'Black / M')
  assert.strictEqual(variantLabel('Black', ''), 'Black')
  assert.strictEqual(variantLabel('', 'M'), 'M')
  assert.strictEqual(variantLabel('', ''), '')
  assert.strictEqual(variantLabel(undefined, undefined), '')
  assert.strictEqual(variantLabel('  Black ', ' M '), 'Black / M')
})

// -- when Buy is allowed to fire ----------------------------------------------------------

check('nothing to choose means nothing is missing', () => {
  const none = { colors: [], sizes: [] }
  assert.strictEqual(variantComplete(none, {}), true)
  assert.strictEqual(variantPrompt(none, {}), '')
})

check('the price is read honestly, or not at all', () => {
  assert.strictEqual(parsePrice('45000'), 45000)
  assert.strictEqual(parsePrice('45,000'), 45000)
  assert.strictEqual(parsePrice('UGX 45,000'), 45000)
  assert.strictEqual(parsePrice(45000), 45000)
  assert.strictEqual(parsePrice(''), null)
  assert.strictEqual(parsePrice('ask me'), null)
  assert.strictEqual(parsePrice(0), null)
  assert.strictEqual(parsePrice(undefined), null)
})

check('the quantity maths adds up, and is shown as arithmetic', () => {
  assert.strictEqual(lineTotal('45000', 1), '1 × 45,000 = 45,000')
  assert.strictEqual(lineTotal('45000', 3), '3 × 45,000 = 135,000')
  assert.strictEqual(lineTotal('45,000', 2), '2 × 45,000 = 90,000')
  assert.strictEqual(lineTotal('ask me', 4), '')       // never invent a total
  assert.strictEqual(lineTotal('45000', 0), '1 × 45,000 = 45,000')
})

check('how many you may order is capped by what is left', () => {
  assert.strictEqual(clampQty(1, undefined), 1)
  assert.strictEqual(clampQty(3, '3'), 3)
  assert.strictEqual(clampQty(9, '3'), 3)              // three left, so three is the ceiling
  assert.strictEqual(clampQty(9, 'in stock'), 9)
  assert.strictEqual(clampQty(0, undefined), 1)        // never below one
  assert.strictEqual(clampQty(-4, undefined), 1)
  assert.strictEqual(clampQty(500, undefined), 99)     // a sane ceiling
  assert.strictEqual(clampQty(3, 0), 3)                // stock 0 is not a quantity limit
})

check('a single option is already chosen — no need to ask', () => {
  assert.strictEqual(defaultChoice(['Black']), 'Black')
  assert.strictEqual(defaultChoice(['M']), 'M')
  assert.strictEqual(defaultChoice([]), '')
  assert.strictEqual(defaultChoice(['Black', 'White']), '')
  // The consequence that matters: one colour + one size is buyable immediately.
  const oneOfEach = { colors: ['Black'], sizes: ['M'] }
  assert.strictEqual(variantComplete(oneOfEach, {
    color: defaultChoice(oneOfEach.colors),
    size: defaultChoice(oneOfEach.sizes),
  }), true)
  // Two colours is a real question, and still a question.
  assert.strictEqual(variantComplete({ colors: ['Black', 'White'], sizes: ['M'] }, { size: 'M' }), false)
})

check('a product with options will not be ordered un-chosen', () => {
  const opts = { colors: ['Black', 'White'], sizes: ['S', 'M'] }
  assert.strictEqual(variantComplete(opts, {}), false)
  assert.strictEqual(variantComplete(opts, { color: 'Black' }), false)
  assert.strictEqual(variantComplete(opts, { size: 'M' }), false)
  assert.strictEqual(variantComplete(opts, { color: 'Black', size: 'M' }), true)
})

check('the prompt names exactly what is missing', () => {
  const opts = { colors: ['Black'], sizes: ['S'] }
  assert.strictEqual(variantPrompt(opts, {}), 'Pick a colour and a size first')
  assert.strictEqual(variantPrompt(opts, { color: 'Black' }), 'Pick a size first')
  assert.strictEqual(variantPrompt(opts, { size: 'S' }), 'Pick a colour first')
  assert.strictEqual(variantPrompt(opts, { color: 'Black', size: 'S' }), '')
})

// -- scarcity, and the promise not to invent it -------------------------------------------

check('"Only N left" only when the seller really said so', () => {
  assert.strictEqual(stockLine(3), 'Only 3 left')
  assert.strictEqual(stockLine('3'), 'Only 3 left')
  assert.strictEqual(stockLine(1), 'Only 1 left')
  assert.strictEqual(stockLine(5), 'Only 5 left')
  assert.strictEqual(stockLine(6), '')
  assert.strictEqual(stockLine(400), '')
  assert.strictEqual(stockLine(0), '')          // whether the shop is open is `outOfStock`'s job
  assert.strictEqual(stockLine('in stock'), '')
  assert.strictEqual(stockLine(''), '')
  assert.strictEqual(stockLine(undefined), '')
  assert.strictEqual(stockLine(null), '')
})

// -- what the ✕ closed, and what the seller reads ----------------------------------------

check('"looked and left" is its own answer', () => {
  assert.strictEqual(resolveSheetAction(null), 'none')
  assert.strictEqual(resolveSheetAction(undefined), 'none')
  assert.strictEqual(resolveSheetAction('buy'), 'buy')
  assert.strictEqual(resolveSheetAction('bag'), 'bag')
})

check('the order bubble says the variant, or says nothing extra', () => {
  assert.strictEqual(orderBubbleText('RT-ABC123', 'Black / M'), '📦 Order placed — Ref: RT-ABC123 · Black / M')
  assert.strictEqual(orderBubbleText('RT-ABC123', ''), '📦 Order placed — Ref: RT-ABC123')
  assert.strictEqual(orderBubbleText('RT-ABC123', undefined), '📦 Order placed — Ref: RT-ABC123')
  assert.strictEqual(orderBubbleText('RT-ABC123', '  '), '📦 Order placed — Ref: RT-ABC123')
})

console.log(`\n${checks} checks passed \u2014 product sheet: variants, stock, actions and the order line.\n`)
