/**
 * Dev-only harness for the shop tile rules (`src/avatar.ts`).
 *
 *   npx tsc --ignoreConfig src/avatar.ts --outDir _dsbuild --module commonjs --target es2020 --skipLibCheck
 *   Move-Item -Force _dsbuild/avatar.js _dsbuild/avatar.cjs
 *   node _avatar_check.cjs
 *
 * Why this exists: every shop that has no photo wears a letter tile — in Setup Store step 1
 * and on the storefront. If two shops clump onto one colour, or a colour fails contrast, no
 * build log would ever say so. So the palette is measured, not eyeballed.
 */
const assert = require('assert')
const path = require('path')
const {
  AVATAR_PALETTE,
  AVATAR_TEXT,
  avatarColor,
  initialOf,
} = require(path.join(__dirname, '_dsbuild', 'avatar.cjs'))

let checks = 0
const check = (name, fn) => { fn(); checks++; console.log('  ok  ' + name) }

// -- the letter ---------------------------------------------------------------------------

check('the tile wears the first letter of the shop name', () => {
  assert.strictEqual(initialOf('Aisha Fabrics'), 'A')
  assert.strictEqual(initialOf('sneaker hub'), 'S')
  assert.strictEqual(initialOf('   Kampala Kicks'), 'K')
  assert.strictEqual(initialOf('7 Hills Coffee'), '7')
})

check('quotes, punctuation and emoji are skipped, not printed on the tile', () => {
  assert.strictEqual(initialOf("Aisha's Fabrics"), 'A')
  assert.strictEqual(initialOf('"The" Corner Shop'), 'T')
  assert.strictEqual(initialOf('--Beauty Bar--'), 'B')
  assert.strictEqual(initialOf('(Mama) Grace'), 'M')
  assert.strictEqual(initialOf('\u{1F9F5} Threads'), 'T')
})

check('a non-Latin or accented name still gets its own letter', () => {
  assert.strictEqual(initialOf('\u05D0\u05D5\u05E4\u05E0\u05D4'), '\u05D0')
  assert.strictEqual(initialOf('\u0411\u0430\u0437\u0430\u0440'), '\u0411')
  assert.strictEqual(initialOf('Caf\u00E9 Corner'), 'C')
  assert.strictEqual(initialOf('\u00E9toile'), '\u00C9')
  // Decomposed e + combining acute is the same letter, not a bare "E" with the accent lost.
  assert.strictEqual(initialOf('e\u0301toile'), '\u00C9')
})

check('a name with nothing printable still gets a tile, never a blank circle', () => {
  assert.strictEqual(initialOf(''), '?')
  assert.strictEqual(initialOf('   '), '?')
  assert.strictEqual(initialOf('\u{1F600}\u{1F600}'), '?')
  assert.strictEqual(initialOf(undefined), '?')
})

// -- the colour ---------------------------------------------------------------------------

check('one shop, one colour, however the name is typed', () => {
  const a = avatarColor('Aisha Fabrics')
  assert.deepStrictEqual(avatarColor('aisha fabrics'), a)
  assert.deepStrictEqual(avatarColor('  Aisha   Fabrics  '), a)
  assert.deepStrictEqual(avatarColor('Cafe\u0301 Corner'), avatarColor('Caf\u00E9 Corner'))
  assert.ok(AVATAR_PALETTE.includes(a.bg))
  assert.strictEqual(a.fg, AVATAR_TEXT)
})

check('the colour never wobbles between renders of the same name', () => {
  const first = avatarColor('Aisha Fabrics')
  for (let i = 0; i < 50; i++) assert.deepStrictEqual(avatarColor('Aisha Fabrics'), first)
})

check('an empty name is handled without throwing', () => {
  assert.ok(AVATAR_PALETTE.includes(avatarColor('').bg))
  assert.ok(AVATAR_PALETTE.includes(avatarColor(undefined).bg))
})

check('colours spread across the palette instead of clumping on one hash', () => {
  const real = ['Aisha Fabrics', 'Kampala Kicks', 'Mama Grace Foods', 'Tech Hub UG', 'Sneaker Plug',
    'Nakawa Phones', 'Glow Beauty', 'Fresh Market', 'Boda Spares', 'Kitenge Couture']
  const seenReal = new Set(real.map(n => avatarColor(n).bg))
  assert.ok(seenReal.size >= 5, `10 shops produced only ${seenReal.size} colours`)

  const bulk = []
  for (let i = 0; i < 2000; i++) bulk.push('Shop ' + i)
  const seenBulk = new Set(bulk.map(n => avatarColor(n).bg))
  assert.strictEqual(seenBulk.size, AVATAR_PALETTE.length,
    `2000 shops only ever used ${seenBulk.size} of ${AVATAR_PALETTE.length} colours`)
})

check('the palette is valid, unique hex', () => {
  for (const bg of AVATAR_PALETTE) assert.match(bg, /^#[0-9a-f]{6}$/)
  assert.strictEqual(new Set(AVATAR_PALETTE).size, AVATAR_PALETTE.length)
  assert.strictEqual(AVATAR_TEXT, '#ffffff')
})

check('every tile is readable: white text passes WCAG AA (4.5:1)', () => {
  for (const bg of AVATAR_PALETTE) {
    const ratio = contrast(bg, AVATAR_TEXT)
    assert.ok(ratio >= 4.5, `${bg} is only ${ratio.toFixed(2)}:1 against ${AVATAR_TEXT}`)
  }
})

function luminance(hex) {
  const channels = [1, 3, 5]
    .map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)))
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

console.log(`\n${checks} checks passed \u2014 shop tiles: ${AVATAR_PALETTE.length} colours, letter drawn from the name.\n`)
