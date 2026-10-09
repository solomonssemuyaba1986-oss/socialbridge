/**
 * Drawing a QR for a shop's parcels — and the arithmetic behind it, kept pure so it can be checked.
 *
 * `qrLayout` is the whole geometry of the card: how big a module is, how much white surrounds the
 * symbol, and exactly where the rachett mark sits on top of it. It returns numbers, not pixels, so
 * `_marketing_check.cjs` can prove the two things that make a QR scan or not — the quiet zone is the
 * spec's four modules, and the mark never eats more than a small slice of the error-correction budget.
 *
 * The mark is only drawn once the symbol is big enough to spare the room (version 2 and up). Over a
 * 21×21 symbol a centred mark would land on the timing lines, and a pretty card that will not scan is
 * a worse card than a plain one.
 */
import type { QrCode } from './qrCode'

/** Four light modules all the way round, per the spec. Three is where scanners start failing. */
export const QUIET_ZONE_MODULES = 4

/** The mark's width as a fraction of the symbol. Comfortably inside level Q's budget. */
export const LOGO_RATIO = 0.2

/** Below this many modules a centred mark would touch the finder separators or the timing lines. */
export const MIN_LOGO_MODULES = 25

export interface QrLayoutInput {
  /** The whole card, quiet zone included, in CSS pixels. */
  sizePx: number
  moduleCount: number
  quietZone?: number
  logoRatio?: number
}

export interface QrLayout {
  modulePx: number
  quietZonePx: number
  codePx: number
  totalPx: number
  /** The mark's box, with the one-module light pad that keeps it off the data. Null when skipped. */
  logo: { x: number; y: number; size: number; pad: number } | null
  /** Share of the symbol's modules the mark plus its pad covers — the error budget it spends. */
  coveredRatio: number
}

export function qrLayout(input: QrLayoutInput): QrLayout {
  const quietZone = input.quietZone ?? QUIET_ZONE_MODULES
  const logoRatio = input.logoRatio ?? LOGO_RATIO
  const moduleCount = Math.max(1, Math.floor(input.moduleCount))
  const modulePx = Math.max(1, Math.floor(input.sizePx / (moduleCount + quietZone * 2)))
  const codePx = modulePx * moduleCount
  const quietZonePx = modulePx * quietZone
  const totalPx = codePx + quietZonePx * 2

  let logo: QrLayout['logo'] = null
  let coveredRatio = 0
  if (logoRatio > 0 && moduleCount >= MIN_LOGO_MODULES) {
    const width = Math.max(1, Math.round(moduleCount * logoRatio))
    // Snapped to whole modules: a mark sitting on a half module leaves a sliver of a module showing
    // at the edge of the pad, and a sliver is exactly the kind of noise a scanner has to guess at.
    const start = Math.floor((moduleCount - width) / 2)
    logo = {
      x: quietZonePx + start * modulePx,
      y: quietZonePx + start * modulePx,
      size: width * modulePx,
      pad: modulePx,
    }
    coveredRatio = ((width + 2) * (width + 2)) / (moduleCount * moduleCount)
  }

  return { modulePx, quietZonePx, codePx, totalPx, logo, coveredRatio }
}

export interface DrawQrOptions {
  /** CSS pixels for the card — the backing store is this times `pixelRatio`. */
  sizePx: number
  logo?: CanvasImageSource | null
  dark?: string
  light?: string
  /** Retina/print sharpness. A downloaded card wants 3; a card on screen wants the device's ratio. */
  pixelRatio?: number
}

/** Paints the symbol. Returns the layout it used, so a caller can position its own overlays. */
export function drawQr(canvas: HTMLCanvasElement, code: QrCode, options: DrawQrOptions): QrLayout {
  const layout = qrLayout({ sizePx: options.sizePx, moduleCount: code.size })
  const ratio = Math.min(4, Math.max(1, options.pixelRatio ?? 2))
  const dark = options.dark ?? '#000000'
  const light = options.light ?? '#ffffff'

  canvas.width = Math.round(layout.totalPx * ratio)
  canvas.height = Math.round(layout.totalPx * ratio)
  const ctx = canvas.getContext('2d')
  if (!ctx) return layout

  ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
  ctx.fillStyle = light
  ctx.fillRect(0, 0, layout.totalPx, layout.totalPx)
  ctx.fillStyle = dark
  for (let row = 0; row < code.size; row++) {
    for (let col = 0; col < code.size; col++) {
      if (!code.modules[row][col]) continue
      ctx.fillRect(
        layout.quietZonePx + col * layout.modulePx,
        layout.quietZonePx + row * layout.modulePx,
        layout.modulePx,
        layout.modulePx,
      )
    }
  }

  if (options.logo && layout.logo) {
    const { x, y, size, pad } = layout.logo
    // Light pad first: the mark is drawn over white, never straight over modules.
    ctx.fillStyle = light
    ctx.fillRect(x - pad, y - pad, size + pad * 2, size + pad * 2)
    ctx.drawImage(options.logo, x, y, size, size)
  }
  return layout
}

export function qrDataUrl(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL('image/png')
}

/** Saves a PNG without a round trip through a server — the card is made on the seller's phone. */
export function downloadDataUrl(dataUrl: string, filename: string): void {
  const link = document.createElement('a')
  link.href = dataUrl
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export interface QrPrintCard {
  businessName: string
  slug: string
  dataUrl: string
  /** "📦 Stick it on your parcels" — the line that tells a seller what to do with it. */
  hint: string
}

/**
 * The printed card, as a string: one page, one QR, one shop name. Nothing else is on the paper.
 *
 * Built as text rather than by hiding parts of the app in a print stylesheet, because hiding the app
 * is a promise about every screen a seller might print from — and this way the paper only ever holds
 * what the seller asked for.
 */
export function qrPrintHtml(card: QrPrintCard): string {
  return [
    '<!doctype html><html><head><meta charset="utf-8" />',
    `<title>${escapeHtml(card.businessName)} — QR</title>`,
    '<style>',
    '  @page { margin: 12mm; }',
    '  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; text-align: center; color: #000; }',
    '  h1 { font-size: 22px; margin: 0 0 6px; }',
    '  p { font-size: 14px; margin: 6px 0; color: #333; }',
    '  img { width: 72mm; height: 72mm; image-rendering: pixelated; }',
    '  .hint { font-weight: 700; margin-top: 10px; }',
    '  .slug { font-family: ui-monospace, Menlo, monospace; font-size: 12px; color: #555; }',
    '</style></head><body>',
    `<h1>${escapeHtml(card.businessName)}</h1>`,
    '<p>Scan to open my shop</p>',
    `<img src="${card.dataUrl}" alt="QR code for ${escapeHtml(card.slug)}" />`,
    `<p class="slug">/store/${escapeHtml(card.slug)}</p>`,
    `<p class="hint">${escapeHtml(card.hint)}</p>`,
    '</body></html>',
  ].join('\n')
}

/**
 * Opens the card in its own window and sends it to the printer. Returns false when the browser
 * refused the window (a pop-up blocker), so the caller can offer the download instead.
 */
export function printQrCard(html: string): boolean {
  const win = window.open('', '_blank', 'width=560,height=760')
  if (!win) return false
  win.document.write(html)
  win.document.close()
  const trigger = () => {
    try {
      win.focus()
      win.print()
    } catch {
      // A printer that will not open is not a crash — the seller can print again.
    }
  }
  // Wait for the QR image itself, or the printer gets a blank box.
  if (win.document.readyState === 'complete') window.setTimeout(trigger, 150)
  else win.addEventListener('load', () => window.setTimeout(trigger, 150))
  return true
}
