import { useNavigate } from 'react-router-dom'
import { useBag } from './useBag'

const green = '#adff2f'

function BagPage() {
  const navigate = useNavigate()
  const { items, removeFromBag, clearBag, setQuantity, count } = useBag()

  const total = items.reduce((sum, i) => sum + (Number(String(i.productPrice).replace(/[^0-9]/g, '')) || 0) * i.quantity, 0)

  if (count === 0) {
    return (
      <div style={{ minHeight: '100vh', background: '#0f0f0f', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '20px', fontFamily: 'sans-serif', color: '#fff' }}>
        <p style={{ fontSize: '48px', margin: '0 0 16px' }}>🛍️</p>
        <h2 style={{ fontWeight: '800', margin: '0 0 8px', fontSize: '22px' }}>Your bag is empty</h2>
        <p style={{ color: '#888', fontSize: '14px', margin: '0 0 24px', textAlign: 'center' }}>Browse stores and tap 🛍️ on any product to save it here.</p>
        <button onClick={() => navigate('/browse')}
          style={{ padding: '14px 32px', background: green, color: '#000', border: 'none', borderRadius: '12px', fontWeight: '800', cursor: 'pointer', fontSize: '15px' }}>
          Browse Stores
        </button>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f0f', fontFamily: 'sans-serif', color: '#fff', padding: '20px' }}>
      <div style={{ maxWidth: '640px', margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h1 style={{ margin: 0, fontSize: '22px', fontWeight: '800' }}>🛍️ Your Bag ({count})</h1>
          <button onClick={clearBag}
            style={{ padding: '8px 16px', background: 'transparent', color: '#888', border: '1px solid #333', borderRadius: '8px', cursor: 'pointer', fontSize: '13px' }}>
            Clear All
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {items.map(item => (
            <div key={item.productId}
              style={{ background: '#1a1a1a', borderRadius: '12px', padding: '14px', border: '1px solid #222', display: 'flex', gap: '14px', alignItems: 'center' }}>
              <img src={item.imageUrl || 'https://placehold.co/80/1a1a1a/333333'} alt={item.productName}
                style={{ width: '72px', height: '72px', borderRadius: '8px', objectFit: 'cover', flexShrink: 0, cursor: 'pointer' }}
                onClick={() => navigate(`/store/${item.sellerSlug}?productId=${item.productId}`)} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: '0 0 4px', fontWeight: '700', fontSize: '14px', color: '#fff' }}>{item.productName}</p>
                <p style={{ margin: '0 0 4px', fontSize: '12px', color: '#888' }}>{item.businessName}</p>
                <p style={{ margin: 0, fontWeight: '800', fontSize: '14px', color: green }}>UGX {item.productPrice}</p>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: '#0f0f0f', borderRadius: '8px', padding: '2px' }}>
                  <button onClick={() => setQuantity(item.productId, item.quantity - 1)}
                    style={{ width: '28px', height: '28px', background: '#222', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '14px', fontWeight: '700', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
                  <span style={{ width: '28px', textAlign: 'center', fontSize: '13px', fontWeight: '700', color: '#fff' }}>{item.quantity}</span>
                  <button onClick={() => setQuantity(item.productId, item.quantity + 1)}
                    style={{ width: '28px', height: '28px', background: '#222', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '14px', fontWeight: '700', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
                </div>
                <button onClick={() => navigate(`/store/${item.sellerSlug}`)}
                  style={{ padding: '6px 12px', background: '#222', color: '#fff', border: '1px solid #333', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '11px', whiteSpace: 'nowrap' }}>
                  💬 Message
                </button>
                <button onClick={() => navigate(`/store/${item.sellerSlug}?productId=${item.productId}`)}
                  style={{ padding: '6px 12px', background: green, color: '#000', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '11px', whiteSpace: 'nowrap' }}>
                  Buy Now
                </button>
                <button onClick={() => removeFromBag(item.productId)}
                  style={{ padding: '6px 12px', background: 'transparent', color: '#888', border: '1px solid #333', borderRadius: '8px', cursor: 'pointer', fontSize: '11px', whiteSpace: 'nowrap' }}>
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Total */}
        <div style={{ marginTop: '20px', padding: '16px', background: '#1a1a1a', borderRadius: '12px', border: '1px solid #222', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: '#888', fontSize: '14px' }}>Total</span>
          <span style={{ fontWeight: '800', fontSize: '18px', color: green }}>UGX {total.toLocaleString()}</span>
        </div>
      </div>
    </div>
  )
}

export default BagPage
