import { useNavigate } from 'react-router-dom'

const green = '#adff2f'

type Props = {
  /** How many items are in the bag — the red badge hides itself at 0. */
  count: number
}

/**
 * The floating bag button buyers expect on every shopping screen
 * (Browse, Store, Nearby, home). One component, one look.
 */
function FloatingBag({ count }: Props) {
  const navigate = useNavigate()

  return (
    <button onClick={() => navigate('/bag')} aria-label="Open your bag" title="Your bag"
      style={{ position: 'fixed', bottom: '24px', right: '24px', width: '56px', height: '56px', borderRadius: '50%', background: green, color: '#000', border: 'none', cursor: 'pointer', fontSize: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, boxShadow: '0 4px 16px rgba(173,255,47,0.4)' }}>
      🛍️
      {count > 0 && (
        <span style={{ position: 'absolute', top: '-4px', right: '-4px', background: '#ff4444', color: '#fff', borderRadius: '50%', width: '22px', height: '22px', fontSize: '11px', fontWeight: '800', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid #0f0f0f' }}>
          {count}
        </span>
      )}
    </button>
  )
}

export default FloatingBag
