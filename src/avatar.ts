/**
 * Shop identity that is never empty.
 *
 * Most shops here are created on a phone, with no logo to hand. An empty slot where a
 * shop's face should be reads as *broken*, so `initialOf` + `avatarColor` turn the shop
 * name itself into a letter on a colour that is theirs: the same letter and the same
 * colour on every device, forever, with no upload, no account and no network.
 *
 * Pure on purpose (no React, no DOM) so Node can check it — see `_avatar_check.cjs`.
 */

/**
 * Colours a shop's letter tile may wear. All are dark enough for white text to pass
 * 4.5:1 (WCAG AA), which is the only reason this list is not just "nice colours" —
 * `_avatar_check.cjs` measures the contrast instead of trusting the eye.
 */
export const AVATAR_PALETTE = [
  '#1d4ed8', // blue
  '#b91c1c', // red
  '#047857', // emerald
  '#7e22ce', // purple
  '#b45309', // amber
  '#0f766e', // teal
  '#be185d', // pink
  '#4338ca', // indigo
] as const

/** The letter colour on every palette tile. */
export const AVATAR_TEXT = '#ffffff'

/**
 * The one character that goes on the tile: the first letter or digit of the name.
 * Punctuation, quotes and emoji are skipped (`"Aisha's Fabrics 🧵"` → `A`), and a name
 * with neither letter nor digit still gets something printable instead of a blank circle.
 */
export function initialOf(name: string): string {
  const match = (name || '').normalize('NFC').match(/[\p{L}\p{N}]/u)
  return match ? match[0].toUpperCase() : '?'
}

/** djb2 — small, allocation-free, and stable across engines. Only ever used mod the palette. */
function hashName(key: string): number {
  let hash = 5381
  for (const char of key) {
    hash = ((hash << 5) + hash + char.codePointAt(0)!) >>> 0
  }
  return hash >>> 0
}

/**
 * The tile colour for a shop. Case and spacing are ignored, so "Aisha Fabrics",
 * "aisha fabrics" and " Aisha  Fabrics " are one shop wearing one colour — and renaming
 * a shop gives it a new colour, which is a small, honest signal that something changed.
 */
export function avatarColor(name: string): { bg: string; fg: string } {
  const key = (name || '').normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ')
  return { bg: AVATAR_PALETTE[hashName(key) % AVATAR_PALETTE.length], fg: AVATAR_TEXT }
}
