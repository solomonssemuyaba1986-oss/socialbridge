import { useEffect, useState } from 'react'

interface SplashProps {
  onDone: () => void
}

function extractWhiteMan(img: HTMLImageElement): string {
  const canvas = document.createElement('canvas')
  canvas.width = img.width
  canvas.height = img.height
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0)

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const pixels = imageData.data

  let minX = canvas.width
  let minY = canvas.height
  let maxX = -1
  let maxY = -1

  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i]
    const g = pixels[i + 1]
    const b = pixels[i + 2]
    const brightness = (r + g + b) / 3

    // The man is the white figure in the logo — render him white, everything else transparent
    if (brightness > 200) {
      pixels[i] = 255
      pixels[i + 1] = 255
      pixels[i + 2] = 255
      pixels[i + 3] = 255
      const x = (i / 4) % canvas.width
      const y = Math.floor((i / 4) / canvas.width)
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    } else {
      pixels[i + 3] = 0
    }
  }

  ctx.putImageData(imageData, 0, 0)

  // Crop tightly around the figure so he renders big and centered
  if (maxX >= minX && maxY >= minY) {
    const w = maxX - minX + 1
    const h = maxY - minY + 1
    const cropCanvas = document.createElement('canvas')
    cropCanvas.width = w
    cropCanvas.height = h
    cropCanvas.getContext('2d')!.drawImage(canvas, minX, minY, w, h, 0, 0, w, h)
    return cropCanvas.toDataURL()
  }
  return canvas.toDataURL()
}

function Splash({ onDone }: SplashProps) {
  const [fading, setFading] = useState(false)
  const [rachettUrl, setrachettUrl] = useState('')

  useEffect(() => {
    const rachettImg = new Image()
    rachettImg.onload = () => setrachettUrl(extractWhiteMan(rachettImg))
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
      background: '#0f0f0f',
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
      <p style={{ margin: 0, color: '#fff', fontSize: '34px', fontWeight: '900', letterSpacing: '-1px' }}>rachett</p>
      <p style={{ margin: '10px 0 0', color: '#adff2f', fontSize: '16px', fontWeight: '700', letterSpacing: '0.5px' }}>People, not platforms.</p>

      <p style={{ position: 'absolute', bottom: '40px', margin: 0, color: '#555', fontSize: '12px' }}>
        made by <span style={{ color: '#888', fontWeight: '700' }}>dwarves</span>
      </p>
    </div>
  )
}

export default Splash
