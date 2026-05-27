import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { auth, db } from './firebase'
import { doc, getDoc, updateDoc } from 'firebase/firestore'
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage'

function EditStore() {
  const [businessName, setBusinessName] = useState('')
  const [bio, setBio] = useState('')
  const [whatsapp, setWhatsapp] = useState('')
  const [logoUrl, setLogoUrl] = useState('')
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    const load = async () => {
      const user = auth.currentUser
      if (!user) { navigate('/'); return }
      try {
        const docRef = doc(db, 'sellers', user.uid)
        const snap = await getDoc(docRef)
        if (snap.exists()) {
          const data = snap.data() as any
          setBusinessName(data.businessName || '')
          setBio(data.bio || '')
          setWhatsapp((data.whatsapp || '').replace(/^256/, ''))
          setLogoUrl(data.logoUrl || '')
        }
      } catch (err) {
        console.error('Load store failed', err)
      }
    }
    load()
  }, [navigate])

  const handleFile = (f?: File | null) => {
    if (!f) { setLogoFile(null); setLogoUrl(''); return }
    setLogoFile(f)
    setLogoUrl(URL.createObjectURL(f))
  }

  const handleSave = async () => {
    const user = auth.currentUser
    if (!user) { navigate('/'); return }
    setLoading(true)
    try {
      let finalLogoUrl = logoUrl || ''
      if (logoFile) {
        const storage = getStorage()
        const storageRef = ref(storage, `sellers/${user.uid}/logo.jpg`)
        await uploadBytes(storageRef, logoFile)
        finalLogoUrl = await getDownloadURL(storageRef)
      }

      const fullNumber = whatsapp ? `256${whatsapp}` : ''
      await updateDoc(doc(db, 'sellers', user.uid), {
        businessName: businessName.trim(),
        bio: bio.trim(),
        whatsapp: fullNumber,
        logoUrl: finalLogoUrl,
      })
      navigate('/dashboard')
    } catch (err) {
      console.error('Save failed', err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ padding: 20 }}>
      <h2>Edit Store</h2>
      <div style={{ maxWidth: 480 }}>
        <label>Business name</label>
        <input value={businessName} onChange={e => setBusinessName(e.target.value)} style={{ width: '100%', padding: 8, marginBottom: 8 }} />

        <label>Bio</label>
        <textarea value={bio} onChange={e => setBio(e.target.value)} rows={3} style={{ width: '100%', padding: 8, marginBottom: 8 }} />

        <label>WhatsApp (local)</label>
        <input value={whatsapp} onChange={e => setWhatsapp(e.target.value.replace(/\D/g, '').slice(0,9))} placeholder="771234567" style={{ width: '100%', padding: 8, marginBottom: 8 }} />

        <label>Logo (optional)</label>
        <div style={{ marginBottom: 8 }}>
          <input type="file" accept="image/*" onChange={e => { if (e.target.files && e.target.files[0]) handleFile(e.target.files[0]) }} />
        </div>
        {logoUrl && (
          <div style={{ marginBottom: 8 }}>
            <img src={logoUrl} alt="logo" style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 8 }} />
          </div>
        )}

        <button onClick={handleSave} disabled={loading} style={{ padding: 10 }}>{loading ? 'Saving...' : 'Save'}</button>
      </div>
    </div>
  )
}

export default EditStore
