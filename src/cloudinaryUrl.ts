/**
 * Photos that fit an African data bundle.
 *
 * Every product photo is stored on Cloudinary (`uploadImage.ts`), and Cloudinary can re-encode and
 * resize any of its own images **from the URL alone** — free, at the edge, with no upload step and no
 * second copy kept anywhere. A card that shows a photo 160px tall has no business fetching the
 * 1280px original, so the URL is rewritten to ask for exactly what the screen needs:
 *
 *   - `f_auto` — WebP or AVIF where the phone can decode it, JPEG where it cannot;
 *   - `q_auto` — the smallest quality that still looks right (Cloudinary measures it, we do not guess);
 *     `q_auto:eco` when the data saver is on, which aims lower on purpose (`dataSaver.ts`);
 *   - `c_limit` — never scale *up*, and never crop a product the buyer came to see;
 *   - `w_<width>` — the width that actually lands on this screen.
 *
 * On a feed this is routinely 10–20× fewer bytes per card — the difference between a buyer scrolling
 * and a buyer closing the tab. Nothing about the picture changes.
 *
 * Anything that is not a Cloudinary upload URL is passed back **untouched**: placeholders, `data:`
 * and `blob:` previews, and any older host must keep working exactly as they did. Pure — no React,
 * no network — so a stray URL can never take a page down.
 */
import type { ImageBudget } from './dataSaver'

const UPLOAD = '/image/upload/'

/** The width a card photo is actually drawn at: 400 covers a 2× phone without waste. */
export const CARD_IMAGE_WIDTH = 400

/** `auto` lets Cloudinary measure the quality; `eco` tells it to aim lower from the start. */
export type ImageQuality = 'auto' | 'eco'

export function sizedImage(
  url: string,
  width: number = CARD_IMAGE_WIDTH,
  quality: ImageQuality = 'auto',
): string {
  if (!url || typeof url !== 'string') return url
  const marker = url.indexOf(UPLOAD)
  if (marker === -1) return url

  const head = url.slice(0, marker + UPLOAD.length)
  const rest = url.slice(marker + UPLOAD.length)
  // Already carrying instructions (or a transformation we would fight with) — leave it alone.
  if (/^(f_|q_|w_|c_|dpr_|g_|e_|ar_)/.test(rest)) return url

  // A junk width must not become `w_NaN` and break the image; 400 is what a card wants.
  const safe = Number.isFinite(width) ? Math.round(width) : CARD_IMAGE_WIDTH
  const w = Math.max(40, Math.min(1600, safe))
  const q = quality === 'eco' ? 'q_auto:eco' : 'q_auto'
  return `${head}f_auto,${q},c_limit,w_${w}/${rest}`
}

/**
 * The same rewrite, driven by a data-saver budget, so that the width and the quality a screen asks
 * for can never drift apart from the setting that chose them.
 */
export function budgetedImage(url: string, budget: ImageBudget, size: 'card' | 'full' = 'card'): string {
  const width = size === 'full' ? budget.fullWidth : budget.cardWidth
  return sizedImage(url, width, budget.quality)
}
