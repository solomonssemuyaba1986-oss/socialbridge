/**
 * Dev-only harness for the colour-word lookup (`src/colourSwatch.ts`).
 *
 *   npx tsc --ignoreConfig src/colourSwatch.ts --outDir _dsbuild --module commonjs --target es2020 --skipLibCheck
 *   Move-Item -Force _dsbuild/colourSwatch.js _dsbuild/colourSwatch.cjs
 *   node _colour_check.cjs
 *
 * Why this exists: sellers type colour *words*, and we draw them as circles. A wrong guess paints a
 * confident lie on a product page ("Burgundy" shown as bright red), and a missing outline makes a
 * white swatch invisible on a dark page. Neither shows up in a build log.
 */
const assert = require('assert')
const path = require('path')
const { hexFor, swatchFor, textOn } = require(path.join(__dirname, '_dsbuild', 'colourSwatch.cjs'))

let checks = 0
const check = (name, fn) => { fn(); checks++; console.log('  ok  ' + name) }

check('the obvious colour words all resolve', () => {
  const expected = {
    black: '#0a0a0a', white: '#ffffff', red: '#d32f2f', blue: '#1976d2', green: '#2e7d32',
    pink: '#e91e63', purple: '#7b1fa2', orange: '#f57c00', yellow: '#fdd835', brown: '#6d4c41',
    navy: '#1a237e', gold: '#d4af37', silver: '#c0c4c8', beige: '#f5f5dc', tan: '#d2b48c',
    teal: '#00897b', maroon: '#7b1f1f', grey: '#9aa0a6', gray: '#9aa0a6',
  }
  for (const [word, hex] of Object.entries(expected)) {
    assert.strictEqual(hexFor(word), hex, word)
  }
})

check('however the seller types it, it is the same colour', () => {
  assert.strictEqual(hexFor('  Sky Blue '), hexFor('sky-blue'))
  assert.strictEqual(hexFor('SKY BLUE'), hexFor('sky  blue'))
  assert.strictEqual(hexFor('Blue.'), hexFor('blue'))
  assert.strictEqual(hexFor("Women's blue"), hexFor('blue'))
})

check('a longer colour name always beats the colour inside it', () => {
  assert.notStrictEqual(hexFor('light blue'), hexFor('blue'))
  assert.notStrictEqual(hexFor('dark green'), hexFor('green'))
  assert.notStrictEqual(hexFor('royal blue'), hexFor('blue'))
  assert.notStrictEqual(hexFor('off white'), hexFor('white'))
  assert.strictEqual(hexFor('sky blue denim'), hexFor('sky blue'))
})

check('prints and mixed colours are never shown as one flat colour', () => {
  for (const word of ['Multi', 'multicolour', 'assorted', 'floral print', 'striped', 'tie-dye', 'rainbow', 'leopard']) {
    assert.strictEqual(swatchFor(word).kind, 'multi', word)
    assert.strictEqual(hexFor(word), null, word)
  }
})

check('a word we do not know stays unknown instead of guessing', () => {
  for (const word of ['Boubou', 'as seen in photo', '', '   ', 'size 42']) {
    assert.strictEqual(swatchFor(word), null, JSON.stringify(word))
  }
  assert.strictEqual(swatchFor(undefined), null)
  assert.strictEqual(swatchFor(7), null)
  assert.strictEqual(hexFor(null), null)
})

check('near-white and near-black swatches get an outline', () => {
  assert.strictEqual(swatchFor('white').ring, true)
  assert.strictEqual(swatchFor('black').ring, true)
  assert.strictEqual(swatchFor('ivory').ring, true)
  // Very dark colours need it too: maroon on a near-black page is otherwise invisible.
  assert.strictEqual(swatchFor('maroon').ring, true)
  assert.strictEqual(swatchFor('charcoal').ring, true)
  // Mid-tones can stand on their own — no fussy outline.
  assert.strictEqual(swatchFor('blue').ring, false)
  assert.strictEqual(swatchFor('teal').ring, false)
  assert.strictEqual(swatchFor('pink').ring, false)
})

check('text on a swatch stays readable either way round', () => {
  assert.strictEqual(textOn('#ffffff'), '#000000')
  assert.strictEqual(textOn('#0a0a0a'), '#ffffff')
  assert.strictEqual(textOn('#fdd835'), '#000000')   // yellow needs dark text
  assert.strictEqual(textOn('#1a237e'), '#ffffff')   // navy needs light text
})

check('every swatch is a real 6-digit hex', () => {
  for (const word of ['black', 'white', 'sky blue', 'maroon', 'gold', 'mint', 'charcoal', 'camel', 'khaki', 'cyan']) {
    const swatch = swatchFor(word)
    assert.strictEqual(swatch.kind, 'solid', word)
    assert.match(swatch.hex, /^#[0-9a-f]{6}$/, word)
  }
})

console.log(`\n${checks} checks passed \u2014 colour words: matching, mixes, outlines and readability.\n`)
