import { useNavigate } from 'react-router-dom'
import { type SellerNavItem } from './sellerNav'
import SellerTabs from './SellerTabs'

const green = '#adff2f'

type Props = {
  /** The destination that isn't open yet — label, path and glyph all come from `sellerNav.ts`. */
  item: SellerNavItem
}

/**
 * What a seller promise says while it is still a promise.
 *
 * `/live` and `/studio` have been linked from the sidebar, the "More" sheet and the Dashboard's ＋
 * since the seller panel was built, and until now following one of those links landed on "this page
 * doesn't exist" — which reads as a bug rather than as a plan. Both are one route away from working,
 * so they get one honest "not yet" that says what the thing is, what to use meanwhile, and the way
 * back to the work that *is* open.
 */
const BLURB: Record<string, string> = {
  '/live': 'Live is the shop with a camera on it — you talking about a product or a price to whoever is watching right now, with the market still under their thumb. It is being built. Nothing to switch on until it opens here.',
  '/studio': 'Studio is where a video about one of your products gets made — the clip that plays in Shoppertainment and in the market. It is being built. Until it opens, Products is where a product’s photos, price and description live.',
}

function ComingSoon({ item }: Props) {
  const navigate = useNavigate()

  return (
    <div className="rt-page rt-has-tabs" style={{ minHeight: '100vh', background: '#0f0f0f', fontFamily: 'sans-serif', color: '#fff' }}>
      <SellerTabs />
      <div style={{ maxWidth: '520px', margin: '0 auto', padding: '56px 20px' }}>
        <div style={{ fontSize: '38px', lineHeight: 1, marginBottom: '14px' }} aria-hidden="true">
          {item.icon}{item.play && <span className="rt-play">▶</span>}
        </div>
        <h1 style={{ margin: '0 0 10px', fontSize: '25px', fontWeight: 800 }}>{item.label} isn’t open yet</h1>
        <p style={{ margin: '0 0 18px', color: '#9a9a9a', fontSize: '14px', lineHeight: 1.65 }}>
          {BLURB[item.path] || 'This part of your panel is still being built. It is on the list, and it will appear here the day it opens.'}
        </p>
        <p style={{ margin: '0 0 22px', color: '#6e6e6e', fontSize: '13px', lineHeight: 1.6 }}>
          Nothing to sign up for and nothing to turn on: when it ships, it is simply here — and it stays in your sidebar either way.
        </p>
        <button
          onClick={() => navigate('/dashboard')}
          style={{ padding: '13px 18px', background: green, color: '#000', border: 'none', borderRadius: '10px', fontWeight: 800, fontSize: '14px', cursor: 'pointer' }}
        >
          ← Back to your dashboard
        </button>
      </div>
    </div>
  )
}

export default ComingSoon
