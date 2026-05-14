import { signInWithPopup } from 'firebase/auth'
import { auth, googleProvider } from './firebase'
import { useNavigate } from 'react-router-dom'

function SignIn() {
  const navigate = useNavigate()
  const green = '#adff2f'

  const handleGoogleSignIn = async () => {
    try {
      await signInWithPopup(auth, googleProvider)
      navigate('/onboarding')
    } catch (error) {
      console.error(error)
      alert('Sign in failed. Try again.')
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f0f', fontFamily: 'sans-serif', color: '#fff' }}>

      {/* Navbar */}
      <nav style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 32px', borderBottom: '1px solid #1a1a1a' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ background: green, width: '32px', height: '32px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '800', fontSize: '13px', color: '#000' }}>SB</div>
          <span style={{ fontWeight: '800', fontSize: '18px' }}>SocialBridge</span>
        </div>
        <button onClick={handleGoogleSignIn}
          style={{ background: green, color: '#000', border: 'none', padding: '10px 20px', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '14px' }}>
          Get Started →
        </button>
      </nav>

      {/* Hero */}
      <div style={{ textAlign: 'center', padding: '80px 20px 60px', maxWidth: '800px', margin: '0 auto' }}>
        <div style={{ display: 'inline-block', background: '#1a1a1a', border: '1px solid #333', borderRadius: '20px', padding: '6px 16px', fontSize: '13px', color: '#888', marginBottom: '24px' }}>
          Your brand. Your audience. Across every platform. In one inbox.
        </div>
        <h1 style={{ fontSize: '56px', fontWeight: '900', lineHeight: '1.1', margin: '0 0 24px', letterSpacing: '-2px' }}>
          Your business<br />
          <span style={{ color: green }}>deserves a clear future</span><br />
          across social.
        </h1>
        <p style={{ fontSize: '18px', color: '#888', margin: '0 0 40px', maxWidth: '500px', marginInline: 'auto', lineHeight: '1.6' }}>
          Lost messages. Slow replies. Orders scattered across platforms. SocialBridge fixes all of it.
        </p>
        <div style={{ display: 'flex', gap: '0', justifyContent: 'center', maxWidth: '480px', marginInline: 'auto' }}>
  <input
    placeholder="Enter your email"
    style={{ flex: 1, padding: '16px 20px', borderRadius: '10px 0 0 10px', border: '1px solid #333', background: '#1a1a1a', color: '#fff', fontSize: '15px', outline: 'none' }}
  />
  <button onClick={handleGoogleSignIn}
    style={{ background: green, color: '#000', border: 'none', padding: '16px 24px', borderRadius: '0 10px 10px 0', fontWeight: '800', cursor: 'pointer', fontSize: '15px', whiteSpace: 'nowrap' }}>
    Get Started →
  </button>
</div>
        <p style={{ color: '#444', fontSize: '13px', marginTop: '16px' }}>Start selling smarter in minutes.</p>
      </div>

      {/* Problem Section */}
      <div style={{ background: '#0a0a0a', padding: '80px 20px', borderTop: '1px solid #1a1a1a' }}>
        <div style={{ maxWidth: '800px', margin: '0 auto', textAlign: 'center' }}>
          <h2 style={{ fontSize: '42px', fontWeight: '900', margin: '0 0 16px', letterSpacing: '-1px' }}>
            Customers don't stop messaging, they stop waiting<br />
            <span style={{ color: '#ff4444' }}>Get everything done from socialBridge.</span>
          </h2>
          <p style={{ color: '#666', fontSize: '16px', margin: '0 0 48px' }}>
            Every missed DM, every slow reply, every order that got lost in a comment thread — leads to poor management.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
            {[
              { icon: '💬', title: 'Lost DMs', desc: 'A customer asked about a product 3 days ago. You never saw it.' },
              { icon: '⏰', title: 'Slow Replies', desc: 'By the time you respond, they\'ve already bought from someone else.' },
              { icon: '⚠️', title: 'Scattered Orders', desc: 'IG here, TikTok there, WhatsApp somewhere. Chaos everywhere.' },
            ].map(item => (
              <div key={item.title} style={{ background: '#1a0a0a', borderRadius: '12px', padding: '24px', border: '1px solid #2a1a1a', textAlign: 'left' }}>
                <div style={{ fontSize: '28px', marginBottom: '12px' }}>{item.icon}</div>
                <p style={{ fontWeight: '700', fontSize: '16px', margin: '0 0 8px', color: '#fff' }}>{item.title}</p>
                <p style={{ color: '#666', fontSize: '14px', margin: 0, lineHeight: '1.5' }}>{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* How It Works */}
      <div style={{ padding: '80px 20px', maxWidth: '800px', margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: '48px' }}>
          <h2 style={{ fontSize: '42px', fontWeight: '900', margin: '0 0 16px', letterSpacing: '-1px' }}>Get set up in minutes.</h2>
          <p style={{ color: '#666', fontSize: '16px', margin: 0 }}> It's you, your audience, your business, and socialBridge.</p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
          {[
            { num: '01', title: 'Add your link to your bio', desc: 'Paste one SocialBridge link on Instagram, TikTok, WhatsApp. Takes 60 seconds.' },
            { num: '02', title: 'Followers tap. They shop.', desc: 'They hit your link and land on your storefront. Products, pricing — all there.' },
            { num: '03', title: 'You manage everything from one place', desc: 'See every order, every buyer, every product in your dashboard, no matter what platform they use to find you.' },
          ].map(step => (
            <div key={step.num} style={{ display: 'flex', gap: '24px', alignItems: 'flex-start' }}>
              <div style={{ fontSize: '48px', fontWeight: '900', color: green, opacity: 0.4, lineHeight: '1', minWidth: '60px' }}>{step.num}</div>
              <div>
                <p style={{ fontWeight: '700', fontSize: '18px', margin: '0 0 8px' }}>{step.title}</p>
                <p style={{ color: '#666', fontSize: '15px', margin: 0, lineHeight: '1.6' }}>{step.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Stats */}
      <div style={{ background: '#0a0a0a', padding: '60px 20px', borderTop: '1px solid #1a1a1a', borderBottom: '1px solid #1a1a1a' }}>
        <div style={{ maxWidth: '800px', margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '32px', textAlign: 'center' }}>
          {[
            { value: 'Free', label: 'to start today' },
            { value: '2 min', label: 'to go live' },
            { value: '1 link', label: 'for all platforms' },
            { value: '0', label: 'orders lost' },
          ].map(stat => (
            <div key={stat.label}>
              <p style={{ fontSize: '40px', fontWeight: '900', color: green, margin: '0 0 8px' }}>{stat.value}</p>
              <p style={{ color: '#666', fontSize: '14px', margin: 0 }}>{stat.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* CTA */}
      <div style={{ padding: '80px 20px', textAlign: 'center' }}>
        <h2 style={{ fontSize: '42px', fontWeight: '900', margin: '0 0 16px', letterSpacing: '-1px' }}>
          Manage your business<br />
          <span style={{ color: green }}>from anywhere.</span>
        </h2>
        <p style={{ color: '#666', fontSize: '16px', margin: '0 0 40px' }}>
          Never lose track of your customers again.
        </p>
        <button onClick={handleGoogleSignIn}
          style={{ background: green, color: '#000', border: 'none', padding: '18px 40px', borderRadius: '10px', fontWeight: '800', cursor: 'pointer', fontSize: '18px' }}>
          Sign up for free.→
        </button>
        <p style={{ color: '#444', fontSize: '13px', marginTop: '16px' }}> Your followers become your audience.</p>
      </div>

      {/* Footer */}
      <div style={{ borderTop: '1px solid #1a1a1a', padding: '24px', textAlign: 'center' }}>
        <p style={{ color: '#333', fontSize: '13px', margin: 0 }}>
          © 2026 <span style={{ color: green, fontWeight: '700' }}>SocialBridge</span> — One inbox. Every customer. Every platform. <br />
        </p>
      </div>

    </div>
  )
}

export default SignIn