import { useNavigate } from 'react-router-dom'
import { STUDIO } from './sellerNav'

/**
 * "Make something", floating in the corner a thumb already knows.
 *
 * Buyers get the bag in that corner on every shopping screen (`FloatingBag.tsx`); a seller's
 * equivalent is the one thing the panel never quite *shows* them — a new product, a short video, a
 * live stream. So it is the same 56px circle in the same corner, in cyan instead of the brand
 * green, because it makes something rather than buys something.
 *
 * Two differences the bag does not have to worry about:
 *   - The Dashboard *has* the phone tab bar. The bar is 62px of opaque chrome at a higher z-index,
 *     so the bag's slot would leave the bottom half of this button behind it. `rt-fab-clears-tabs`
 *     (responsive.css, phone only) lifts it above the bar; on desktop the class does nothing and it
 *     sits exactly where the bag sits.
 *   - The destination comes from `sellerNav.ts`, so the ＋ and the sidebar's Studio row can never
 *     disagree about where Studio is.
 */
const cyan = '#22d3ee'

function FloatingStudio() {
  const navigate = useNavigate()

  return (
    <button onClick={() => navigate(STUDIO.path)} aria-label={`Open ${STUDIO.label}`} title={STUDIO.label}
      className="rt-fab rt-fab-clears-tabs"
      style={{ position: 'fixed', bottom: '24px', right: '24px', width: '56px', height: '56px', borderRadius: '50%', background: cyan, color: '#001014', border: 'none', cursor: 'pointer', fontSize: '26px', fontWeight: 800, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, boxShadow: '0 4px 16px rgba(34,211,238,0.45)' }}>
      {STUDIO.icon}
    </button>
  )
}

export default FloatingStudio
