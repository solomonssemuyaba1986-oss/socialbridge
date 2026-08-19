import { useEffect, useState } from 'react'

interface SplashProps {
  onDone: () => void
}

// Snapchat-style: white figure with a black outline so it pops on the green.
function extractLogo(img: HTMLImageElement): string {
  const w = img.width
  const h = img.height
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0)
  const pixels = ctx.getImageData(0, 0, w, h).data

  const isWhite = (x: number, y: number): boolean => {
    const i = (y * w + x) * 4
    return (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3 > 200
  }

  const OUTLINE_R = 3
  let minX = w, minY = h, maxX = -1, maxY = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!isWhite(x, y)) continue
      if (x - OUTLINE_R < minX) minX = x - OUTLINE_R
      if (x + OUTLINE_R > maxX) maxX = x + OUTLINE_R
      if (y - OUTLINE_R < minY) minY = y - OUTLINE_R
      if (y + OUTLINE_R > maxY) maxY = y + OUTLINE_R
    }
  }

  if (maxX < minX || maxY < minY) return canvas.toDataURL()

  const outW = maxX - minX + 1
  const outH = maxY - minY + 1
  const out = document.createElement('canvas')
  out.width = outW
  out.height = outH
  const outCtx = out.getContext('2d')!
  const outData = outCtx.createImageData(outW, outH)
  const outPx = outData.data
  const inBounds = (x: number, y: number) => x >= 0 && x < w && y >= 0 && y < h

  for (let oy = 0; oy < outH; oy++) {
    for (let ox = 0; ox < outW; ox++) {
      const sx = ox + minX
      const sy = oy + minY
      const idx = (oy * outW + ox) * 4
      if (inBounds(sx, sy) && isWhite(sx, sy)) {
        // White figure on top
        outPx[idx] = 255
        outPx[idx + 1] = 255
        outPx[idx + 2] = 255
        outPx[idx + 3] = 255
        continue
      }
      // Black outline: any white pixel within radius?
      let near = false
      for (let dy = -OUTLINE_R; dy <= OUTLINE_R && !near; dy++) {
        for (let dx = -OUTLINE_R; dx <= OUTLINE_R; dx++) {
          const nx = sx + dx
          const ny = sy + dy
          if (inBounds(nx, ny) && isWhite(nx, ny)) { near = true; break }
        }
      }
      if (near) {
        outPx[idx] = 0
        outPx[idx + 1] = 0
        outPx[idx + 2] = 0
        outPx[idx + 3] = 255
      }
    }
  }

  outCtx.putImageData(outData, 0, 0)
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
    const fadeTimer = setTimeout(() => setFading(true), 2500)
    const doneTimer = setTimeout(() => onDone(), 3000)
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
        <img src={rachettUrl} alt="rachett" style={{ width: '130px', height: 'auto', marginBottom: '18px' }} />
      )}
      <p style={{ margin: 0, color: '#000', fontSize: '34px', fontWeight: '900', letterSpacing: '-1px' }}>rachett</p>

      <p style={{ position: 'absolute', bottom: '40px', margin: 0, color: '#336600', fontSize: '12px' }}>
        made by <span style={{ color: '#000', fontWeight: '700' }}>dwarves</span>
      </p>
    </div>
  )
}

export default Splash
