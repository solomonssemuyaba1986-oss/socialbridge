import { useEffect, useState } from 'react'

interface SplashProps {
  onDone: () => void
}

function extractGreenMan(img: HTMLImageElement): string {
  const canvas = document.createElement('canvas')
  canvas.width = img.width
  canvas.height = img.height
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0)

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const pixels = imageData.data

  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i]
    const g = pixels[i + 1]
    const b = pixels[i + 2]
    const brightness = (r + g + b) / 3

    // Green-tinted man: G dominates over R and B, not too dark (excludes black frame), not too bright (excludes white bg)
    const isGreenMan = g > r && g > b && brightness > 40 && brightness < 230

    if (isGreenMan) {
      // Recolor to the rachett green so the mark is visible on dark backgrounds
      pixels[i] = 173
      pixels[i + 1] = 255
      pixels[i + 2] = 47
      pixels[i + 3] = 255
    } else {
      pixels[i + 3] = 0
    }
  }

  ctx.putImageData(imageData, 0, 0)
  return canvas.toDataURL()
}

function Splash({ onDone }: SplashProps) {
  const [fading, setFading] = useState(false)
  const [rachettUrl, setrachettUrl] = useState('')

  useEffect(() => {
    const rachettImg = new Image()
    rachettImg.onload = () => setrachettUrl(extractGreenMan(rachettImg))
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
