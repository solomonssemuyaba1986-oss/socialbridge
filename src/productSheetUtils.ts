/**
 * Pure helpers for the product details sheet (`ProductSheet.tsx`).
 *
 * The sheet is the decision surface: what's it, how much, in which colour and size, and can I
 * buy it without leaving the page. Everything here is free of React and the DOM so Node can
 * check it (`_sheet_check.cjs`) — a wrong variant label or a made-up stock warning would
 * otherwise only show up on a phone, mid-purchase.
 */

/** What the buyer picked. Lives on the order, the bag item and the chat bubble. */
export interface Variant {
  color?: string
  size?: string
}

/**
 * A seller types colours and sizes as free text ("Black, White,  Beige , black"), and older
 * products carry junk instead of an array. Normalise once, here: trimmed, de-duplicated
 * (case-insensitively) and capped — the sheet is a chooser, not a catalogue.
 */
export function listVariants(raw: unknown, limit = 24): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of raw) {
    if (typeof value !== 'string') continue
    const clean = value.trim().replace(/\s+/g, ' ')
    if (!clean) continue
    const key = clean.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(clean)
    if (out.length >= limit) break
  }
  return out
}

/** "Black / M" · "Black" · "M" · "" — one wording for the order, the bag and the bubble. */
export function variantLabel(color?: string, size?: string): string {
  const c = (color || '').trim()
  const s = (size || '').trim()
  if (c && s) return `${c} / ${s}`
  return c || s
}

/**
 * When a product offers exactly one colour (or one size), there is nothing to ask — that *is* the
 * choice, and making somebody tap the only option is friction for its own sake. Two or more, or
 * none at all, and the buyer still chooses for themselves.
 */
export function defaultChoice(values: string[]): string {
  return values.length === 1 ? values[0] : ''
}

/**
 * Has the buyer chosen everything this product actually offers? A product with no colours
 * (most of them today) is complete with nothing chosen — that is the honest rule, because
 * demanding a choice that doesn't exist is how a Buy button becomes a dead end.
 */
export function variantComplete(
  options: { colors: string[]; sizes: string[] },
  picked: Variant,
): boolean {
  if (options.colors.length > 0 && !(picked.color || '').trim()) return false
  if (options.sizes.length > 0 && !(picked.size || '').trim()) return false
  return true
}

/** The one thing missing, in words a buyer can act on. '' when nothing is missing. */
export function variantPrompt(options: { colors: string[]; sizes: string[] }, picked: Variant): string {
  const missing: string[] = []
  if (options.colors.length > 0 && !(picked.color || '').trim()) missing.push('colour')
  if (options.sizes.length > 0 && !(picked.size || '').trim()) missing.push('size')
  if (missing.length === 0) return ''
  return `Pick a ${missing.join(' and a ')} first`
}

/**
 * "Only 3 left" — and nothing at all when the seller didn't say, typed rubbish, or has more
 * than a handful. Stock 0 is deliberately silent: whether a shop is open is the seller's
 * `outOfStock` flag to set, and this must never invent an out-of-stock state they didn't.
 */
export function stockLine(stock: unknown, low = 5): string {
  const n = typeof stock === 'number' ? stock : parseInt(String(stock ?? '').trim(), 10)
  if (!Number.isFinite(n) || n < 1 || n > low) return ''
  return n === 1 ? 'Only 1 left' : `Only ${n} left`
}

/** What the ✕ actually closed. `none` is the honest bucket: opened it, looked, left. */
export type SheetAction = 'buy' | 'bag' | 'message' | 'gallery' | 'store' | 'none'

export function resolveSheetAction(acted: SheetAction | null | undefined): SheetAction {
  return acted || 'none'
}

/**
 * The order bubble's first line, in one place so the chat thread, the seller's order list and
 * the buyer's own list can never disagree about what was ordered:
 *   "📦 Order placed — Ref: RT-ABC123 · Black / M"
 */
export function orderBubbleText(ref: string, variant?: string): string {
  const base = `📦 Order placed — Ref: ${ref}`
  const label = (variant || '').trim()
  return label ? `${base} · ${label}` : base
}
