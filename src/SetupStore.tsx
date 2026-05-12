import { useState } from 'react'
import { auth, db } from './firebase'
import { doc, setDoc } from 'firebase/firestore'
import { useNavigate } from 'react-router-dom'

function SetupStore() {
  const [businessName, setBusinessName] = useState('')
  const [bio, setBio] = useState('')
  const [whatsapp, setWhatsapp] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  const generateSlug = (name: string) =>
    name.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')

  const handleWhatsappChange = (val: string) => {
    const digits = val.replace(/\D/g, '').slice(0, 9)
    setWhatsapp(digits)
    if (digits.length > 0 && digits.length < 9) {
      setError('Enter all 9 digits of your number')
    } else {
      setError('')
    }
  }

  const handleSubmit = async () => {
    if (!businessName.trim()) return alert('Enter your business name')
    if (whatsapp.length !== 9) return alert('Enter a valid 9-digit Uganda phone number')
    const user = auth.currentUser
    if (!user) return alert('Not signed in')
    setLoading(true)
    const slug = generateSlug(businessName)
    const fullNumber = `256${whatsapp}`
    await setDoc(doc(db, 'sellers', user.uid), {
      businessName,
      bio,
      whatsapp: fullNumber,
      logoUrl: user.photoURL || '',
      slug,
      email: user.email,
    })
    navigate('/dashboard')
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f9f9f9', fontFamily: 'sans-serif', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <h1 style={{ fontSize: '24px', fontWeight: '700', marginBottom: '8px' }}>Set up your store</h1>
      <p style={{ color: '#666', marginBottom: '32px' }}>Your store will be live in seconds</p>

      <div style={{ background: '#fff', borderRadius: '12px', padding: '32px', width: '100%', maxWidth: '480px', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
        
        <label style={{ fontSize: '14px', fontWeight: '600', color: '#333' }}>Business Name</label>
        <input value={businessName} onChange={e => setBusinessName(e.target.value)}
          placeholder="e.g. Zara Cosmetics"
          style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #ddd', marginTop: '8px', marginBottom: '20px', fontSize: '15px', boxSizing: 'border-box' }} />

        <label style={{ fontSize: '14px', fontWeight: '600', color: '#333' }}>Bio</label>
        <textarea value={bio} onChange={e => setBio(e.target.value)}
          placeholder="Tell customers what you sell..."
          rows={3}
          style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #ddd', marginTop: '8px', marginBottom: '20px', fontSize: '15px', boxSizing: 'border-box', resize: 'none' }} />

        <label style={{ fontSize: '14px', fontWeight: '600', color: '#333' }}>WhatsApp Number</label>
        <p style={{ fontSize: '12px', color: '#888', margin: '4px 0 8px' }}>Uganda number — we add 256 automatically</p>
        
        <div style={{ display: 'flex', alignItems: 'center', border: '1px solid #ddd', borderRadius: '8px', overflow: 'hidden', marginBottom: '4px' }}>
          <div style={{ background: '#f5f5f5', padding: '12px 14px', fontSize: '15px', borderRight: '1px solid #ddd', color: '#333', fontWeight: '600', whiteSpace: 'nowrap' }}>
            🇺🇬 +256
          </div>
          <input
            value={whatsapp}
            onChange={e => handleWhatsappChange(e.target.value)}
            placeholder="771234567"
            maxLength={9}
            style={{ flex: 1, padding: '12px', border: 'none', outline: 'none', fontSize: '15px', background: '#fff' }}
          />
        </div>
        
        {error && <p style={{ color: 'red', fontSize: '12px', margin: '4px 0 16px' }}>{error}</p>}
        {!error && whatsapp.length === 9 && (
          <p style={{ color: 'green', fontSize: '12px', margin: '4px 0 16px' }}>✓ Number looks good</p>
        )}
        {whatsapp.length === 0 && <div style={{ marginBottom: '20px' }} />}

        <button onClick={handleSubmit} disabled={loading}
          style={{ width: '100%', padding: '14px', background: '#1a1a1a', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '16px', fontWeight: '600', cursor: 'pointer', marginTop: '8px' }}>
          {loading ? 'Creating...' : 'Create My Store'}
        </button>
      </div>
    </div>
  )
}

export default SetupStore