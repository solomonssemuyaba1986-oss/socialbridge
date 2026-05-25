import { useNavigate } from 'react-router-dom'

function Onboarding() {
  const navigate = useNavigate()

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f0f', fontFamily: 'sans-serif', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <p style={{ color: '#aaa', marginBottom: '8px', fontSize: '14px' }}>Welcome to Rachett</p>
      <h1 style={{ color: '#fff', fontSize: '32px', fontWeight: '800', marginBottom: '8px', textAlign: 'center' }}>What brings you here?</h1>
      <p style={{ color: '#888', marginBottom: '40px', fontSize: '15px' }}>We'll set up the right experience for you.</p>

      <div className="rt-onboarding-cards" style={{ display: 'flex', gap: '16px', width: '100%', maxWidth: '560px', marginBottom: '32px' }}>
        
        {/* Seller */}
        <div onClick={() => navigate('/setup')}
          style={{ flex: 1, background: '#1a1a1a', border: '2px solid #333', borderRadius: '16px', padding: '24px', cursor: 'pointer' }}>
          <div style={{ background: '#adff2f', width: '44px', height: '44px', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '16px', fontSize: '22px' }}>🏪</div>
          <p style={{ color: '#fff', fontWeight: '700', fontSize: '16px', margin: '0 0 8px' }}>I'm a Seller</p>
          <p style={{ color: '#888', fontSize: '13px', margin: '0 0 16px' }}>I sell products on Instagram, TikTok, or WhatsApp and want to stop losing orders.</p>
          <div style={{ display: 'flex', gap: '8px', fontSize: '18px' }}>📸 🎵 💬</div>
        </div>

        {/* Buyer */}
        <div onClick={() => navigate('/browse')}
          style={{ flex: 1, background: '#1a1a1a', border: '2px solid #333', borderRadius: '16px', padding: '24px', cursor: 'pointer' }}>
          <div style={{ background: '#3b82f6', width: '44px', height: '44px', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '16px', fontSize: '22px' }}>🛍️</div>
          <p style={{ color: '#fff', fontWeight: '700', fontSize: '16px', margin: '0 0 8px' }}>I'm a Buyer</p>
          <p style={{ color: '#888', fontSize: '13px', margin: '0 0 16px' }}>I want to find and buy products from social media sellers safely.</p>
          <p style={{ color: '#888', fontSize: '12px', margin: 0 }}>👥 Browse hundreds of social sellers</p>
        </div>

      </div>
    </div>
  )
}

export default Onboarding