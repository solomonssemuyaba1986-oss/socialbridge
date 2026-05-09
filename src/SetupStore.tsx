import { useState } from 'react'
import { auth, db } from './firebase'
import { doc, setDoc } from 'firebase/firestore'
import { useNavigate } from 'react-router-dom'

function SetupStore() {
  const [businessName, setBusinessName] = useState('')
  const [bio, setBio] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  const generateSlug = (name: string) =>
    name.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')

  const handleSubmit = async () => {
    if (!businessName.trim()) return alert('Enter your business name')
    const user = auth.currentUser
    if (!user) return alert('Not signed in')
    setLoading(true)
    const slug = generateSlug(businessName)
    await setDoc(doc(db, 'sellers', user.uid), {
      businessName,
      bio,
      logoUrl: user.photoURL || '',
      slug,
      email: user.email,
    })
    navigate(`/dashboard`)
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f9f9f9', fontFamily: 'sans-serif', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <h1 style={{ fontSize: '24px', fontWeight: '700', marginBottom: '8px' }}>Set up your store</h1>
      <p style={{ color: '#666', marginBottom: '32px' }}>Your store will be live in seconds</p>

      <div style={{ background: '#fff', borderRadius: '12px', padding: '32px', width: '100%', maxWidth: '480px', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
        <label style={{ fontSize: '14px', fontWeight: '600', color: '#333' }}>Business Name</label>
        <input
          value={businessName}
          onChange={e => setBusinessName(e.target.value)}
          placeholder="e.g. Zara Cosmetics"
          style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #ddd', marginTop: '8px', marginBottom: '20px', fontSize: '15px', boxSizing: 'border-box' }}
        />

        <label style={{ fontSize: '14px', fontWeight: '600', color: '#333' }}>Bio</label>
        <textarea
          value={bio}
          onChange={e => setBio(e.target.value)}
          placeholder="Tell customers what you sell..."
          rows={3}
          style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #ddd', marginTop: '8px', marginBottom: '28px', fontSize: '15px', boxSizing: 'border-box', resize: 'none' }}
        />

        <button
          onClick={handleSubmit}
          disabled={loading}
          style={{ width: '100%', padding: '14px', background: '#1a1a1a', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '16px', fontWeight: '600', cursor: 'pointer' }}
        >
          {loading ? 'Creating...' : 'Create My Store'}
        </button>
      </div>
    </div>
  )
}

export default SetupStore