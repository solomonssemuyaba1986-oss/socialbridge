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
      pixels[i] = 0
      pixels[i + 1] = 0
      pixels[i + 2] = 0
      pixels[i + 3] = 255
    } else {
      pixels[i + 3] = 0
    }
  }

  ctx.putImageData(imageData, 0, 0)
  return canvas.toDataURL()
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
    const brightness = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3
    const a = pixels[i + 3]

    if (a > 128 && brightness > 90) {
      pixels[i] = 0
      pixels[i + 1] = 0
      pixels[i + 2] = 0
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
  const [rachettUrl, setRachettUrl] = useState('')
  const [dwarfUrl, setDwarfUrl] = useState('')

  useEffect(() => {
    const rachettImg = new Image()
    rachettImg.onload = () => setRachettUrl(extractGreenMan(rachettImg))
    rachettImg.src = '/logo.jpg'

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
      {rachettUrl && (
        <img
          src={rachettUrl}
          alt="Rachett"
          style={{ width: '160px', height: 'auto' }}
        />
      )}

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