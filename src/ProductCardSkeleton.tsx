/**
 * Shimmering placeholder card shown while nearby products load — keeps the page
 * looking alive instead of blank.
 */
function ProductCardSkeleton({ height = 160 }: { height?: number }) {
  return (
    <div style={{ background: '#1a1a1a', borderRadius: '12px', overflow: 'hidden', border: '1px solid #222' }}>
      <style>{`
        @keyframes rt-shimmer { 0% { opacity: 0.35 } 50% { opacity: 0.75 } 100% { opacity: 0.35 } }
        .rt-skeleton { animation: rt-shimmer 1.4s ease-in-out infinite; background: #242424; border-radius: 6px; }
      `}</style>
      <div className="rt-skeleton" style={{ height, width: '100%', borderRadius: 0 }} />
      <div style={{ padding: '12px' }}>
        <div className="rt-skeleton" style={{ height: 13, width: '78%', marginBottom: 8 }} />
        <div className="rt-skeleton" style={{ height: 11, width: '45%', marginBottom: 12 }} />
        <div className="rt-skeleton" style={{ height: 13, width: '35%', marginBottom: 14 }} />
        <div style={{ display: 'flex', gap: 6 }}>
          <div className="rt-skeleton" style={{ height: 30, flex: 1 }} />
          <div className="rt-skeleton" style={{ height: 30, flex: 1 }} />
        </div>
      </div>
    </div>
  )
}

export default ProductCardSkeleton
