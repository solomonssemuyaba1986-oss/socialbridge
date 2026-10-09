/**
 * A QR code, built here instead of borrowed.
 *
 * Why not a dependency: the only thing rachett ever encodes is its own store links, on a phone, in
 * a shop, often with no signal. `npm i qrcode` would add a package to audit and a bundle to ship for
 * one fixed job, and a *hosted* image service (the other easy way out) would mean a seller's link
 * leaving the device to be drawn by somebody else's server. So: byte-mode QR, error-correction level
 * **Q**, versions 1–10, no imports at all.
 *
 * Level Q is the deliberate choice — it survives roughly a quarter of the symbol being damaged, which
 * is what lets `StoreQrCard` put the rachett mark in the middle (`logoRatio` in `qrCanvas.ts`) and
 * still scan. It also means a printed card that has spent a month taped to a parcel survives a scuff.
 *
 * Verified by `_marketing_check.cjs`, which does not trust this file: it recomputes the module count
 * per version from the spec's own formula, re-derives every Reed–Solomon block and checks the
 * syndromes are zero, re-implements the four mask-penalty rules and insists the mask chosen here is
 * the one with the lowest score.
 *
 * WHAT THIS FILE IS NOT: a general encoder. It speaks one mode (bytes), one level (Q), and throws
 * rather than silently truncating when the text does not fit. A QR that quietly drops half a URL is
 * worse than an error.
 */

/** ── Field arithmetic: GF(256), primitive polynomial x⁸ + x⁴ + x³ + x² + 1 (0x11D) ──────────── */

const GF_EXP = new Uint8Array(512)
const GF_LOG = new Uint8Array(256)

{
  let x = 1
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x
    GF_LOG[x] = i
    x <<= 1
    if (x & 0x100) x ^= 0x11d
  }
  // Doubling the table past 255 saves a modulo on every multiply below.
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255]
}

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0
  return GF_EXP[GF_LOG[a] + GF_LOG[b]]
}

/**
 * The Reed–Solomon generator for `ecLen` codewords: ∏ (x − αⁱ), i = 0…ecLen−1.
 * Highest power first, leading coefficient always 1.
 */
export function rsDivisor(ecLen: number): number[] {
  let poly = [1]
  for (let i = 0; i < ecLen; i++) {
    const next = new Array<number>(poly.length + 1).fill(0)
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j]
      next[j + 1] ^= gfMul(poly[j], GF_EXP[i])
    }
    poly = next
  }
  return poly
}

/** The error-correction codewords for one block — the remainder of `data·x^ecLen ÷ divisor`. */
export function rsRemainder(data: number[], divisor: number[]): number[] {
  const work = new Uint8Array(data.length + divisor.length - 1)
  work.set(data, 0)
  for (let i = 0; i < data.length; i++) {
    const factor = work[i]
    if (factor === 0) continue
    for (let j = 0; j < divisor.length; j++) work[i + j] ^= gfMul(divisor[j], factor)
  }
  return Array.from(work.slice(data.length))
}

/** ── The tables, straight from the spec (Annex A) ───────────────────────────────────────────── */

export interface QrEcGroup {
  blocks: number
  dataPerBlock: number
}

export interface QrEcSpec {
  /** Error-correction codewords per block — the same for every block in a symbol. */
  ecPerBlock: number
  /** Group 1 blocks first, then group 2 (which carry one data codeword more). */
  groups: QrEcGroup[]
}

/** Level Q, versions 1–10. Nothing here is derived: these are the spec's numbers. */
export const QR_EC_Q: QrEcSpec[] = [
  { ecPerBlock: 13, groups: [{ blocks: 1, dataPerBlock: 13 }] },
  { ecPerBlock: 22, groups: [{ blocks: 1, dataPerBlock: 22 }] },
  { ecPerBlock: 18, groups: [{ blocks: 2, dataPerBlock: 17 }] },
  { ecPerBlock: 26, groups: [{ blocks: 2, dataPerBlock: 24 }] },
  { ecPerBlock: 18, groups: [{ blocks: 2, dataPerBlock: 15 }, { blocks: 2, dataPerBlock: 16 }] },
  { ecPerBlock: 24, groups: [{ blocks: 4, dataPerBlock: 19 }] },
  { ecPerBlock: 18, groups: [{ blocks: 2, dataPerBlock: 14 }, { blocks: 4, dataPerBlock: 15 }] },
  { ecPerBlock: 22, groups: [{ blocks: 4, dataPerBlock: 18 }, { blocks: 2, dataPerBlock: 19 }] },
  { ecPerBlock: 20, groups: [{ blocks: 4, dataPerBlock: 16 }, { blocks: 4, dataPerBlock: 17 }] },
  { ecPerBlock: 24, groups: [{ blocks: 6, dataPerBlock: 19 }, { blocks: 2, dataPerBlock: 20 }] },
]

/** Every codeword the symbol holds — data plus error correction. */
export const QR_TOTAL_CODEWORDS = [26, 44, 70, 100, 134, 172, 196, 242, 292, 346]

/** Bits left over after the last whole codeword — written as light modules. Versions 1–10. */
export const QR_REMAINDER_BITS = [0, 7, 7, 7, 7, 7, 0, 0, 0, 0]

/** Where the alignment patterns sit, per version. Version 7's `22` is the spec's famous exception. */
export const QR_ALIGNMENT_CENTERS: number[][] = [
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
]

/** The two bytes the spec pads with, alternating, when the data does not fill the symbol. */
const PAD_BYTES = [0xec, 0x11]

export const MIN_QR_VERSION = 1
export const MAX_QR_VERSION = QR_EC_Q.length

/** Version 1 is 21×21, and every version after it grows the square by four modules a side. */
export function qrSize(version: number): number {
  return version * 4 + 17
}

/** Byte mode spends 4 bits on the mode and 4 on the length — 8 bits up to version 9, 16 after. */
export function byteModeCountBits(version: number): number {
  return version <= 9 ? 8 : 16
}

export function dataCodewordCount(version: number): number {
  const spec = QR_EC_Q[version - 1]
  return spec.groups.reduce((total, group) => total + group.blocks * group.dataPerBlock, 0)
}

/** How many bytes of text fit in this version, at level Q. */
export function byteCapacity(version: number): number {
  return Math.floor((dataCodewordCount(version) * 8 - 4 - byteModeCountBits(version)) / 8)
}

/** The smallest version this text fits in, or null when it needs more than `maxVersion`. */
export function pickVersion(byteLength: number, minVersion = MIN_QR_VERSION, maxVersion = MAX_QR_VERSION): number | null {
  for (let version = Math.max(1, minVersion); version <= Math.min(MAX_QR_VERSION, maxVersion); version++) {
    if (byteLength <= byteCapacity(version)) return version
  }
  return null
}

/** UTF-8, by hand: a store link is ASCII, but a shop name with an accent in it should still work. */
export function toUtf8Bytes(text: string): number[] {
  const out: number[] = []
  for (let i = 0; i < text.length; i++) {
    let code = text.charCodeAt(i)
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00)
        i++
      }
    }
    if (code < 0x80) out.push(code)
    else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 63))
    else if (code < 0x10000) out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63))
    else out.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63))
  }
  return out
}

/** ── The bit stream ─────────────────────────────────────────────────────────────────────────── */

function pushBits(bits: number[], value: number, count: number): void {
  for (let i = count - 1; i >= 0; i--) bits.push((value >> i) & 1)
}

/**
 * Mode + length + the bytes themselves, terminated, padded to the byte boundary and then filled with
 * the spec's alternating pad bytes — the exact payload a scanner will read back.
 */
export function dataCodewords(bytes: number[], version: number): number[] {
  const capacityBits = dataCodewordCount(version) * 8
  const bits: number[] = []
  pushBits(bits, 0b0100, 4) // byte mode
  pushBits(bits, bytes.length, byteModeCountBits(version))
  for (const byte of bytes) pushBits(bits, byte, 8)

  const terminator = Math.min(4, capacityBits - bits.length)
  for (let i = 0; i < terminator; i++) bits.push(0)
  while (bits.length % 8 !== 0) bits.push(0)

  const out: number[] = []
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j]
    out.push(byte)
  }
  for (let pad = 0; out.length < capacityBits / 8; pad++) out.push(PAD_BYTES[pad % 2])
  return out
}

export interface QrBlockLayout {
  dataLen: number
  short: boolean
}

/** How the data codewords are split into blocks — short blocks first, exactly as the spec lays out. */
export function blockLayout(version: number): QrBlockLayout[] {
  const spec = QR_EC_Q[version - 1]
  const raw = QR_TOTAL_CODEWORDS[version - 1]
  const blocks: QrBlockLayout[] = []
  for (const group of spec.groups) {
    for (let i = 0; i < group.blocks; i++) blocks.push({ dataLen: group.dataPerBlock, short: false })
  }
  const shortCount = blocks.length - (raw % blocks.length)
  for (let i = 0; i < blocks.length; i++) blocks[i].short = i < shortCount
  return blocks
}

/**
 * Error-correct every block, then interleave: data codewords column-wise across the blocks, then the
 * error codewords the same way. Interleaving is what makes a scratch survivable — a damaged patch
 * spreads across blocks instead of destroying one.
 */
export function eccAndInterleave(data: number[], version: number): number[] {
  const spec = QR_EC_Q[version - 1]
  const blocks = blockLayout(version)
  const divisor = rsDivisor(spec.ecPerBlock)
  const shortLen = Math.floor(QR_TOTAL_CODEWORDS[version - 1] / blocks.length)

  const parts: number[][] = []
  let taken = 0
  blocks.forEach(block => {
    const chunk = data.slice(taken, taken + block.dataLen)
    taken += block.dataLen
    const ecc = rsRemainder(chunk, divisor)
    // Short blocks get a placeholder so every part is the same length; interleaving skips it below.
    parts.push(block.short ? chunk.concat([0], ecc) : chunk.concat(ecc))
  })

  const out: number[] = []
  const dataPerBlock = shortLen - spec.ecPerBlock
  for (let i = 0; i < parts[0].length; i++) {
    for (let j = 0; j < parts.length; j++) {
      if (i === dataPerBlock && blocks[j].short) continue
      out.push(parts[j][i])
    }
  }
  return out
}

/** ── The symbol ─────────────────────────────────────────────────────────────────────────────── */

export interface QrMatrix {
  version: number
  size: number
  /** Dark is true. */
  modules: boolean[][]
  /** True where a function pattern lives — data may never be written there. */
  reserved: boolean[][]
}

function grid(size: number): boolean[][] {
  return Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
}

/**
 * Finder patterns and their separators, the timing lines, the alignment patterns, the dark module,
 * and the cells the format/version information will occupy (reserved now, drawn last).
 */
export function buildFunctionPatterns(version: number): QrMatrix {
  const size = qrSize(version)
  const modules = grid(size)
  const reserved = grid(size)

  const set = (row: number, col: number, dark: boolean) => {
    if (row < 0 || col < 0 || row >= size || col >= size) return
    modules[row][col] = dark
    reserved[row][col] = true
  }
  const reserve = (row: number, col: number) => {
    if (row < 0 || col < 0 || row >= size || col >= size) return
    reserved[row][col] = true
  }

  // A finder is a 3×3 block inside a ring, plus the light separator that keeps it isolated.
  const finder = (row: number, col: number) => {
    for (let dy = -1; dy <= 7; dy++) {
      for (let dx = -1; dx <= 7; dx++) {
        const dist = Math.max(Math.abs(dx - 3), Math.abs(dy - 3))
        set(row + dy, col + dx, dist !== 2 && dist !== 4)
      }
    }
  }
  finder(0, 0)
  finder(0, size - 7)
  finder(size - 7, 0)

  // Timing: one alternating line each way, which is how a scanner measures module size.
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0)
    set(i, 6, i % 2 === 0)
  }

  const centers = QR_ALIGNMENT_CENTERS[version - 1]
  const last = centers.length - 1
  for (let i = 0; i < centers.length; i++) {
    for (let j = 0; j < centers.length; j++) {
      // The three corners already hold a finder.
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue
      const row = centers[i]
      const col = centers[j]
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          set(row + dy, col + dx, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
        }
      }
    }
  }

  // Format information: 15 cells twice over, skipping the timing lines.
  for (let i = 0; i <= 8; i++) {
    reserve(8, i)
    reserve(i, 8)
  }
  for (let i = 0; i < 8; i++) reserve(8, size - 1 - i)
  for (let i = 0; i < 7; i++) reserve(size - 1 - i, 8)
  reserve(size - 8, 8)

  // Version information (versions 7 and up): 18 cells twice over.
  if (version >= 7) {
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3)
      const b = Math.floor(i / 3)
      reserve(b, a)
      reserve(a, b)
    }
  }

  return { version, size, modules, reserved }
}

/** The eight spec masks, in (row, col) terms. Applied to data modules only — never to a finder. */
export function maskFormula(mask: number, row: number, col: number): boolean {
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

/** How many modules the data and error codewords get — the symbol minus every function pattern. */
export function dataModuleCount(version: number): number {
  const { reserved } = buildFunctionPatterns(version)
  let free = 0
  for (const row of reserved) for (const cell of row) if (!cell) free++
  return free
}

/**
 * Writes the bit stream into the symbol: two columns at a time, right to left, zigzagging up and
 * down, skipping the timing column and every function pattern, masked as it goes.
 * Returns how many modules were written — which is exactly the codewords plus the remainder bits,
 * and is how a caller finds out that the geometry and the tables disagree.
 */
export function placeData(matrix: QrMatrix, codewords: number[], mask: number): number {
  const { size, modules, reserved } = matrix
  const totalBits = codewords.length * 8
  let bit = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5 // the timing column is never part of a pair
    const upward = ((right + 1) & 2) === 0
    for (let step = 0; step < size; step++) {
      for (let j = 0; j < 2; j++) {
        const col = right - j
        const row = upward ? size - 1 - step : step
        if (reserved[row][col]) continue
        // Past the last codeword the spec wants light modules — the remainder bits.
        const dark = bit < totalBits ? ((codewords[bit >> 3] >> (7 - (bit & 7))) & 1) === 1 : false
        modules[row][col] = maskFormula(mask, row, col) ? !dark : dark
        bit++
      }
    }
  }
  return bit
}

/** The 15 format bits: level Q (0b11), the mask, and the BCH(15,5) that protects them. */
export function formatBits(mask: number): number {
  const data = (0b11 << 3) | (mask & 7)
  let rem = data
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
  return ((data << 10) | rem) ^ 0x5412
}

/** The 18 version bits (versions 7 and up): the version, and the BCH(18,6) that protects it. */
export function versionBits(version: number): number {
  let rem = version
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
  return (version << 12) | rem
}

/** Format information, written twice: once beside the top-left finder, once split along the edges. */
export function drawFormatInfo(modules: boolean[][], size: number, mask: number): void {
  const bits = formatBits(mask)
  const bit = (i: number) => ((bits >> i) & 1) === 1
  for (let i = 0; i <= 5; i++) modules[8][i] = bit(i)
  modules[8][7] = bit(6)
  modules[8][8] = bit(7)
  modules[7][8] = bit(8)
  for (let i = 9; i < 15; i++) modules[14 - i][8] = bit(i)
  for (let i = 0; i < 8; i++) modules[8][size - 1 - i] = bit(i)
  for (let i = 8; i < 15; i++) modules[size - 15 + i][8] = bit(i)
  modules[size - 8][8] = true // the dark module: dark in every QR code ever printed
}

export function drawVersionInfo(modules: boolean[][], size: number, version: number): void {
  const bits = versionBits(version)
  for (let i = 0; i < 18; i++) {
    const dark = ((bits >> i) & 1) === 1
    const a = size - 11 + (i % 3)
    const b = Math.floor(i / 3)
    modules[b][a] = dark
    modules[a][b] = dark
  }
}

/**
 * The spec's four penalty rules, which decide how hard a scanner has to work. Lower is better:
 * long runs of one colour, 2×2 blocks, anything that looks like a finder, and too much dark.
 */
export function maskPenalty(modules: boolean[][]): number {
  const size = modules.length
  let score = 0

  // 1 — runs of five or more, in both directions.
  for (let i = 0; i < size; i++) {
    let runRow = 1
    let runCol = 1
    for (let j = 1; j < size; j++) {
      runRow = modules[i][j] === modules[i][j - 1] ? runRow + 1 : 1
      if (runRow === 5) score += 3
      else if (runRow > 5) score += 1
      runCol = modules[j][i] === modules[j - 1][i] ? runCol + 1 : 1
      if (runCol === 5) score += 3
      else if (runCol > 5) score += 1
    }
  }

  // 2 — same-colour 2×2 blocks.
  for (let row = 0; row < size - 1; row++) {
    for (let col = 0; col < size - 1; col++) {
      const cell = modules[row][col]
      if (cell === modules[row][col + 1] && cell === modules[row + 1][col] && cell === modules[row + 1][col + 1]) score += 3
    }
  }

  // 3 — a finder pattern with four light modules on one side, either way round.
  const before = [true, false, true, true, true, false, true, false, false, false, false]
  const after = [false, false, false, false, true, false, true, true, true, false, true]
  for (let i = 0; i < size; i++) {
    for (let j = 0; j + 11 <= size; j++) {
      let rowBefore = true
      let rowAfter = true
      let colBefore = true
      let colAfter = true
      for (let k = 0; k < 11; k++) {
        const rowCell = modules[i][j + k]
        if (rowCell !== before[k]) rowBefore = false
        if (rowCell !== after[k]) rowAfter = false
        const colCell = modules[j + k][i]
        if (colCell !== before[k]) colBefore = false
        if (colCell !== after[k]) colAfter = false
      }
      if (rowBefore) score += 40
      if (rowAfter) score += 40
      if (colBefore) score += 40
      if (colAfter) score += 40
    }
  }

  // 4 — how far the dark/light balance is from half.
  const total = size * size
  let dark = 0
  for (const row of modules) for (const cell of row) if (cell) dark++
  score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10

  return score
}

export interface QrCode {
  version: number
  mask: number
  size: number
  /** `modules[row][col]`, dark = true. Quiet zone not included — that is the renderer's job. */
  modules: boolean[][]
}

/** One symbol, with a mask chosen on purpose rather than guessed at. */
export function buildQr(text: string, version: number, mask: number): boolean[][] {
  const codewords = eccAndInterleave(dataCodewords(toUtf8Bytes(text), version), version)
  const matrix = buildFunctionPatterns(version)
  placeData(matrix, codewords, mask)
  drawFormatInfo(matrix.modules, matrix.size, mask)
  if (version >= 7) drawVersionInfo(matrix.modules, matrix.size, version)
  return matrix.modules
}

/**
 * The whole thing: the smallest version the text fits in, all eight masks built, and the one the
 * spec's penalty rules like best. Ties go to the lower mask number, so the result is deterministic.
 *
 * Throws rather than truncating. A seller's QR that opens the wrong shop is worse than a message
 * saying the link is too long.
 */
export function encodeQr(text: string, minVersion = MIN_QR_VERSION): QrCode {
  const bytes = toUtf8Bytes(text)
  const version = pickVersion(bytes.length, minVersion)
  if (version === null) {
    throw new RangeError(`Too long for a version-${MAX_QR_VERSION} QR code at level Q (${byteCapacity(MAX_QR_VERSION)} bytes, got ${bytes.length}).`)
  }

  let bestMask = 0
  let bestModules = buildQr(text, version, 0)
  let bestScore = maskPenalty(bestModules)
  for (let mask = 1; mask < 8; mask++) {
    const modules = buildQr(text, version, mask)
    const score = maskPenalty(modules)
    if (score < bestScore) {
      bestMask = mask
      bestModules = modules
      bestScore = score
    }
  }
  return { version, mask: bestMask, size: qrSize(version), modules: bestModules }
}
