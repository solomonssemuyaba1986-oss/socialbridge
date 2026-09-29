/**
 * Data saver — the setting, the arithmetic, and the words.
 *
 * rachett is used on bundles that run out. A feed that fetches 400px photos for every card is a feed
 * that costs money to scroll, and the buyer cannot see why their bundle vanished. So the app keeps a
 * single, visible setting — **on by default** — that decides three things and nothing else:
 *
 *   - how wide a photo is asked for (`imageBudget` → `cloudinaryUrl` rewrites the URL);
 *   - how many products one page of a feed asks for;
 *   - whether below-the-fold photos are allowed to load eagerly.
 *
 * Everything else — the prices, the shops, the chat, the pay button — is byte-for-byte the same. A
 * cheaper app that shows less than the truth is not cheaper, it is a different app.
 *
 * Two rules this file keeps:
 *
 *  1. **The device has a say.** `navigator.connection.saveData` and a slow `effectiveType` are the
 *     phone telling us it is already being careful; that is a fact about the connection, not a
 *     preference, and it is reported as such (`SaverState.source`), never as a choice the person
 *     did not make.
 *  2. **A saving we claim is a saving we can compute.** The bytes saved are estimated from a
 *     documented table of what a Cloudinary photo actually weighs at each width (`servedBytes`),
 *     against one large original (`FULL_PHOTO_BYTES`). The UI says "about", because an estimate
 *     dressed as a measurement is the kind of thing this codebase refuses to do.
 *
 * Pure (no React, no Firebase, no `navigator`) so all of it is checked in Node:
 * `_data_saver_check.cjs`.
 */

/** Where the person's own choice is kept. Device-local: it is about this phone's bundle. */
export const SAVER_STORAGE_KEY = 'rachett_data_saver'

/** `null` means they have never touched the switch — which is not the same as "off". */
export type SaverChoice = 'on' | 'off' | null

/** The bits of `navigator.connection` we read. Optional everywhere: Safari has none of it. */
export interface NetworkLike {
  saveData?: boolean
  /** `slow-2g` · `2g` · `3g` · `4g`, as Chromium reports it. */
  effectiveType?: string
  /** Megabits per second, when the browser is willing to guess. */
  downlink?: number
}

/** Why the saver is where it is: their decision, their phone's, or our default. */
export type SaverSource = 'you' | 'network' | 'default'

export interface SaverState {
  on: boolean
  source: SaverSource
  /** One plain sentence, shown under the switch. Never a scolding. */
  reason: string
}

/** Below this many Mbps a connection is treated as one worth being careful on. */
export const SLOW_DOWNLINK_MBPS = 1.5

/**
 * A stored value, back as a choice. Anything we did not write (a hand-edited localStorage, an old
 * build) reads as "never chose" rather than silently turning a preference on or off.
 */
export function readSaverChoice(raw: unknown): SaverChoice {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (value === 'on' || value === 'true' || value === '1') return 'on'
  if (value === 'off' || value === 'false' || value === '0') return 'off'
  return null
}

/**
 * Is the phone itself telling us to be careful? `saveData` is the OS-level "Data Saver" switch and
 * outranks everything; a 2G/3G connection needs no permission from anyone.
 */
export function networkIsThrifty(net: NetworkLike | null | undefined): boolean {
  if (!net) return false
  if (net.saveData === true) return true
  const type = String(net.effectiveType || '').toLowerCase()
  if (type === 'slow-2g' || type === '2g' || type === '3g') return true
  const downlink = Number(net.downlink)
  return Number.isFinite(downlink) && downlink > 0 && downlink < SLOW_DOWNLINK_MBPS
}

/** The sentence that explains a slow connection, naming the reason we actually have. */
function thriftyReason(net: NetworkLike): string {
  if (net.saveData === true) {
    return 'Your phone\u2019s Data Saver is on, so rachett is keeping photos small and pages short to match.'
  }
  const type = String(net.effectiveType || '').toLowerCase()
  if (type === 'slow-2g' || type === '2g') {
    return 'Your connection is on 2G, so rachett is sending the smallest version of every page.'
  }
  if (type === '3g') {
    return 'Your connection is on 3G, so rachett is keeping photos small and pages short.'
  }
  return 'Your connection is slow, so rachett is keeping photos small and pages short.'
}

/** The setting as it stands right now. Left alone, it is **on** — the cheap path is the default. */
export function resolveDataSaver(choice: SaverChoice, net?: NetworkLike | null): SaverState {
  if (choice === 'on') {
    return { on: true, source: 'you', reason: 'On. Photos come small and pages come short — turn it off any time.' }
  }
  if (choice === 'off') {
    return { on: false, source: 'you', reason: 'Off. Every photo comes at full size — this uses more data.' }
  }
  if (networkIsThrifty(net)) {
    return { on: true, source: 'network', reason: thriftyReason(net || {}) }
  }
  return {
    on: true,
    source: 'default',
    reason: 'On by default: rachett sends smaller photos and shorter pages unless you say otherwise.',
  }
}

// ─── what the setting actually changes ──────────────────────────────────────────────────────────

export interface ImageBudget {
  /** The width a grid/card photo is asked for. */
  cardWidth: number
  /** The width a full-screen product photo is asked for. */
  fullWidth: number
  /** `eco` asks Cloudinary for a lower quality target; `auto` lets it measure. */
  quality: 'auto' | 'eco'
  /** How many products one page of a feed asks for. */
  pageSize: number
  /** Shop shelves: how many products a store page paints at once. */
  shelfSize: number
}

/** Someone who has asked for the full thing. */
export const FULL_BUDGET: ImageBudget = {
  cardWidth: 400, fullWidth: 900, quality: 'auto', pageSize: 24, shelfSize: 40,
}

/**
 * The default. 240px still looks like a product photo on a 360px phone (a card is ~160px wide in a
 * two-up grid, so 240 covers it with room for a retina screen), and `q_auto:eco` drops another big
 * slice of bytes. Half the cards per page, same feed — just delivered in two bites instead of one.
 */
export const SAVER_BUDGET: ImageBudget = {
  cardWidth: 240, fullWidth: 640, quality: 'eco', pageSize: 12, shelfSize: 24,
}

/** The budget for a resolved state, a boolean, or nothing at all (nothing = the saver). */
export function imageBudget(saver: SaverState | boolean | null | undefined): ImageBudget {
  const on = saver === null || saver === undefined ? true : typeof saver === 'boolean' ? saver : saver.on
  return on ? SAVER_BUDGET : FULL_BUDGET
}

// ─── what we saved, in numbers we can defend ────────────────────────────────────────────────────

/**
 * One product photo as the seller uploaded it: a phone camera JPEG, 1280px on the long edge. This is
 * the number the saving is measured against, and it is stated here rather than buried in a comment
 * so the UI can say what it is comparing.
 */
export const FULL_PHOTO_BYTES = 820_000

/**
 * What a Cloudinary `f_auto,q_auto` photo actually weighs at these widths — read off real products
 * with `curl`, not derived from a formula. Interpolated between the points, clamped at the ends.
 */
const SERVED_BYTES: Array<[number, number]> = [
  [120, 7_000],
  [160, 9_000],
  [240, 16_000],
  [320, 24_000],
  [400, 33_000],
  [640, 62_000],
  [900, 105_000],
  [1280, 190_000],
]

/** The weight of one served photo at this width, by interpolation over the table above. */
export function servedBytes(width: number): number {
  const w = Number.isFinite(width) && width > 0 ? width : SERVED_BYTES[0][0]
  const first = SERVED_BYTES[0]
  const last = SERVED_BYTES[SERVED_BYTES.length - 1]
  if (w <= first[0]) return first[1]
  if (w >= last[0]) return last[1]
  for (let i = 1; i < SERVED_BYTES.length; i++) {
    const [hiW, hiBytes] = SERVED_BYTES[i]
    if (w <= hiW) {
      const [loW, loBytes] = SERVED_BYTES[i - 1]
      const ratio = (w - loW) / (hiW - loW)
      return Math.round(loBytes + (hiBytes - loBytes) * ratio)
    }
  }
  return last[1]
}

/** `eco` trims a further quarter at the same width (Cloudinary's own quality target, measured). */
export const ECO_TRIM = 0.75

export function budgetedBytes(width: number, quality: 'auto' | 'eco' = 'auto'): number {
  const bytes = servedBytes(width)
  return quality === 'eco' ? Math.round(bytes * ECO_TRIM) : bytes
}

/** What one photo saves us when it is served at this width instead of full size. */
export function savedBytes(width: number, quality: 'auto' | 'eco' = 'auto'): number {
  return Math.max(0, FULL_PHOTO_BYTES - budgetedBytes(width, quality))
}

export interface SaverLedger {
  /** How many photos were served small in this visit. */
  images: number
  bytes: number
}

export const EMPTY_LEDGER: SaverLedger = { images: 0, bytes: 0 }

/** One more photo counted. A photo that was *not* shrunk counts as nothing, which is the truth. */
export function noteLedger(ledger: SaverLedger, width: number, quality: 'auto' | 'eco' = 'auto'): SaverLedger {
  const bytes = savedBytes(width, quality)
  if (bytes <= 0) return ledger
  return { images: ledger.images + 1, bytes: ledger.bytes + bytes }
}

/** "1.4 MB", "820 KB" — never a raw byte count, never more precision than the estimate deserves. */
export function sizeWords(bytes: number): string {
  const n = Number(bytes)
  if (!Number.isFinite(n) || n <= 0) return '0 KB'
  const kb = n / 1000
  if (kb < 1000) return `${Math.round(kb)} KB`
  const mb = kb / 1000
  return mb < 100 ? `${mb.toFixed(1)} MB` : `${Math.round(mb)} MB`
}

/**
 * The line under the switch. It says what happened in **this visit** and nothing more: a lifetime
 * total would be a number we cannot stand behind on a device we do not control.
 */
export function ledgerLine(ledger: SaverLedger): string {
  const images = Math.max(0, Math.floor(Number(ledger?.images) || 0))
  const bytes = Math.max(0, Number(ledger?.bytes) || 0)
  if (images === 0 || bytes === 0) {
    return 'Nothing has been shrunk on this visit yet — photos have been coming full size.'
  }
  const photos = `${images} photo${images === 1 ? '' : 's'}`
  return `About ${sizeWords(bytes)} saved on this visit: ${photos} sent small instead of full size.`
}

