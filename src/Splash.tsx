import { useEffect, useState } from 'react'

interface SplashProps {
  onDone: () => void
}

// Snapchat-style: white figure with a smooth black halo so it pops on the green.
function extractLogo(img: HTMLImageElement): string {
  const w = img.width
  const h = img.height
  const OUTLINE_R = 3

  // 1) Read the raw pixels once
  const src = document.createElement('canvas')
  src.width = w
  src.height = h
  const sctx = src.getContext('2d')!
  sctx.drawImage(img, 0, 0)
  const pixels = sctx.getImageData(0, 0, w, h).data

  // Slightly generous threshold so soft anti-aliased edges stay part of the figure.
  const isWhite = (x: number, y: number): boolean => {
    const i = (y * w + x) * 4
    return (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3 > 180
  }

  // 2) Bounding box of the figure (tight crop)
  let minX = w, minY = h, maxX = -1, maxY = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!isWhite(x, y)) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (maxX < minX || maxY < minY) return src.toDataURL() // no white figure found

  const fw = maxX - minX + 1
  const fh = maxY - minY + 1

  // 3) Clean white-figure mask
  const mask = document.createElement('canvas')
  mask.width = fw
  mask.height = fh
  const mctx = mask.getContext('2d')!
  const maskData = mctx.createImageData(fw, fh)
  const mp = maskData.data
  for (let oy = 0; oy < fh; oy++) {
    for (let ox = 0; ox < fw; ox++) {
      const idx = (oy * fw + ox) * 4
      if (isWhite(ox + minX, oy + minY)) {
        mp[idx] = 255
        mp[idx + 1] = 255
        mp[idx + 2] = 255
        mp[idx + 3] = 255
      }
    }
  }
  mctx.putImageData(maskData, 0, 0)

  // 4) Same figure in black (for the halo)
  const black = document.createElement('canvas')
  black.width = fw
  black.height = fh
  const bctx = black.getContext('2d')!
  bctx.fillStyle = '#000'
  bctx.fillRect(0, 0, fw, fh)
  bctx.globalCompositeOperation = 'destination-in'
  bctx.drawImage(mask, 0, 0)

  // 5) Output: white figure + a smooth circular black halo (16-direction halo,
  //    not a blocky 3x3 square — that's what made the old outline look distorted).
  const out = document.createElement('canvas')
  out.width = fw + OUTLINE_R * 2
  out.height = fh + OUTLINE_R * 2
  const octx = out.getContext('2d')!
  for (let i = 0; i < 16; i++) {
    const ang = (i / 16) * Math.PI * 2
    const dx = Math.round(Math.cos(ang) * OUTLINE_R)
    const dy = Math.round(Math.sin(ang) * OUTLINE_R)
    octx.drawImage(black, OUTLINE_R + dx, OUTLINE_R + dy)
  }
  octx.drawImage(mask, OUTLINE_R, OUTLINE_R)

  return out.toDataURL()
}

function Splash({ onDone }: SplashProps) {
  const [fading, setFading] = useState(false)
  const [rachettUrl, setrachettUrl] = useState('')

  useEffect(() => {
    const rachettImg = new Image()
    rachettImg.onload = () => setrachettUrl(extractLogo(rachettImg))
    rachettImg.src = '/logo.jpg'
  }, [])

  useEffect(() => {
    const fadeTimer = setTimeout(() => setFading(true), 1500)
    const doneTimer = setTimeout(() => onDone(), 2000)
    return () => {
      clearTimeout(fadeTimer)
      clearTimeout(doneTimer)
    }
  }, [onDone])

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 9999,
      background: '#adff2f',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      transition: 'opacity 0.5s ease-out',
      opacity: fading ? 0 : 1,
    }}>
      {rachettUrl && (
        <img src={rachettUrl} alt="rachett" style={{ width: '190px', height: 'auto', marginBottom: '18px' }} />
      )}
      <p style={{ margin: 0, color: '#000', fontSize: '38px', fontWeight: '900', letterSpacing: '-1px' }}>rachett</p>

      <p style={{ position: 'absolute', bottom: '40px', margin: 0, color: '#336600', fontSize: '12px' }}>
        made by <span style={{ color: '#000', fontWeight: '700' }}>dwarves</span>
      </p>
    </div>
  )
}

export default Splash
