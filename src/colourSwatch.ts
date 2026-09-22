/**
 * "Blue" is a word. A blue circle is a colour.
 *
 * Sellers type a colour into a text box in ProductsPage ("Black", "Sky blue", "Maroon"), and until
 * now a buyer saw those words as plain pills — which is both harder to scan and easy to get wrong.
 * This turns the word into something the eye can check at a glance, on a dark background.
 *
 * Pure on purpose (no React, no DOM): `_colour_check.cjs` measures the matches and the contrast.
 */

/** What a colour word means, in hex. Longer phrases are matched first ("sky blue" before "blue"). */
const SOLIDS: Record<string, string> = {
  black: '#0a0a0a',
  'off black': '#1c1c1c',
  charcoal: '#36454f',
  grey: '#9aa0a6',
  gray: '#9aa0a6',
  silver: '#c0c4c8',
  white: '#ffffff',
  'off white': '#faf0e6',
  ivory: '#fffff0',
  cream: '#fffdd0',
  beige: '#f5f5dc',
  nude: '#e3bc9a',
  tan: '#d2b48c',
  sand: '#c2b280',
  khaki: '#c3b091',
  camel: '#c19a6b',
  brown: '#6d4c41',
  chocolate: '#5d4037',
  coffee: '#4e342e',
  red: '#d32f2f',
  'dark red': '#8b0000',
  maroon: '#7b1f1f',
  wine: '#722f37',
  burgundy: '#800020',
  pink: '#e91e63',
  'hot pink': '#ff69b4',
  'light pink': '#f8bbd0',
  rose: '#f4c2c2',
  peach: '#ffcba4',
  orange: '#f57c00',
  'dark orange': '#e65100',
  yellow: '#fdd835',
  'light yellow': '#fff59d',
  gold: '#d4af37',
  mustard: '#d4a017',
  green: '#2e7d32',
  'dark green': '#1b5e20',
  'light green': '#a5d6a7',
  lime: '#9acd32',
  olive: '#808000',
  mint: '#98ff98',
  teal: '#00897b',
  turquoise: '#40e0d0',
  cyan: '#00bcd4',
  blue: '#1976d2',
  'dark blue': '#0d47a1',
  'light blue': '#90caf9',
  'sky blue': '#87ceeb',
  sky: '#87ceeb',
  'royal blue': '#4169e1',
  'baby blue': '#89cff0',
  navy: '#1a237e',
  denim: '#1565c0',
  indigo: '#3949ab',
  purple: '#7b1fa2',
  'light purple': '#ce93d8',
  violet: '#8a2be2',
  lilac: '#c8a2c8',
  lavender: '#b57edc',
  magenta: '#d500f9',
}

/** Fabrics and prints that are not one colour — shown as a mix, never as a wrong swatch. */
const MULTI = [
  'multi', 'multicolour', 'multicolor', 'multi colour', 'multi color', 'assorted', 'mixed',
  'pattern', 'patterned', 'printed', 'print', 'stripe', 'striped', 'floral', 'tie dye',
  'tie-dye', 'rainbow', 'camo', 'camouflage', 'leopard', 'animal print', 'checkered',
  'checked', 'plaid', 'polka', 'tartan', 'ombre', 'tie and dye',
]

export type Swatch =
  | { kind: 'solid'; hex: string; /** Needs a ring to be visible on a dark page. */ ring: boolean }
  | { kind: 'multi' }
  | null

/** Lowercase, punctuation-tidied, single-spaced — "Sky-Blue " and "sky  blue" are one colour. */
function normalise(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Relative luminance (WCAG) — used only to decide whether a swatch needs an outline. */
function luminance(hex: string): number {
  const channels = [1, 3, 5]
    .map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)))
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

/** The hex for a colour word, or null when we genuinely do not know it. */
export function hexFor(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const key = normalise(raw)
  if (!key) return null
  if (SOLIDS[key]) return SOLIDS[key]

  // Longest phrase wins, so "sky blue" is never read as "blue".
  let best: string | null = null
  let bestLength = 0
  for (const [name, hex] of Object.entries(SOLIDS)) {
    if (name.length > bestLength && new RegExp(`(^| )${name}( |$)`).test(key)) {
      best = hex
      bestLength = name.length
    }
  }
  return best
}

/**
 * What to draw for a colour word: a solid circle, a "mix" marker, or nothing at all (in which case
 * the caller shows the word alone — better a word than a confident wrong colour).
 */
export function swatchFor(raw: unknown): Swatch {
  if (typeof raw !== 'string') return null
  const key = normalise(raw)
  if (!key) return null

  const hex = hexFor(raw)
  if (hex) {
    const l = luminance(hex)
    // Near-white and near-black would otherwise disappear into the page.
    return { kind: 'solid', hex, ring: l > 0.75 || l < 0.06 }
  }

  // Only call it a mix when a fabric word is what is left over.
  for (const word of MULTI) {
    if (new RegExp(`(^| )${word}( |$)`).test(key)) return { kind: 'multi' }
  }
  return null
}

/** Is this colour readable as text *on* its own swatch? Used for the tick inside a dark circle. */
export function textOn(hex: string): string {
  return luminance(hex) > 0.45 ? '#000000' : '#ffffff'
}

