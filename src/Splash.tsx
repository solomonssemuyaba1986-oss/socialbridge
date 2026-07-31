import { useEffect, useState } from 'react'

interface SplashProps {
  onDone: () => void
}

function Splash({ onDone }: SplashProps) {
  const [fading, setFading] = useState(false)

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
      <img
        src="/Screenshot_20260613_115102_Chrome.jpg"
        alt="Rachett"
        style={{
          width: '160px',
          height: 'auto',
          filter: 'invert(1)',
          mixBlendMode: 'multiply',
        }}
      />
    </div>
  )
}

export default Splash