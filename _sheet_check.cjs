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
  listVariants,
  orderBubbleText,
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
