import { useState } from 'react'
import { collection, addDoc } from 'firebase/firestore'
import { db } from './firebase'

interface ProductDraft {
  file: File
  preview: string
  name: string
  price: string
  uploading: boolean
  uploaded: boolean
  imageUrl: string
}

const green = '#adff2f'
const CLOUD_NAME = 'dzudmmuxg'
const UPLOAD_PRESET = 'p2z65zrv'

function BulkUpload({ sellerId, onDone }: { sellerId: string, onDone: () => void }) {
  const [drafts, setDrafts] = useState<ProductDraft[]>([])
  const [saving, setSaving] = useState(false)

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    const newDrafts: ProductDraft[] = files.map(file => ({
      file,
      preview: URL.createObjectURL(file),
      name: '',
      price: '',
      uploading: false,
      uploaded: false,
      imageUrl: ''
    }))
    setDrafts(prev => [...prev, ...newDrafts])
  }

  const updateDraft = (index: number, field: 'name' | 'price', value: string) => {
    setDrafts(prev => prev.map((d, i) => i === index ? { ...d, [field]: value } : d))
  }

  const removeDraft = (index: number) => {
    setDrafts(prev => prev.filter((_, i) => i !== index))
  }

  const uploadImage = async (file: File): Promise<string> => {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('upload_preset', UPLOAD_PRESET)
    const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, {
      method: 'POST',
      body: formData
    })
    const data = await res.json()
    return data.secure_url
  }

  const handleSaveAll = async () => {
    const valid = drafts.filter(d => d.name.trim() && d.price.trim())
    if (valid.length === 0) return alert('Add a name and price to at least one product')
    setSaving(true)

    for (let i = 0; i < drafts.length; i++) {
      const draft = drafts[i]
      if (!draft.name.trim() || !draft.price.trim()) continue

      setDrafts(prev => prev.map((d, idx) => idx === i ? { ...d, uploading: true } : d))

      const imageUrl = await uploadImage(draft.file)
      await addDoc(collection(db, 'sellers', sellerId, 'products'), {
        name: draft.name,
        price: draft.price,
        description: '',
        imageUrl
      })

      setDrafts(prev => prev.map((d, idx) => idx === i ? { ...d, uploading: false, uploaded: true, imageUrl } : d))
    }

    setSaving(false)
    onDone()
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f0f', fontFamily: 'sans-serif', color: '#fff', padding: '32px 16px' }}>
      <div style={{ maxWidth: '640px', margin: '0 auto' }}>

        <h1 style={{ fontSize: '24px', fontWeight: '800', marginBottom: '8px' }}>Add Products in Bulk</h1>
        <p style={{ color: '#888', marginBottom: '32px', fontSize: '15px' }}>Select multiple photos from your phone or computer at once.</p>

        {/* File Picker */}
        <label style={{ display: 'block', background: '#1a1a1a', border: `2px dashed ${green}`, borderRadius: '12px', padding: '40px', textAlign: 'center', cursor: 'pointer', marginBottom: '24px' }}>
          <input type="file" accept="image/*" multiple onChange={handleFileSelect} style={{ display: 'none' }} />
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>📸</div>
          <p style={{ color: green, fontWeight: '700', fontSize: '16px', margin: '0 0 4px' }}>Tap to select photos</p>
          <p style={{ color: '#555', fontSize: '13px', margin: 0 }}>Select multiple at once from your gallery</p>
        </label>

        {/* Product Drafts */}
        {drafts.length > 0 && (
          <>
            <p style={{ color: '#888', fontSize: '13px', marginBottom: '16px' }}>{drafts.length} photo{drafts.length > 1 ? 's' : ''} selected — add name and price for each</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '24px' }}>
              {drafts.map((draft, i) => (
                <div key={i} style={{ background: '#1a1a1a', borderRadius: '12px', padding: '16px', border: `1px solid ${draft.uploaded ? green : '#222'}`, display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
                  <div style={{ position: 'relative', flexShrink: 0 }}>
                    <img src={draft.preview} alt="" style={{ width: '80px', height: '80px', objectFit: 'cover', borderRadius: '8px' }} />
                    {draft.uploading && (
                      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px' }}>⏳</div>
                    )}
                    {draft.uploaded && (
                      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px' }}>✅</div>
                    )}
                  </div>
                  <div style={{ flex: 1 }}>
                    <input
                      placeholder="Product name"
                      value={draft.name}
                      onChange={e => updateDraft(i, 'name', e.target.value)}
                      style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #333', background: '#111', color: '#fff', fontSize: '14px', marginBottom: '8px', boxSizing: 'border-box' }}
                    />
                    <input
                      placeholder="Price e.g. 50000"
                      value={draft.price}
                      onChange={e => updateDraft(i, 'price', e.target.value)}
                      style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #333', background: '#111', color: '#fff', fontSize: '14px', boxSizing: 'border-box' }}
                    />
                  </div>
                  <button onClick={() => removeDraft(i)}
                    style={{ background: 'transparent', border: 'none', color: '#555', cursor: 'pointer', fontSize: '18px', padding: '4px' }}>
                    ✕
                  </button>
                </div>
              ))}
            </div>

            <button onClick={handleSaveAll} disabled={saving}
              style={{ width: '100%', padding: '16px', background: saving ? '#333' : green, color: '#000', border: 'none', borderRadius: '10px', fontWeight: '800', cursor: saving ? 'not-allowed' : 'pointer', fontSize: '16px' }}>
              {saving ? 'Saving products...' : `Save All ${drafts.filter(d => d.name && d.price).length} Products`}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

export default BulkUpload