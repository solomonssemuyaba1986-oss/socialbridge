import { useState } from 'react'
import { auth, db } from './firebase'
import { collection, doc, getDocs, query, setDoc, where } from 'firebase/firestore'
import { useNavigate } from 'react-router-dom'
import { getStorage, ref, getDownloadURL } from 'firebase/storage'

interface SetupFormErrors {
  businessName?: string
  bio?: string
  whatsapp?: string
  email?: string
  submit?: string
}

function SetupStore() {
  const [businessName, setBusinessName] = useState('')
  const [storeHandle, setStoreHandle] = useState('')
  const [handleAvailable, setHandleAvailable] = useState<boolean | null>(null)
  const [handleChecking, setHandleChecking] = useState(false)
  const [bio, setBio] = useState('')
  const [whatsapp, setWhatsapp] = useState('')
  const [email, setEmail] = useState(auth.currentUser?.email || '')
  const [instagram, setInstagram] = useState('')
  const [tiktok, setTiktok] = useState('')
  const [errors, setErrors] = useState<SetupFormErrors>({})
  const [loading, setLoading] = useState(false)
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [logoPreview, setLogoPreview] = useState('')
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const navigate = useNavigate()

  const sanitizeInput = (input: string, maxLength: number = 100): string => {
    return input.trim().slice(0, maxLength).replace(/<[^>]*>/g, '')
  }

  const sanitizeHandle = (input: string): string => {
    return input.toLowerCase().trim().replace(/[^a-z0-9_-]/g, '').replace(/-+/g, '-').replace(/_+/g, '_').slice(0, 30)
  }

  // Debounced handle availability check
  let handleCheckTimer: ReturnType<typeof setTimeout> | null = null
  const checkHandleAvailability = async (handle: string) => {
    if (handle.length < 3) {
      setHandleAvailable(null)
      return
    }
    setHandleChecking(true)
    try {
      const q = query(collection(db, 'sellers'), where('slug', '==', handle))
      const snapshot = await getDocs(q)
      setHandleAvailable(snapshot.empty)
    } catch {
      setHandleAvailable(null)
    } finally {
      setHandleChecking(false)
    }
  }

  const handleHandleChange = (val: string) => {
    const cleaned = sanitizeHandle(val)
    setStoreHandle(cleaned)
    setHandleAvailable(null)
    if (handleCheckTimer) clearTimeout(handleCheckTimer)
    if (cleaned.length >= 3) {
      handleCheckTimer = setTimeout(() => checkHandleAvailability(cleaned), 500)
    }
  }

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

  const validateForm = (): boolean => {
    const newErrors: SetupFormErrors = {}
    const cleanedName = sanitizeInput(businessName)
    if (!cleanedName) {
      newErrors.businessName = 'Business name is required'
    } else if (cleanedName.length < 2) {
      newErrors.businessName = 'Business name must be at least 2 characters'
    }
    const cleanedBio = sanitizeInput(bio, 500)
    if (cleanedBio.length > 500) {
      newErrors.bio = 'Bio must be 500 characters or less'
    }
    if (whatsapp.length !== 9) {
      newErrors.whatsapp = 'Enter a valid 9-digit Uganda phone number'
    } else if (!/^7\d{8}$/.test(whatsapp)) {
      newErrors.whatsapp = 'Uganda number must start with 7'
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sanitizeInput(email))) {
      newErrors.email = 'Enter a valid email address'
    }
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleWhatsappChange = (val: string) => {
    const digits = val.replace(/\D/g, '').slice(0, 9)
    setWhatsapp(digits)
    if (digits.length === 9) {
      setErrors(e => ({ ...e, whatsapp: undefined }))
    }
  }

  const handleSubmit = async () => {
    if (!validateForm()) return
    const user = auth.currentUser
    if (!user) {
      setErrors({ submit: 'Not signed in. Please sign in again.' })
      return
    }
    setLoading(true)
    setErrors({})
    try {
      const cleanedName = sanitizeInput(businessName)
      const cleanedBio = sanitizeInput(bio, 500)
      const cleanedEmail = email ? sanitizeInput(email) : ''
      const cleanedInstagram = instagram ? sanitizeInput(instagram, 50).replace(/^@+/, '') : ''
      const cleanedTiktok = tiktok ? sanitizeInput(tiktok, 50).replace(/^@+/, '') : ''
      // Use the store handle as the slug (unique, chosen by seller)
      if (!storeHandle || storeHandle.length < 3) {
        setErrors({ submit: 'Please choose a store handle (at least 3 characters).' })
        setLoading(false)
        return
      }
      if (handleAvailable !== true) {
        setErrors({ submit: 'This store handle is already taken. Please choose another.' })
        setLoading(false)
        return
      }
      const slug = storeHandle
      const fullNumber = `256${whatsapp}`
      let finalLogoUrl = user.photoURL || ''
      if (logoFile) {
        try {
          setUploadingLogo(true)
          const processedBlob = await resizeImage(logoFile, 1024, 0.8)
          const processedFile = new File([processedBlob], 'logo.jpg', { type: 'image/jpeg' })
          const storage = getStorage()
          const storageRef = ref(storage, `sellers/${user.uid}/logo.jpg`)
          const uploadTask = (await import('firebase/storage')).uploadBytesResumable(storageRef, processedFile)

          await new Promise<void>((resolve, reject) => {
            uploadTask.on('state_changed', () => {
              // progress available if needed
            }, (error: any) => {
              console.error('Upload error', error)
              setUploadingLogo(false)
              reject(error)
            }, async () => {
              try {
                finalLogoUrl = await getDownloadURL(uploadTask.snapshot.ref)
                resolve()
              } catch (e) {
                reject(e)
              } finally {
                setUploadingLogo(false)
              }
            })
          })
        } catch (err) {
          console.error('Logo upload failed', err)
        } finally {
          setUploadingLogo(false)
        }
      }

      await setDoc(doc(db, 'sellers', user.uid), {
        businessName: cleanedName,
        bio: cleanedBio,
        whatsapp: fullNumber,
        logoUrl: finalLogoUrl,
        slug,
        email: cleanedEmail || user.email || '',
        instagram: cleanedInstagram,
        tiktok: cleanedTiktok,
        createdAt: new Date(),
      })
      navigate('/dashboard')
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to create store'
      if ((error as any)?.code === 'permission-denied') {
        setErrors({ submit: 'Permission denied: cannot create store. Check authentication or Firestore rules.' })
      } else {
        setErrors({ submit: errorMessage })
      }
      console.error('Setup error:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f9f9f9', fontFamily: 'sans-serif', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <h1 style={{ fontSize: '24px', fontWeight: '700', marginBottom: '8px' }}>Set up your store</h1>
      <p style={{ color: '#666', marginBottom: '32px' }}>Your store will be live in seconds</p>

      <div style={{ background: '#fff', borderRadius: '12px', padding: '32px', width: '100%', maxWidth: '480px', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
        {errors.submit && (
          <div style={{ background: '#fee', border: '1px solid #fcc', borderRadius: '8px', padding: '12px', marginBottom: '16px', color: '#c33', fontSize: '14px' }}>
            {errors.submit}
          </div>
        )}
        
        <label style={{ fontSize: '14px', fontWeight: '600', color: '#333' }}>Business Name</label>
        <input value={businessName} onChange={e => setBusinessName(e.target.value)}
          placeholder="e.g. Zara Cosmetics"
          style={{ width: '100%', padding: '12px', borderRadius: '8px', border: errors.businessName ? '2px solid #c33' : '1px solid #ddd', marginTop: '8px', marginBottom: '4px', fontSize: '15px', boxSizing: 'border-box' }} />
        {errors.businessName && <p style={{ color: '#c33', fontSize: '12px', margin: '4px 0 16px' }}>{errors.businessName}</p>}
        {!errors.businessName && <div style={{ marginBottom: '16px' }} />}

        <label style={{ fontSize: '14px', fontWeight: '600', color: '#333' }}>Store Handle</label>
        <p style={{ fontSize: '12px', color: '#888', margin: '4px 0 8px' }}>
          Choose a unique handle — like Instagram/TikTok usernames. This is your store URL: rachett.com/store/<strong style={{ color: '#333' }}>{storeHandle || 'your-handle'}</strong>
        </p>
        <div style={{ display: 'flex', alignItems: 'center', border: '1px solid #ddd', borderRadius: '8px', overflow: 'hidden', marginBottom: '4px' }}>
          <div style={{ background: '#f5f5f5', padding: '12px 14px', fontSize: '14px', borderRight: '1px solid #ddd', color: '#888', whiteSpace: 'nowrap' }}>
            rachett.com/store/
          </div>
          <input
            value={storeHandle}
            onChange={e => handleHandleChange(e.target.value)}
            placeholder="your-store-name"
            maxLength={30}
            style={{ flex: 1, padding: '12px', border: 'none', outline: 'none', fontSize: '15px', background: '#fff' }}
          />
        </div>
        {handleChecking && <p style={{ color: '#888', fontSize: '12px', margin: '4px 0 16px' }}>Checking availability...</p>}
        {!handleChecking && handleAvailable === true && (
          <p style={{ color: '#4a4', fontSize: '12px', margin: '4px 0 16px' }}>✓ Available! @{storeHandle}</p>
        )}
        {!handleChecking && handleAvailable === false && (
          <p style={{ color: '#c33', fontSize: '12px', margin: '4px 0 16px' }}>✗ Sorry, @{storeHandle} is already taken. Try another.</p>
        )}
        {!handleChecking && handleAvailable === null && storeHandle.length >= 3 && (
          <p style={{ color: '#888', fontSize: '12px', margin: '4px 0 16px' }}>Click "Create" to check availability</p>
        )}
        {storeHandle.length === 0 && <div style={{ marginBottom: '16px' }} />}

        <label style={{ fontSize: '14px', fontWeight: '600', color: '#333' }}>Bio</label>
        <textarea value={bio} onChange={e => setBio(e.target.value)}
          placeholder="Tell customers what you sell..."
          rows={3}
          style={{ width: '100%', padding: '12px', borderRadius: '8px', border: errors.bio ? '2px solid #c33' : '1px solid #ddd', marginTop: '8px', marginBottom: '4px', fontSize: '15px', boxSizing: 'border-box', resize: 'none' }} />
        {errors.bio && <p style={{ color: '#c33', fontSize: '12px', margin: '4px 0 16px' }}>{errors.bio}</p>}
        {!errors.bio && <div style={{ marginBottom: '16px' }} />}

        <label style={{ fontSize: '14px', fontWeight: '600', color: '#333' }}>WhatsApp Number</label>
        <p style={{ fontSize: '12px', color: '#888', margin: '4px 0 8px' }}>Uganda number — we add 256 automatically</p>
        
        <div style={{ display: 'flex', alignItems: 'center', border: errors.whatsapp ? '2px solid #c33' : '1px solid #ddd', borderRadius: '8px', overflow: 'hidden', marginBottom: '4px' }}>
          <div style={{ background: '#f5f5f5', padding: '12px 14px', fontSize: '15px', borderRight: errors.whatsapp ? '2px solid #c33' : '1px solid #ddd', color: '#333', fontWeight: '600', whiteSpace: 'nowrap' }}>
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
        
        {errors.whatsapp && <p style={{ color: '#c33', fontSize: '12px', margin: '4px 0 16px' }}>{errors.whatsapp}</p>}
        {!errors.whatsapp && whatsapp.length === 9 && (
          <p style={{ color: '#4a4', fontSize: '12px', margin: '4px 0 16px' }}>✓ Number looks good</p>
        )}
        {!errors.whatsapp && whatsapp.length === 0 && <div style={{ marginBottom: '8px' }} />}

        <label style={{ fontSize: '14px', fontWeight: '600', color: '#333' }}>Email</label>
        <input value={email} onChange={e => setEmail(e.target.value)}
          placeholder="you@example.com"
          style={{ width: '100%', padding: '12px', borderRadius: '8px', border: errors.email ? '2px solid #c33' : '1px solid #ddd', marginTop: '8px', marginBottom: '4px', fontSize: '15px', boxSizing: 'border-box' }} />
        {errors.email && <p style={{ color: '#c33', fontSize: '12px', margin: '4px 0 16px' }}>{errors.email}</p>}
        {!errors.email && <div style={{ marginBottom: '16px' }} />}

        <label style={{ fontSize: '14px', fontWeight: '600', color: '#333' }}>Instagram username</label>
        <input value={instagram} onChange={e => setInstagram(e.target.value)}
          placeholder="yourhandle"
          style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #ddd', marginTop: '8px', marginBottom: '4px', fontSize: '15px', boxSizing: 'border-box' }} />
        <p style={{ fontSize: '12px', color: '#888', margin: '4px 0 16px' }}>Add your Instagram handle without the @</p>

        <label style={{ fontSize: '14px', fontWeight: '600', color: '#333' }}>TikTok username</label>
        <input value={tiktok} onChange={e => setTiktok(e.target.value)}
          placeholder="yourhandle"
          style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #ddd', marginTop: '8px', marginBottom: '4px', fontSize: '15px', boxSizing: 'border-box' }} />
        <p style={{ fontSize: '12px', color: '#888', margin: '4px 0 16px' }}>Add your TikTok handle without the @</p>

        <label style={{ fontSize: '14px', fontWeight: '600', color: '#333' }}>Logo (optional)</label>
        <div style={{ margin: '8px 0 12px' }}>
          <input type="file" accept="image/*" onChange={e => { const f = e.target.files?.[0]; if (f) { setLogoFile(f); setLogoPreview(URL.createObjectURL(f)) } }} />
        </div>
        {logoPreview && <div style={{ marginBottom: '12px' }}><img src={logoPreview} alt="logo preview" style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 8 }} /></div>}

        <button onClick={handleSubmit} disabled={loading || uploadingLogo}
          style={{ width: '100%', padding: '14px', background: loading ? '#999' : '#1a1a1a', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '16px', fontWeight: '600', cursor: loading ? 'not-allowed' : 'pointer', marginTop: '8px' }}>
          {loading || uploadingLogo ? 'Creating...' : 'Create My Store'}
        </button>
      </div>
    </div>
  )
}

export default SetupStore