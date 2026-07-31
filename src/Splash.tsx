import { useEffect, useState } from 'react'

interface SplashProps {
  onDone: () => void
}

function processImageToBlackSilhouette(img: HTMLImageElement): string {
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
    const a = pixels[i + 3]
    // Brightness of the pixel
    const brightness = (r + g + b) / 3
    // Light/white areas (foreground) → black. Dark areas + transparent → transparent.
    if (a > 128 && brightness > 90) {
      pixels[i] = 0        // R
      pixels[i + 1] = 0    // G
      pixels[i + 2] = 0    // B
      pixels[i + 3] = 255  // A — fully opaque black
    } else {
      pixels[i + 3] = 0    // A — fully transparent
    }
  }

  ctx.putImageData(imageData, 0, 0)
  return canvas.toDataURL()
}

function Splash({ onDone }: SplashProps) {
  const [fading, setFading] = useState(false)
  const [rachettUrl, setRachettUrl] = useState('')
  const [dwarfUrl, setDwarfUrl] = useState('')

  useEffect(() => {
    // Rachett logo: black man on light bg → use multiply to make light bg transparent
    const rachettImg = new Image()
    rachettImg.onload = () => setRachettUrl(rachettImg.src)
    rachettImg.src = '/logo.jpg'

    // Process mother company logo with canvas
    const dwarfImg = new Image()
    dwarfImg.onload = () => setDwarfUrl(processImageToBlackSilhouette(dwarfImg))
    dwarfImg.src = '/mothercompanydwarf.png'
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
      {/* Rachett Logo — centered */}
      {rachettUrl && (
        <img
          src={rachettUrl}
          alt="Rachett"
          style={{
          width: '160px',
          height: 'auto',
          mixBlendMode: 'multiply' as any,
        }}
        />
      )}

      {/* Mother Company — fixed at bottom */}
      {dwarfUrl && (
        <img
          src={dwarfUrl}
          alt="from dwarves"
          style={{
            position: 'absolute',
            bottom: '48px',
            width: '120px',
            height: 'auto',
          }}
        />
      )}
    </div>
  )
}

export default Splash