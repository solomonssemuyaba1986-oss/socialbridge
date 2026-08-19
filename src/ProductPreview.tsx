import { useEffect, useRef, useState } from 'react'

type Props = {
  images: string[]
  startIndex: number
  onClose: () => void
}

function ProductPreview({ images, startIndex, onClose }: Props) {
  const [index, setIndex] = useState(startIndex)
  const [scale, setScale] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [shift, setShift] = useState(0)
  const [dragging, setDragging] = useState(false)

  const containerRef = useRef<HTMLDivElement>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null)
  const pinchRef = useRef<{ lastDist: number; lastScale: number } | null>(null)
  const lastTapRef = useRef(0)
  const scaleRef = useRef(scale)
  scaleRef.current = scale

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const goTo = (dir: 1 | -1) => {
    setShift(0)
    setPan({ x: 0, y: 0 })
    setScale(1)
    setIndex(i => (i + dir + images.length) % images.length)
  }

  const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.hypot(b.x - a.x, b.y - a.y)

  const clampPan = (s: number, x: number, y: number) => {
    const el = containerRef.current
    const w = el?.clientWidth || 320
    const h = el?.clientHeight || 400
    const maxX = (w / 2) * (s - 1)
    const maxY = (h / 2) * (s - 1)
    return { x: Math.max(-maxX, Math.min(maxX, x)), y: Math.max(-maxY, Math.min(maxY, y)) }
  }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size >= 2) {
      const pts = [...pointers.current.values()]
      pinchRef.current = { lastDist: dist(pts[0], pts[1]), lastScale: scaleRef.current }
      dragRef.current = null
      setDragging(true)
      return
    }
    const now = Date.now()
    if (now - lastTapRef.current < 300) {
      lastTapRef.current = 0
      if (scaleRef.current > 1) { setScale(1); setPan({ x: 0, y: 0 }) }
      else { setScale(2.5); setPan({ x: 0, y: 0 }) }
      return
    }
    lastTapRef.current = now
    dragRef.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y }
    setDragging(true)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const pts = [...pointers.current.values()]

    if (pts.length >= 2 && pinchRef.current) {
      const d = dist(pts[0], pts[1])
      const next = Math.max(1, Math.min(4, pinchRef.current.lastScale * (d / pinchRef.current.lastDist)))
      setScale(next)
      pinchRef.current.lastDist = d
      return
    }

    if (dragRef.current) {
      const dx = e.clientX - dragRef.current.startX
      const dy = e.clientY - dragRef.current.startY
      if (scaleRef.current > 1) {
        setPan(clampPan(scaleRef.current, dragRef.current.panX + dx, dragRef.current.panY + dy))
      } else {
        setShift(dx)
      }
    }
  }

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinchRef.current = null
    if (dragRef.current) {
      const dx = e.clientX - dragRef.current.startX
      const dy = e.clientY - dragRef.current.startY
      dragRef.current = null
      setDragging(false)
      if (scaleRef.current <= 1) {
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
          setShift(dx > 0 ? 600 : -600)
          setTimeout(() => goTo(dx > 0 ? -1 : 1), 180)
        } else {
          setShift(0)
        }
      }
    }
  }
  const transform = scale > 1
    ? `translate(${pan.x}px, ${pan.y}px) scale(${scale})`
    : `translateX(${shift}px)`

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.96)', zIndex: 2000, display: 'flex', flexDirection: 'column', fontFamily: 'sans-serif' }}>
      <style>{`
        @keyframes rt-preview-in { from { opacity: 0 } to { opacity: 1 } }
      `}</style>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px' }}>
        <span style={{ color: '#fff', fontSize: 14, fontWeight: 700 }}>{index + 1} / {images.length}</span>
        <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: 22, cursor: 'pointer', padding: '4px 10px' }}>✕</button>
      </div>

      {/* Image area */}
      <div
        ref={containerRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{ flex: 1, overflow: 'hidden', touchAction: 'none', position: 'relative', userSelect: 'none', WebkitUserSelect: 'none' }}
      >
        <img
          src={images[index] || 'https://placehold.co/600x600/111111/333333'}
          alt=""
          key={index}
          draggable={false}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            transform,
            transition: dragging ? 'none' : 'transform 0.25s ease',
            cursor: scale > 1 ? 'grab' : 'pointer',
            animation: 'rt-preview-in 0.2s ease',
          }}
        />
      </div>

      {/* Footer */}
      <div style={{ padding: '14px 18px', textAlign: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
          {images.length > 1 && (
            <button onClick={() => goTo(-1)} style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid #333', color: '#fff', borderRadius: '50%', width: 36, height: 36, cursor: 'pointer', fontSize: 18 }}>‹</button>
          )}
          <span style={{ color: '#888', fontSize: 12 }}>{images.length > 1 ? 'Swipe or tap arrows · double-tap to zoom' : 'Double-tap to zoom'}</span>
          {images.length > 1 && (
            <button onClick={() => goTo(1)} style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid #333', color: '#fff', borderRadius: '50%', width: 36, height: 36, cursor: 'pointer', fontSize: 18 }}>›</button>
          )}
        </div>
      </div>
    </div>
  )
}

export default ProductPreview

