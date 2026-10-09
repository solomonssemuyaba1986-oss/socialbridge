/**
 * The card a seller prints and tapes on a parcel.
 *
 * One QR, one shop name, one instruction — because the person scanning it is holding a parcel and
 * has about four seconds of patience. The code sits white-on-white inside a dark card on purpose: a
 * QR printed over an app's dark background is a QR that does not scan, so the one thing this card
 * refuses to be pretty about is the contrast of the symbol itself.
 *
 * Everything happens on the phone: the symbol is encoded in `qrCode.ts`, painted by `qrCanvas.ts`,
 * exported as a PNG, and the print page is built as a string. No service, no upload, and no signal
 * needed after the page has loaded.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { encodeQr, type QrCode } from './qrCode'
import { drawQr, downloadDataUrl, printQrCard, qrDataUrl, qrPrintHtml } from './qrCanvas'
import { markQrDownloaded, markQrPrinted, markQrViewed } from './shareStore'
import { notify } from './notifications'
import { productQrFileName, qrFileName } from './marketing'

/** The rachett mark that sits in the middle. Square, so it fits a square code. */
const MARK_SRC = '/message-icon.png'

const green = '#adff2f'

type Props = {
  sellerId: string
  businessName: string
  slug: string
  /** What the code opens — the shop, or one product inside it. */
  link: string
  /** When set, the card is about one product: different filename, different confirmation. */
  productName?: string
  /** The line under the code. Defaults to "Scan to open {shop}". */
  label?: string
  /** On-screen size in CSS pixels. The download is always print-sized. */
  size?: number
  /** The code only — a small card beside a product row, say. */
  compact?: boolean
}

function StoreQrCard({ sellerId, businessName, slug, link, productName, label, size = 240, compact = false }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [mark, setMark] = useState<HTMLImageElement | null>(null)
  const announced = useRef(false)

  const code = useMemo<QrCode | null>(() => {
    try {
      return encodeQr(link)
    } catch (err) {
      console.warn('StoreQrCard: could not encode', err)
      return null
    }
  }, [link])

  // The mark, if it loads. A missing mark is not a failure — a code without a logo still scans.
  useEffect(() => {
    let alive = true
    const img = new Image()
    img.onload = () => { if (alive) setMark(img) }
    img.onerror = () => { if (alive) setMark(null) }
    img.src = MARK_SRC
    return () => { alive = false; img.onload = null; img.onerror = null }
  }, [])

  // Painted whenever the code or the mark changes. The style width comes from the layout, because the
  // backing store is `devicePixelRatio` times bigger than the card on screen — that is what makes it
  // sharp on a phone that has one.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !code) return
    const layout = drawQr(canvas, code, {
      sizePx: size,
      pixelRatio: window.devicePixelRatio || 2,
      logo: mark,
    })
    canvas.style.width = `${layout.totalPx}px`
    canvas.style.height = `${layout.totalPx}px`
    if (!announced.current) {
      announced.current = true
      markQrViewed(sellerId)
    }
  }, [code, mark, size, sellerId])

  /** A print-sized PNG, built off-screen so the card on the page never resizes. */
  const buildPng = useCallback((): string => {
    if (!code) return ''
    const offscreen = document.createElement('canvas')
    drawQr(offscreen, code, { sizePx: 320, pixelRatio: 3, logo: mark })
    return qrDataUrl(offscreen)
  }, [code, mark])

  const fileName = useCallback(
    () => (productName ? productQrFileName(slug, productName) : qrFileName(slug)),
    [productName, slug],
  )

  const onDownload = useCallback(() => {
    const png = buildPng()
    if (!png) {
      alert(notify.qrFailed)
      return
    }
    downloadDataUrl(png, fileName())
    markQrDownloaded(sellerId, 'marketing')
    alert(notify.qrDownloaded)
  }, [buildPng, fileName, sellerId])

  const onPrint = useCallback(() => {
    const png = buildPng()
    if (!png) {
      alert(notify.qrFailed)
      return
    }
    const html = qrPrintHtml({ businessName, slug, dataUrl: png, hint: '📦 Stick it on your parcels' })
    if (printQrCard(html)) {
      markQrPrinted(sellerId, 'marketing')
      alert(notify.qrPrinted)
      return
    }
    // A blocked pop-up should not cost the seller their card: save it instead.
    downloadDataUrl(png, fileName())
    markQrDownloaded(sellerId, 'marketing')
    alert(notify.qrPrintBlocked)
  }, [buildPng, businessName, fileName, sellerId, slug])

  if (!code) {
    return (
      <div style={{ background: '#1a1a1a', border: '1px solid #222', borderRadius: 16, padding: 16, color: '#888', fontSize: 13 }}>
        {notify.qrFailed}
      </div>
    )
  }

  return (
    <div style={{
      background: '#1a1a1a',
      border: '1px solid #222',
      borderRadius: 16,
      padding: compact ? 12 : 16,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 10,
    }}>
      <button
        type="button"
        onClick={() => window.open(link, '_blank', 'noopener')}
        title="Tap to open your shop — this is what a scan does"
        style={{ background: '#fff', border: 'none', padding: 8, borderRadius: 12, cursor: 'pointer', lineHeight: 0 }}
      >
        <canvas ref={canvasRef} aria-label={`QR code for ${businessName}`} />
      </button>
      <p style={{ margin: 0, color: '#fff', fontWeight: 700, fontSize: 14, textAlign: 'center' }}>
        {label || `Scan to open ${businessName || 'your shop'}`}
      </p>
      {!compact && (
        <p style={{ margin: 0, color: '#888', fontSize: 12, textAlign: 'center' }}>
          📦 Print it and tape it on every parcel — one delivery becomes the next order.
        </p>
      )}
      <div style={{ display: 'flex', gap: 8, width: '100%' }}>
        <button
          type="button"
          onClick={onDownload}
          style={{ flex: 1, padding: '10px 8px', borderRadius: 10, border: `1px solid ${green}`, background: 'transparent', color: green, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
        >
          ⬇️ Download PNG
        </button>
        <button
          type="button"
          onClick={onPrint}
          style={{ flex: 1, padding: '10px 8px', borderRadius: 10, border: 'none', background: green, color: '#000', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
        >
          🖨️ Print card
        </button>
      </div>
      <p style={{ margin: 0, color: '#555', fontSize: 11, textAlign: 'center' }}>
        Tap the code to test it yourself.
      </p>
    </div>
  )
}

export default StoreQrCard
