import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { auth, db } from './firebase'
import { doc, getDoc, updateDoc } from 'firebase/firestore'
import { getStorage, ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage'

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
        try {
          // resize before upload
          const resizeImage = (file: File, maxWidth = 1024, quality = 0.8): Promise<Blob> => {
            return new Promise((resolve, reject) => {
              const img = new Image()
              img.onload = () => {
                try {
                  const scale = Math.min(1, maxWidth / img.width)
                  const w = Math.round(img.width * scale)
                  const h = Math.round(img.height * scale)
                  const canvas = document.createElement('canvas')
                  canvas.width = w
                  canvas.height = h
                  const ctx = canvas.getContext('2d')!
                  ctx.drawImage(img, 0, 0, w, h)
                  canvas.toBlob((blob) => {
                    if (blob) resolve(blob)
                    else reject(new Error('Image resize failed'))
                  }, 'image/jpeg', quality)
                } catch (err) {
                  reject(err)
                }
              }
              img.onerror = (e) => reject(e)
              img.src = URL.createObjectURL(file)
            })
          }

          const processedBlob = await resizeImage(logoFile, 1024, 0.8)
          const processedFile = new File([processedBlob], 'logo.jpg', { type: 'image/jpeg' })
          const storage = getStorage()
          const storageRef = ref(storage, `sellers/${user.uid}/logo.jpg`)
          const uploadTask = uploadBytesResumable(storageRef, processedFile)

          await new Promise<void>((resolve, reject) => {
            uploadTask.on('state_changed', () => {
              // could update progress UI here
            }, (error) => {
              console.error('Upload failed', error)
              reject(error)
            }, async () => {
              try {
                finalLogoUrl = await getDownloadURL(uploadTask.snapshot.ref)
                resolve()
              } catch (e) { reject(e) }
            })
          })
        } catch (err) {
          console.error('Logo upload failed', err)
        }
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
