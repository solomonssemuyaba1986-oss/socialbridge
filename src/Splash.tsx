import { useEffect, useState } from 'react'

interface SplashProps {
  onDone: () => void
}

function Splash({ onDone }: SplashProps) {
  const [fading, setFading] = useState(false)
  const [processedUrl, setProcessedUrl] = useState('')

  useEffect(() => {
    const img = new Image()
    img.onload = () => {
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
        // Calculate brightness: light pixels = the man figure, dark = background
        const brightness = (r + g + b) / 3
        if (brightness > 90) {
          // Light area (man) → make it black
          pixels[i] = 0
          pixels[i + 1] = 0
          pixels[i + 2] = 0
          pixels[i + 3] = 255  // fully opaque black
        } else {
          // Dark area (background) → make it transparent
          pixels[i + 3] = 0
        }
      }

      ctx.putImageData(imageData, 0, 0)
      setProcessedUrl(canvas.toDataURL())
    }
    img.src = '/Screenshot_20260613_115102_Chrome.jpg'
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
      alignItems: 'center',
      justifyContent: 'center',
      transition: 'opacity 0.5s ease-out',
      opacity: fading ? 0 : 1,
    }}>
      {processedUrl && (
        <img
          src={processedUrl}
          alt="Rachett"
          style={{
            width: '160px',
            height: 'auto',
          }}
        />
      )}
    </div>
  )
}

export default Splash