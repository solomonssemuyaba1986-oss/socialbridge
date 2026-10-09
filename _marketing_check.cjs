/**
 * Dev-only harness for the 📣 Marketing page and the QR code it prints.
 *
 *   npx tsc --ignoreConfig src/qrCode.ts src/qrCanvas.ts src/marketing.ts src/viewOnce.ts \
 *     --outDir _dsbuild --module commonjs --target es2020 --skipLibCheck
 *   Copy-Item -Force _dsbuild/qrCode.js _dsbuild/qrCode.cjs       (…and qrCanvas, marketing, viewOnce)
 *   node _marketing_check.cjs
 *
 * Then: npm run build && npx eslint .
 *
 * WHY IT LOOKS LIKE THIS: a QR that does not scan is a piece of paper with squares on it, and the
 * only real proof of a scan is a camera pointed at a print. So this file does the two jobs the camera
 * would otherwise be doing on its own — it re-derives the symbol from the spec (module count, block
 * layout, Reed–Solomon, mask choice) with arithmetic written **here**, and it decodes the finished
 * symbol back into text with its own reader. If `src/qrCode.ts` and this file agree, they agree about
 * the standard, not about each other's bugs.
 *
 * The sellers' half is checked the way the rest of the repo checks its pages: the links, the
 * captions, the ranking, the filenames — and that the files which must agree (nav, route, rules,
 * taxonomy, docs) still do.
 *
 * It reads files and runs arithmetic. It does not run the app.
 */
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const SOURCES = ['qrCode', 'qrCanvas', 'marketing', 'viewOnce']

execSync(
  `npx tsc --ignoreConfig ${SOURCES.map(name => `src/${name}.ts`).join(' ')} --outDir _dsbuild --module commonjs --target es2020 --skipLibCheck`,
  { stdio: 'inherit' },
)
for (const name of SOURCES) {
  fs.copyFileSync(path.join(__dirname, '_dsbuild', `${name}.js`), path.join(__dirname, '_dsbuild', `${name}.cjs`))
}

const qr = require('./_dsbuild/qrCode.cjs')
const card = require('./_dsbuild/qrCanvas.cjs')
const mkt = require('./_dsbuild/marketing.cjs')
const once = require('./_dsbuild/viewOnce.cjs')

let checks = 0
const check = (name, fn) => { fn(); checks++; console.log('  ok  ' + name) }
/** A file's text with line endings normalised, so a check about a line holds on Windows too. */
const read = rel => fs.readFileSync(path.join(__dirname, rel), 'utf8').replace(/\r\n/g, '\n')

/** ── Arithmetic written from the spec, for this file only ─────────────────────────────────────── */

/** The spec's own answer for "how many modules does this version have for data and error coding?" */
function rawModules(version) {
  let n = (16 * version + 128) * version + 64
  if (version >= 2) {
    const aligns = Math.floor(version / 7) + 2
    n -= (25 * aligns - 10) * aligns - 55
    if (version >= 7) n -= 36
  }
  return n
}

/** A polynomial remainder, MSB first. The whole BCH check is this one line. */
function polyMod(value, generator) {
  let v = value
  while (v.toString(2).length >= generator.toString(2).length) {
    v ^= generator << (v.toString(2).length - generator.toString(2).length)
  }
  return v
}

const EXP = new Array(256)
const LOG = new Array(256)
{
  let x = 1
  for (let i = 0; i < 255; i++) {
    EXP[i] = x
    LOG[x] = i
    x <<= 1
    if (x & 0x100) x ^= 0x11d
  }
}
const gfMul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[(LOG[a] + LOG[b]) % 255])

/** The codeword polynomial at α^power. Every power of a *correct* RS block gives 0. */
function syndrome(codewords, power) {
  let acc = 0
  for (const cw of codewords) acc = gfMul(acc, EXP[power]) ^ cw
  return acc
}

/** Level Q, versions 1–10, retyped from the spec: [ec per block, [[blocks, data per block], …]]. */
const Q_TABLE = [
  [13, [[1, 13]]],
  [22, [[1, 22]]],
  [18, [[2, 17]]],
  [26, [[2, 24]]],
  [18, [[2, 15], [2, 16]]],
  [24, [[4, 19]]],
  [18, [[2, 14], [4, 15]]],
  [22, [[4, 18], [2, 19]]],
  [20, [[4, 16], [4, 17]]],
  [24, [[6, 19], [2, 20]]],
]

/** Alignment-pattern centres, retyped. Version 7's `22` is the spec's exception, not a typo. */
const ALIGN = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]]

/** Byte-mode capacity per version at level Q — the published column, retyped. */
const Q_BYTES = [11, 20, 32, 46, 60, 74, 86, 108, 130, 151]

/** The eight masks, in (row, col). */
function ownMask(mask, row, col) {
  switch (mask) {
    case 0: return (row + col) % 2 === 0
    case 1: return row % 2 === 0
    case 2: return col % 3 === 0
    case 3: return (row + col) % 3 === 0
    case 4: return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0
    case 5: return ((row * col) % 2) + ((row * col) % 3) === 0
    case 6: return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0
    default: return (((row + col) % 2) + ((row * col) % 3)) % 2 === 0
  }
}

/** Where the function patterns are — rebuilt here so the reader does not borrow the writer's map. */
function ownReserved(version) {
  const size = 17 + version * 4
  const reserved = Array.from({ length: size }, () => new Array(size).fill(false))
  const mark = (row, col) => {
    if (row >= 0 && col >= 0 && row < size && col < size) reserved[row][col] = true
  }
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) {
      mark(i, j)
      mark(i, size - 1 - j)
      mark(size - 1 - i, j)
    }
  }
  for (let i = 0; i < size; i++) { mark(6, i); mark(i, 6) }
  const centres = ALIGN[version - 1]
  const last = centres.length - 1
  centres.forEach((row, i) => centres.forEach((col, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) mark(row + dr, col + dc)
  }))
  for (let i = 0; i <= 8; i++) { mark(8, i); mark(i, 8) }
  for (let i = 0; i < 8; i++) mark(8, size - 1 - i)
  for (let i = 0; i < 7; i++) mark(size - 1 - i, 8)
  mark(size - 8, 8)
  if (version >= 7) {
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3)
      const b = Math.floor(i / 3)
      mark(b, a)
      mark(a, b)
    }
  }
  return reserved
}

/** Unmask and read the bit stream in the spec's zigzag order, skipping every function pattern. */
function readBits(version, modules, mask) {
  const size = 17 + version * 4
  const reserved = ownReserved(version)
  const bits = []
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let step = 0; step < size; step++) {
      for (let j = 0; j < 2; j++) {
        const col = right - j
        const upward = ((right + 1) & 2) === 0
        const row = upward ? size - 1 - step : step
        if (reserved[row][col]) continue
        bits.push(modules[row][col] === ownMask(mask, row, col) ? 0 : 1)
      }
    }
  }
  return bits
}

/** De-interleave into blocks, prove every block's Reed–Solomon, and hand back the data codewords. */
function decodeData(version, modules, mask) {
  const bits = readBits(version, modules, mask)
  const [ecPerBlock, groups] = Q_TABLE[version - 1]
  const dataLengths = groups.flatMap(([count, perBlock]) => Array.from({ length: count }, () => perBlock))
  const total = Math.floor(rawModules(version) / 8)
  const shortLen = Math.floor(total / dataLengths.length)
  const shortCount = dataLengths.length - (total % dataLengths.length)
  const dataPerBlock = shortLen - ecPerBlock

  const parts = dataLengths.map(() => [])
  let at = 0
  for (let i = 0; i <= shortLen; i++) {
    for (let j = 0; j < dataLengths.length; j++) {
      if (i === dataPerBlock && j < shortCount) continue
      let value = 0
      for (let b = 0; b < 8; b++) value = (value << 1) | bits[at * 8 + b]
      parts[j].push(value)
      at++
    }
  }
  assert.strictEqual(at, total, `version ${version}: the interleaved stream is exactly ${total} codewords`)

  parts.forEach((part, index) => {
    for (let power = 0; power < ecPerBlock; power++) {
      assert.strictEqual(syndrome(part, power), 0, `block ${index} is wrong at α^${power}`)
    }
  })

  const data = []
  parts.forEach((part, index) => { data.push(...part.slice(0, dataLengths[index])) })
  return data
}

/** Mode, length, bytes — read back the way a scanner does. */
function payloadOf(dataCodewords, version) {
  const bits = []
  for (const cw of dataCodewords) for (let i = 7; i >= 0; i--) bits.push((cw >> i) & 1)
  let at = 0
  const take = n => {
    let value = 0
    for (let i = 0; i < n; i++) value = (value << 1) | bits[at++]
    return value
  }
  assert.strictEqual(take(4), 4, 'byte mode is 0100')
  const length = take(version <= 9 ? 8 : 16)
  const bytes = []
  for (let i = 0; i < length; i++) bytes.push(take(8))
  return Buffer.from(bytes).toString('utf8')
}

/** The four penalty rules, written a second way — as text windows rather than nested loops. */
function ownPenalty(modules) {
  const size = modules.length
  let score = 0
  const runs = line => {
    let run = 1
    for (let i = 1; i < line.length; i++) {
      if (line[i] === line[i - 1]) {
        run++
        if (run === 5) score += 3
        else if (run > 5) score++
      } else run = 1
    }
  }
  const finderish = line => {
    const text = line.map(cell => (cell ? '1' : '0')).join('')
    let n = 0
    for (let i = 0; i + 11 <= text.length; i++) {
      const window = text.slice(i, i + 11)
      if (window === '10111010000' || window === '00001011101') n += 40
    }
    return n
  }
  const columns = []
  for (let i = 0; i < size; i++) columns.push(modules.map(row => row[i]))
  for (let i = 0; i < size; i++) { runs(modules[i]); runs(columns[i]) }
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = modules[r][c]
      if (v === modules[r][c + 1] && v === modules[r + 1][c] && v === modules[r + 1][c + 1]) score += 3
    }
  }
  for (let i = 0; i < size; i++) { score += finderish(modules[i]); score += finderish(columns[i]) }
  const dark = modules.flat().filter(Boolean).length
  const total = size * size
  score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10
  return score
}

/** The 15 format bits, read straight out of the finished symbol, in both of their homes. */
function readFormatBits(modules) {
  const size = modules.length
  const bit = i => (i <= 5 ? modules[8][i] : i === 6 ? modules[8][7] : i === 7 ? modules[8][8] : i === 8 ? modules[7][8] : modules[14 - i][8])
  const bit2 = i => (i < 8 ? modules[8][size - 1 - i] : modules[size - 15 + i][8])
  let first = 0
  let second = 0
  for (let i = 14; i >= 0; i--) {
    first = (first << 1) | (bit(i) ? 1 : 0)
    second = (second << 1) | (bit2(i) ? 1 : 0)
  }
  return { first, second }
}

const STORE_URL = 'https://rachett.shop/store/amina-fabrics'

console.log('\nthe QR code — checked against the spec, not against itself\n')

check('the level-Q tables add up to the spec\'s own codeword counts', () => {
  const totals = [26, 44, 70, 100, 134, 172, 196, 242, 292, 346]
  assert.deepStrictEqual(qr.QR_TOTAL_CODEWORDS, totals)
  assert.deepStrictEqual(qr.QR_REMAINDER_BITS, [0, 7, 7, 7, 7, 7, 0, 0, 0, 0])
  for (let v = 1; v <= 10; v++) {
    const [ecPerBlock, groups] = Q_TABLE[v - 1]
    const blocks = groups.reduce((n, [count]) => n + count, 0)
    const data = groups.reduce((n, [count, perBlock]) => n + count * perBlock, 0)
    assert.strictEqual(data + ecPerBlock * blocks, totals[v - 1], `version ${v}: data + ec`)
    assert.strictEqual(qr.QR_EC_Q[v - 1].ecPerBlock, ecPerBlock, `version ${v}: ec per block`)
    assert.deepStrictEqual(
      qr.QR_EC_Q[v - 1].groups.map(g => [g.blocks, g.dataPerBlock]),
      groups,
      `version ${v}: block groups`,
    )
    assert.strictEqual(qr.dataCodewordCount(v), data, `version ${v}: data codewords`)
  }
})

check('every version has exactly the modules the spec lays out — and no more', () => {
  for (let v = 1; v <= 10; v++) {
    const free = qr.dataModuleCount(v)
    assert.strictEqual(free, rawModules(v), `version ${v}: the encoder's map`)
    const own = ownReserved(v).flat().filter(cell => !cell).length
    assert.strictEqual(own, rawModules(v), `version ${v}: the reader's map`)
    assert.strictEqual(free - qr.QR_TOTAL_CODEWORDS[v - 1] * 8, qr.QR_REMAINDER_BITS[v - 1], `version ${v}: remainder bits`)
  }
  assert.deepStrictEqual(qr.QR_ALIGNMENT_CENTERS, ALIGN, 'the alignment centres are the spec\'s (version 7 included)')
})

check('byte capacity is the published column, and a link is never silently truncated', () => {
  Q_BYTES.forEach((bytes, index) => {
    assert.strictEqual(qr.byteCapacity(index + 1), bytes, `version ${index + 1}`)
    assert.strictEqual(qr.pickVersion(bytes), index + 1, `exactly ${bytes} bytes`)
    assert.strictEqual(qr.pickVersion(bytes + 1), index + 1 < 10 ? index + 2 : null, `${bytes + 1} bytes`)
  })
  for (let v = 1; v <= 10; v++) {
    assert.strictEqual(qr.encodeQr('x'.repeat(Q_BYTES[v - 1])).version, v, `${Q_BYTES[v - 1]} bytes fit version ${v}`)
  }
  assert.throws(() => qr.encodeQr('x'.repeat(Q_BYTES[9] + 1)), RangeError, 'too long throws instead of dropping a byte')
})

check('the format information says level Q, names the mask, and carries its own BCH check', () => {
  for (let mask = 0; mask < 8; mask++) {
    const bits = qr.formatBits(mask)
    // The 15 bits go out XORed with 0x5412, so the level and mask are read back after undoing it.
    const data = (bits ^ 0x5412) >> 10
    assert.strictEqual(data & 7, mask, 'the low three bits are the mask')
    assert.strictEqual((data >> 3) & 3, 3, 'the next two are level Q (0b11)')
    assert.strictEqual(polyMod(bits ^ 0x5412, 0x537), 0, 'BCH(15,5) remainder')
  }
  // and both copies inside a real symbol are the ones the spec's generator produces
  const code = qr.encodeQr(STORE_URL)
  const format = readFormatBits(code.modules)
  assert.strictEqual(format.first, qr.formatBits(code.mask), 'the copy beside the finder')
  assert.strictEqual(format.second, qr.formatBits(code.mask), 'the copy along the edges')
  assert.strictEqual(polyMod(format.first ^ 0x5412, 0x537), 0, 'and it survives the generator')
  assert.strictEqual(code.modules[code.size - 8][8], true, 'the dark module is dark')
})

check('version information (7 and up) is BCH(18,6) over the version number', () => {
  for (let v = 7; v <= 10; v++) {
    const bits = qr.versionBits(v)
    assert.strictEqual(bits >> 12, v, 'the top six bits are the version')
    assert.strictEqual(polyMod(bits, 0x1f25), 0, 'BCH(18,6) remainder')
  }
  // a version-7 symbol carries that number twice, and both copies agree
  const code = qr.encodeQr('x'.repeat(Q_BYTES[6]))
  assert.strictEqual(code.version, 7)
  const bits = qr.versionBits(7)
  for (let i = 0; i < 18; i++) {
    const expected = ((bits >> i) & 1) === 1
    const a = code.size - 11 + (i % 3)
    const b = Math.floor(i / 3)
    assert.deepStrictEqual(
      [code.modules[b][a], code.modules[a][b]],
      [expected, expected],
      `version bit ${i}`,
    )
  }
})

check('a store link survives the whole trip: encode → read back, syndrome-checked', () => {
  const code = qr.encodeQr(STORE_URL)
  assert.strictEqual(code.version, 4, 'a 40-byte link is a version-4 symbol at level Q')
  const data = decodeData(code.version, code.modules, code.mask)
  assert.strictEqual(data.length, qr.dataCodewordCount(code.version), 'every data codeword came back')
  assert.strictEqual(payloadOf(data, code.version), STORE_URL, 'and the text is the link that went in')
})

check('every version round-trips, including the 16-bit length at version 10', () => {
  const base = 'https://r.shop/s/'
  for (let v = 1; v <= 10; v++) {
    const capacity = Q_BYTES[v - 1]
    const text = capacity <= base.length ? 'n'.repeat(capacity) : base + 'n'.repeat(capacity - base.length)
    assert.strictEqual(Buffer.byteLength(text, 'utf8'), capacity, `the test text fills version ${v} exactly`)
    const code = qr.encodeQr(text)
    assert.strictEqual(code.version, v, `version ${v} chosen`)
    assert.strictEqual(payloadOf(decodeData(v, code.modules, code.mask), v), text, `version ${v} reads back`)
  }
})

check('the mask that is drawn is the one the spec dislikes least', () => {
  const code = qr.encodeQr(STORE_URL)
  const scores = []
  for (let mask = 0; mask < 8; mask++) {
    const drawn = qr.buildQr(STORE_URL, code.version, mask)
    assert.strictEqual(readFormatBits(drawn).first, qr.formatBits(mask), `mask ${mask} is on the symbol`)
    assert.strictEqual(readFormatBits(drawn).second, qr.formatBits(mask), `mask ${mask} is in both places`)
    scores.push(ownPenalty(drawn))
  }
  const best = scores.indexOf(Math.min(...scores))
  assert.strictEqual(code.mask, best, `chose mask ${code.mask} of ${JSON.stringify(scores)}`)
  assert.strictEqual(qr.maskPenalty(code.modules), scores[best], 'and this file scores it the same way')
  assert.deepStrictEqual(code.modules, qr.buildQr(STORE_URL, code.version, code.mask), 'the symbol is the one that mask builds')
})

check('non-ASCII survives too — a shop slug is not always plain ASCII', () => {
  const text = 'https://rachett.shop/store/café-boutique-öl'
  const code = qr.encodeQr(text)
  assert.strictEqual(code.version, qr.pickVersion(Buffer.byteLength(text, 'utf8')), 'sized by its bytes, not its characters')
  assert.strictEqual(payloadOf(decodeData(code.version, code.modules, code.mask), code.version), text)
})

console.log('\nthe card a seller prints\n')

check('the quiet zone is four modules of white, and the card never outgrows its box', () => {
  for (const moduleCount of [21, 25, 29, 33, 45, 57]) {
    const layout = card.qrLayout({ sizePx: 240, moduleCount })
    assert.strictEqual(card.QUIET_ZONE_MODULES, 4, 'the spec\'s number, not a preference')
    assert.strictEqual(layout.quietZonePx, layout.modulePx * 4, 'four modules on every side')
    assert.strictEqual(layout.totalPx, layout.codePx + layout.quietZonePx * 2, 'nothing unaccounted for')
    assert.ok(layout.totalPx <= 240, 'never bigger than the space it was given')
    assert.ok(layout.modulePx >= 2, `a ${layout.modulePx}px module is still printable`)
    assert.strictEqual(layout.codePx % layout.modulePx, 0)
  }
})

check('the mark is centred on a white pad, clear of the finders and the timing lines', () => {
  for (let version = 2; version <= 10; version++) {
    const size = 17 + version * 4
    const layout = card.qrLayout({ sizePx: 260, moduleCount: size })
    assert.ok(layout.logo, `version ${version} has room for the mark`)
    const { x, y, size: mark, pad } = layout.logo
    assert.strictEqual(x, y, 'squarely in the middle')
    assert.strictEqual((x - layout.quietZonePx) % layout.modulePx, 0, 'and on the module grid, so no half modules')
    const gapLeft = x - layout.quietZonePx
    const gapRight = layout.totalPx - layout.quietZonePx - (x + mark)
    assert.ok(Math.abs(gapLeft - gapRight) <= layout.modulePx, 'centred to the nearest module')
    // in module coordinates: the pad has to clear the finders (0-7 and size-8 to size-1)
    const first = (x - pad - layout.quietZonePx) / layout.modulePx
    const last = (x + mark + pad - layout.quietZonePx) / layout.modulePx
    assert.ok(first >= 8, `version ${version}: the pad starts at module ${first}`)
    assert.ok(last <= size - 8, `version ${version}: and ends at module ${last}`)
    assert.ok(layout.coveredRatio < 0.12, `version ${version}: spends ${(layout.coveredRatio * 100).toFixed(1)}% of level Q's budget`)
  }
  const smallest = card.qrLayout({ sizePx: 200, moduleCount: 21 })
  assert.strictEqual(smallest.logo, null, 'a version-1 symbol has no room - no mark, and no pretending')
  assert.strictEqual(smallest.coveredRatio, 0)
})

check('the printed page is the card and nothing else', () => {
  const html = card.qrPrintHtml({
    businessName: 'Amina <Fabrics>',
    slug: 'amina-fabrics',
    dataUrl: 'data:image/png;base64,AAAA',
    hint: 'Stick it on your parcels',
  })
  assert.ok(html.startsWith('<!doctype html>'), 'a whole page, not a fragment')
  assert.ok(html.includes('data:image/png;base64,AAAA'), 'the QR itself')
  assert.ok(html.includes('Amina &lt;Fabrics&gt;'), 'the shop name is escaped, not injected')
  assert.ok(!html.includes('Amina <Fabrics>'), 'never raw')
  assert.ok(html.includes('/store/amina-fabrics'), 'and the link is written out for anybody who cannot scan')
  assert.ok(html.includes('Stick it on your parcels'), 'one instruction, the right one')
  assert.ok(!/rt-|#0f0f0f|#adff2f/.test(html), 'no app chrome and none of the dark palette - this is paper')
  assert.strictEqual(html.match(/<script/gi), null, 'and no script, on principle')
})



console.log('\ncounting an open once, not once per render\n')

const fakeStore = () => {
  const map = new Map()
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, value),
    removeItem: key => map.delete(key),
  }
}

check('a session counts a product once, and every product separately', () => {
  const store = fakeStore()
  assert.strictEqual(once.viewMarkerKey('p1'), 'rachett_viewed_p1')
  assert.strictEqual(once.shouldCountView(store, 'p1'), true, 'the first open counts')
  assert.strictEqual(once.shouldCountView(store, 'p1'), false, 'the second does not')
  assert.strictEqual(once.shouldCountView(store, 'p1'), false, 'nor the third — a re-render is not interest')
  assert.strictEqual(once.shouldCountView(store, 'p2'), true, 'a different product has its own answer')
  assert.strictEqual(once.shouldCountView(fakeStore(), 'p1'), true, 'a fresh session counts again')
})

check('nothing is counted without a product, and never at all without storage', () => {
  assert.strictEqual(once.shouldCountView(fakeStore(), ''), false)
  assert.strictEqual(once.shouldCountView(null, 'p1'), false)
  assert.strictEqual(once.shouldCountView(undefined, 'p1'), false)
  const denied = { getItem: () => null, setItem: () => { throw new Error('storage denied') }, removeItem: () => {} }
  assert.strictEqual(once.shouldCountView(denied, 'p1'), false, 'no storage means no count — under, never over')
})

console.log('\nthe links, the captions and the table\n')

const ORIGIN = 'https://rachett.shop'
const SHOP_URL = mkt.storeLink(ORIGIN, 'amina-fabrics')

check('a store link is the shop, and a product link is one product inside it', () => {
  assert.strictEqual(SHOP_URL, 'https://rachett.shop/store/amina-fabrics')
  assert.strictEqual(mkt.storeLink(`${ORIGIN}/`, 'amina-fabrics'), SHOP_URL, 'a trailing slash is not a doubled one')
  assert.strictEqual(mkt.storeLink(`${ORIGIN}///`, ' amina-fabrics '), SHOP_URL, 'and the slug is trimmed')
  assert.strictEqual(mkt.productLink(ORIGIN, 'amina-fabrics', 'p1'), `${SHOP_URL}?productId=p1`)
  assert.ok(mkt.productLink(ORIGIN, 'a', 'x/y z').endsWith('?productId=x%2Fy%20z'), 'an odd id is encoded, not pasted')
  assert.ok(mkt.productLink(ORIGIN, 'a', 'p').includes('?productId='), 'the shape StorePage already reads')
})

check('captions name the shop, the product and the price — and never invent a price', () => {
  assert.ok(mkt.storeCaption('Amina Fabrics').includes('Amina Fabrics'))
  assert.ok(mkt.storeCaption('').includes('my shop'), 'an unnamed shop still reads like a sentence')
  const priced = mkt.productCaption('Ankara Dress', 'UGX 45,000', 'Amina Fabrics')
  assert.ok(priced.includes('Ankara Dress') && priced.includes('UGX 45,000') && priced.includes('Amina Fabrics'))
  const unpriced = mkt.productCaption('Ankara Dress', '', 'Amina Fabrics')
  assert.ok(!unpriced.includes('\u2014'), 'no dangling dash when there is no price')
  assert.ok(unpriced.includes('Ankara Dress'))
  assert.ok(mkt.productCaption('', '', '').length > 0, 'and never an empty caption')
})

check('every channel carries the link, and the clipboard is not a URL', () => {
  const targets = mkt.shareTargets(SHOP_URL, mkt.storeCaption('Amina Fabrics'))
  assert.deepStrictEqual(
    targets.map(t => t.channel),
    ['whatsapp', 'telegram', 'facebook', 'x', 'email', 'copy'],
    'WhatsApp first, because that is where the customers are',
  )
  for (const target of targets) {
    if (target.channel === 'copy') {
      assert.strictEqual(target.href, '', 'the clipboard is an action, not a link')
      continue
    }
    assert.ok(/^(https:\/\/|mailto:)/.test(target.href), `${target.channel} is a real link`)
    assert.ok(decodeURIComponent(target.href).includes(SHOP_URL), `${target.channel} carries the store link`)
    assert.ok(target.label.length > 0 && target.icon.length > 0)
  }
})

check('the promotion cards are places a person can post to today', () => {
  const cards = mkt.promoteCards('Amina Fabrics', SHOP_URL)
  assert.strictEqual(cards.length, 5)
  assert.strictEqual(new Set(cards.map(c => c.id)).size, 5, 'no duplicate ids')
  cards.forEach(c => {
    assert.ok(c.title && c.why && c.caption, `${c.id} says something`)
    assert.ok(c.why.length <= 90, `${c.id} keeps the reason to one line`)
  })
  cards.filter(c => c.id !== 'parcel').forEach(c => {
    assert.ok(c.caption.includes(SHOP_URL), `${c.id} carries the link it promises`)
  })
  const parcel = cards.find(c => c.id === 'parcel')
  assert.ok(!parcel.caption.includes('http'), 'the parcel card is about the printed code, not a link')
  assert.ok(mkt.promoteCards('Amina Fabrics', '').every(c => c.caption.length > 0), 'an unset link still gives something to copy')
})

check('the table ranks by orders, then bags, then likes, then opens', () => {
  const rows = mkt.interestRows({
    products: [
      { id: 'a', name: 'Ankara Dress', price: '45000', orderCount: 2, likeCount: 1 },
      { id: 'b', name: 'Beaded Bag', price: '30000', orderCount: 2, likeCount: 9 },
      { id: 'c', name: 'Basket', price: '', orderCount: 0, likeCount: 0 },
      { id: 'd', name: 'Door Mat', price: '20000', orderCount: 0, likeCount: 0, reviewCount: 2, reviewScoreSum: 9 },
    ],
    bagCounts: { a: { count: 7, baggedCount: 7 }, c: { count: 4, baggedCount: 3 } },
    views: { b: 1, c: 12, d: 5 },
  })
  assert.deepStrictEqual(
    rows.map(r => r.id),
    ['a', 'b', 'c', 'd'],
    'orders first, then bags (closer to a sale than a ♥), then likes, then opens',
  )
  const byId = Object.fromEntries(rows.map(r => [r.id, r]))
  assert.ok(byId.a.bags > byId.b.bags && byId.a.orders === byId.b.orders, 'a bag outranks a like — that is the point of the order')
  assert.strictEqual(byId.b.price, 'UGX 30000', 'a bare number is money')
  assert.strictEqual(byId.c.price, '', 'and no price is no price')
  assert.strictEqual(byId.c.bags, 3, 'distinct people, not bag events')
  assert.strictEqual(byId.c.opens, 12)
  assert.strictEqual(byId.d.rating, 4.5, 'the rating is the mean of the stars, not the sum')
  assert.strictEqual(byId.d.reviews, 2)
  assert.strictEqual(byId.a.rating, null, 'an unrated product has no rating at all')
})

check('a missing counter is a zero, and a silly one is never printed', () => {
  const row = mkt.interestRows({ products: [{ id: 'x', name: 'X', likeCount: -5, orderCount: undefined }] })[0]
  assert.strictEqual(row.likes, 0, 'a negative tally is not shown')
  assert.strictEqual(row.bags, 0, 'no bagCounts entry is zero bags, not a crash')
  assert.strictEqual(row.opens, 0)
  assert.strictEqual(row.rating, null, 'and no reviews is no rating')
  assert.strictEqual(mkt.interestRows({ products: [{ id: 'y' }] })[0].name, 'Untitled product')
  assert.deepStrictEqual(mkt.interestRows({ products: [] }), [])
})

check('every row gets a sentence that matches its own numbers', () => {
  const row = over => ({ id: 'p', name: 'P', price: '', image: '', opens: 0, bags: 0, likes: 0, orders: 0, rating: null, reviews: 0, ...over })
  assert.ok(mkt.insightFor(row({ orders: 3 })).includes('3'))
  assert.ok(mkt.insightFor(row({ orders: 1 })).includes('once'))
  assert.ok(mkt.insightFor(row({ bags: 2 })).toLowerCase().includes('delivery'), 'bags without orders is a delivery question')
  assert.ok(mkt.insightFor(row({ likes: 4 })).toLowerCase().includes('delivery'))
  assert.ok(mkt.insightFor(row({ opens: 9 })).toLowerCase().includes('photo'))
  assert.ok(mkt.insightFor(row({})).toLowerCase().includes('nobody'), 'nothing at all is said plainly')
  assert.ok(!mkt.insightFor(row({ opens: 9 })).toLowerCase().includes('sold'), 'no sales talk without a sale')
})


check('store visits are counted from the same documents Analytics reads', () => {
  const now = Date.UTC(2026, 9, 9, 12, 0, 0)
  const day = 24 * 60 * 60 * 1000
  const visits = [
    { createdAt: new Date(now - 1000) },
    { createdAt: { toDate: () => new Date(now - day) } },
    { createdAt: { seconds: Math.floor((now - day * 3) / 1000) } },
    { createdAt: new Date(now - day * 8).toISOString() },
    { createdAt: undefined },
  ]
  assert.deepStrictEqual(mkt.visitSummary(visits, now), { today: 1, week: 3, total: 5 }, 'every timestamp shape StorePage can write')
  const summary = mkt.visitSummary(visits, now)
  assert.strictEqual(mkt.visitsLine(summary), '3 people opened your shop this week')
  assert.strictEqual(mkt.visitsLine({ today: 1, week: 1, total: 1 }), '1 person opened your shop this week', 'the singular, because it gets read out loud')
  assert.strictEqual(mkt.visitsLine({ today: 0, week: 0, total: 0 }), '0 people opened your shop this week')
  assert.deepStrictEqual(mkt.visitSummary([], now), { today: 0, week: 0, total: 0 })
  assert.deepStrictEqual(
    mkt.visitSummary([{ createdAt: new Date(now + day) }], now),
    { today: 0, week: 0, total: 1 },
    'a visitor with a wrong clock cannot inflate today',
  )
})

check('the one green button says what to do next, not five things', () => {
  assert.strictEqual(mkt.nextStep({ productCount: 0, visits: 0, orders: 0 }).kind, 'add')
  assert.strictEqual(mkt.nextStep({ productCount: 3, visits: 0, orders: 0 }).to, '#share-store')
  assert.strictEqual(mkt.nextStep({ productCount: 3, visits: 9, orders: 0 }).to, '#share-product')
  assert.strictEqual(mkt.nextStep({ productCount: 3, visits: 9, orders: 4 }).to, '/orders')
  const label = mkt.nextStep({ productCount: 3, visits: 9, orders: 4 }).label
  assert.ok(label.length > 0 && label.length <= 40, 'a button, not a paragraph')
})

check('a downloaded card has a filename that survives every phone', () => {
  assert.strictEqual(mkt.qrFileName('amina-fabrics'), 'rachett-amina-fabrics-qr.png')
  assert.strictEqual(mkt.qrFileName(''), 'rachett-shop-qr.png')
  assert.strictEqual(mkt.qrFileName('   '), 'rachett-shop-qr.png')
  const name = mkt.productQrFileName('amina-fabrics', 'Ankara Dress / Red')
  assert.strictEqual(name, 'rachett-amina-fabrics-ankara-dress-red-qr.png')
  assert.ok(!/[/\\:*?"<>| ]/.test(name), 'no character a filesystem refuses')
  assert.ok(mkt.qrFileName('Unicode Shop').endsWith('-qr.png'))
  assert.strictEqual(mkt.slugify('a'.repeat(80)).length, 40, 'and it stops at 40 rather than 80')
})

check('the empty states teach instead of showing zeros', () => {
  assert.ok(/share/i.test(mkt.emptyTableLine()), 'the empty table tells them what to do')
  const empty = mkt.noProductsState()
  assert.ok(empty.title && empty.body, 'the empty shop gets a title and a reason')
  assert.ok(/add/i.test(empty.action), 'and a button that says what it does')
})



console.log('\nthe files that have to agree\n')

const marketingPage = read('src/Marketing.tsx')
const sharedStore = read('src/shareStore.ts')

check('the door in the seller nav opens the Marketing page, not the Dashboard', () => {
  const nav = read('src/sellerNav.ts')
  assert.ok(nav.includes("{ label: 'Marketing', path: '/marketing', icon: '📣' }"), 'the row points at the page')
  assert.ok(!/label: 'Marketing', path: '\/dashboard'/.test(nav), 'and no longer at the Dashboard')
})

check('the route exists, is seller-only, and the Dashboard block is a door to it', () => {
  const app = read('src/App.tsx')
  assert.ok(app.includes("import Marketing from './Marketing.tsx'"))
  assert.ok(
    /<Route path="\/marketing" element=\{sellerOnly \? <Marketing \/> : <Navigate to="\/" \/>\} \/>/.test(app),
    'seller-only, exactly like Analytics',
  )
  assert.ok(read('src/Dashboard.tsx').includes("navigate('/marketing')"), 'and reachable from Grow your sales')
})

check('every copy of the store link goes through one helper, so every copy is counted', () => {
  for (const file of ['src/Dashboard.tsx', 'src/Sidebar.tsx']) {
    const text = read(file)
    assert.ok(text.includes("from './shareStore'"), `${file} imports the shared helper`)
    assert.ok(text.includes('copyStoreLink('), `${file} copies through it`)
    assert.ok(!text.includes('navigator.clipboard.writeText(storeLink)'), `${file} has no raw clipboard call left`)
  }
  assert.ok(marketingPage.includes("from './shareStore'"), 'and so does the Marketing page')
  assert.ok(!marketingPage.includes('navigator.clipboard'), 'which never touches the clipboard directly')
})

check('the four events that had no call site now have one', () => {
  assert.ok(sharedStore.includes("trackEvent('store_link_copied'"), 'store_link_copied')
  assert.ok(sharedStore.includes("trackEvent('store_shared'"), 'store_shared')
  assert.ok(sharedStore.includes("trackEvent('qr_viewed'"), 'qr_viewed')
  assert.ok(sharedStore.includes("trackEvent('product_shared'"), 'product_shared')
})

check('every event the page fires is declared, with exactly the properties it sends', () => {
  const declared = new Map()
  for (const match of read('src/analytics/taxonomy.ts').matchAll(/^ {2}([a-z_]+): \[([^\]]*)\]/gm)) {
    declared.set(match[1], match[2].split(',').map(part => part.trim().replace(/'/g, '')).filter(Boolean))
  }
  const calls = []
  for (const file of ['src/shareStore.ts', 'src/ProductSheet.tsx']) {
    for (const match of read(file).matchAll(/trackEvent\(\s*'([a-z_]+)'\s*(?:,\s*\{([^}]*)\})?/g)) {
      calls.push({
        file,
        name: match[1],
        keys: (match[2] || '').split(',').map(key => key.split(':')[0].trim()).filter(Boolean),
      })
    }
  }
  assert.ok(calls.length >= 9, `found the call sites (${calls.length})`)
  for (const call of calls) {
    assert.ok(declared.has(call.name), `${call.name} (${call.file}) is not in the taxonomy`)
    for (const key of call.keys) {
      assert.ok(declared.get(call.name).includes(key), `${call.name}.${key} (${call.file}) is not an allowed property`)
    }
  }
  for (const name of ['marketing_opened', 'product_link_copied', 'qr_downloaded', 'qr_printed', 'promote_card_used']) {
    assert.ok(declared.has(name), `${name} is missing from the taxonomy`)
    assert.ok(calls.some(call => call.name === name), `${name} has no call site at all`)
  }
})

check('the rules keep the open counter honest', () => {
  const rules = read('firestore.rules')
  const start = rules.indexOf('match /productViews/{productId}')
  assert.ok(start > 0, 'the collection is in the rules at all')
  const block = rules.slice(start)
  const body = block.slice(0, block.indexOf('\n    }'))
  assert.ok(body.includes('allow read: if true'), 'public to read — it is one integer')
  assert.ok(body.includes('allow create: if request.auth != null'), 'signed in to start one')
  assert.ok(body.includes('request.resource.data.count == 1'), 'a create is a 1, never a number somebody chose')
  assert.ok(body.includes("hasOnly(['count', 'updatedAt'])"), 'nothing else may move')
  assert.ok(body.includes('request.resource.data.count == resource.data.count + 1'), 'and it only ever goes up')
  assert.ok(body.includes('allow delete: if false'), 'a counter cannot be un-counted')
})

check('the hero number has a source that is still being written', () => {
  const storePage = read('src/StorePage.tsx')
  assert.ok(storePage.includes("collection(db, 'sellers', docData.id, 'visits')"), 'StorePage still records a visit')
  assert.ok(storePage.includes('auth.currentUser?.uid !== docData.id'), 'and still skips the seller\'s own visit')
  const sheet = read('src/ProductSheet.tsx')
  assert.ok(sheet.includes("from './productViews'"))
  assert.ok(sheet.includes('countProductView(product?.id'), 'the product sheet counts an open')
  assert.ok(sheet.includes("trackEvent('product_sheet_opened'"), 'in the same breath as the event it always fired')
})

check('the docs describe what actually shipped', () => {
  const analytics = read('ANALYTICS.md')
  const data = read('DATA_COLLECTION.md')
  const names = [
    'store_link_copied', 'store_shared', 'qr_viewed', 'product_shared',
    'marketing_opened', 'product_link_copied', 'qr_downloaded', 'qr_printed', 'promote_card_used',
  ]
  for (const name of names) {
    const row = analytics.split('\n').find(line => line.startsWith(`| \`${name}\``))
    assert.ok(row, `${name} has no row in ANALYTICS.md`)
    assert.ok(row.includes('✅'), `${name} is still marked as not built`)
  }
  assert.ok(analytics.includes('productViews'), 'the funnel line names the counter')
  assert.ok(data.includes('productViews/{productId}'), 'DATA_COLLECTION names the collection')
  assert.ok(data.includes('cannot be un-counted'), 'and says the one thing that matters about it')
  assert.ok(data.includes('sellers/{uid}/visits'), 'the visits row is there too')
})

check('the page keeps its promises about honesty', () => {
  assert.ok(marketingPage.includes('Planned'), 'the offer card says it is planned')
  assert.ok(/not built yet/i.test(marketingPage), 'and says so in words')
  const offers = marketingPage.slice(marketingPage.indexOf('id="offers"'), marketingPage.indexOf('id="whats-working"'))
  assert.ok(offers.length > 0, 'the offers section is there')
  assert.ok(!offers.includes('onClick'), 'and is not a button pretending to work')
  for (const id of ['share-store', 'your-qr', 'share-product', 'promote', 'offers', 'whats-working']) {
    assert.ok(marketingPage.includes(`id="${id}"`), `the ${id} section is anchored — nextStep scrolls to it`)
  }
  assert.ok(marketingPage.includes('emptyTableLine()'), 'and an empty table teaches instead of showing zeros')
})

console.log(`\n${checks} checks, 0 failures.`)
console.log('The QR encoder is verified against the spec and read back by this file\'s own decoder:')
console.log('all ten versions, syndromes zero, both format copies in place, and the mask the rules pick.')
console.log('ONE THING NO SCRIPT CAN DO: scan a printed card with a real phone. Do that once, by hand.')

