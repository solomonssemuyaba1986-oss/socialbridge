const green = '#adff2f'

export interface StoreCardData {
  slug: string
  businessName: string
  logoUrl?: string
  bio?: string
  /** Shown as a small line when we know it (e.g. "12 products"). */
  note?: string
}

type Props = {
  store: StoreCardData
  onClick: () => void
}

/**
 * One store card, used wherever a shop is listed (Browse directory, Nearby rail),
 * so a store looks the same everywhere.
 */
function StoreCard({ store, onClick }: Props) {
  const initial = (store.businessName || store.slug || 'S').charAt(0).toUpperCase()

  return (
    <div onClick={onClick}
      style={{ background: '#151515', borderRadius: 14, cursor: 'pointer', overflow: 'hidden', border: '1px solid #222', minHeight: 150, display: 'flex', flexDirection: 'column', padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        {store.logoUrl ? (
          <img src={store.logoUrl} alt="" style={{ width: 44, height: 44, borderRadius: 12, objectFit: 'cover', background: '#111' }} />
        ) : (
          <div style={{ width: 44, height: 44, borderRadius: 12, background: '#222', color: '#888', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 18 }}>
            {initial}
          </div>
        )}
        <div style={{ minWidth: 0 }}>
          <p style={{ margin: 0, color: '#fff', fontWeight: 700, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {store.businessName || store.slug}
          </p>
          <p style={{ margin: '2px 0 0', color: '#666', fontSize: 11 }}>@{store.slug}</p>
        </div>
      </div>

      <p style={{ margin: 0, color: '#888', fontSize: 12, lineHeight: 1.5, flex: 1, overflow: 'hidden' }}>
        {store.bio ? store.bio.slice(0, 90) : 'Open the shop to see everything they sell.'}
      </p>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
        <span style={{ color: '#555', fontSize: 11 }}>{store.note || ''}</span>
        <span style={{ color: green, fontSize: 12, fontWeight: 700 }}>Open shop →</span>
      </div>
    </div>
  )
}

export default StoreCard
