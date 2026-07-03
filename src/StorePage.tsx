import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { collection, query, where, getDocs, addDoc, setDoc, doc } from 'firebase/firestore'
import { db, auth } from './firebase'
import { suppressNextSellerOrderAlert } from './orderAlerts.ts'
import { onAuthStateChanged, signInWithPopup, GoogleAuthProvider } from 'firebase/auth'
import { CATEGORIES, getSubcategories } from './categories'
import { useConversation } from './useConversation.ts'

interface Seller {
  businessName: string
  bio: string
  logoUrl: string
  slug: string
  whatsapp?: string
  email?: string
  instagram?: string
  tiktok?: string
}

interface Product {
  id: string
  name: string
  price: string
  description: string
  imageUrl: string
  category?: string
  subCategory?: string
  outOfStock?: boolean
  orderCount?: number
}

const green = '#adff2f'
const CLOUD_NAME = 'dzudmmuxg'
const UPLOAD_PRESET = 'p2z65zrv'

function detectPlatform(searchParams: URLSearchParams) {
  const rawSource = (searchParams.get('source') || searchParams.get('utm_source') || '').toLowerCase()
  const referrer = typeof document !== 'undefined' ? document.referrer.toLowerCase() : ''

  if (rawSource.includes('whatsapp')) return 'WhatsApp'
  if (rawSource.includes('instagram')) return 'Instagram'
  if (rawSource.includes('tiktok')) return 'TikTok'
  if (rawSource.includes('telegram')) return 'Telegram'
  if (rawSource.includes('twitter')) return 'Twitter'
  if (rawSource.includes('facebook')) return 'Facebook'
  if (rawSource.includes('email')) return 'Email'
  if (rawSource.includes('web')) return 'Web'

  if (referrer.includes('whatsapp') || referrer.includes('wa.me') || referrer.includes('api.whatsapp.com')) return 'WhatsApp'
  if (referrer.includes('instagram.com')) return 'Instagram'
  if (referrer.includes('tiktok.com')) return 'TikTok'
  if (referrer.includes('telegram.me') || referrer.includes('t.me')) return 'Telegram'
  if (referrer.includes('twitter.com')) return 'Twitter'
  if (referrer.includes('facebook.com')) return 'Facebook'
  if (referrer.includes('mail.google.com') || referrer.includes('outlook.live.com') || referrer.includes('mail.yahoo.com')) return 'Email'

  return 'Web'
}

function ProductCard({ p, isOwner, sellerId, onOrder, onMessage, onRefresh }: any) {
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(p.name)
  const [editPrice, setEditPrice] = useState(p.price)
  const [editDescription, setEditDescription] = useState(p.description)
  const [editImages, setEditImages] = useState<string[]>(p.images || [p.imageUrl].filter(Boolean))
  const [uploadingEdit, setUploadingEdit] = useState(false)
  const [isOutOfStock, setIsOutOfStock] = useState(p.outOfStock || false)
  const [currentImageIndex, setCurrentImageIndex] = useState(0)

  const images = p.images?.length > 0 ? p.images : [p.imageUrl].filter(Boolean)

  const handleEditImageUpload = async (files: FileList) => {
    if (editImages.length >= 4) return alert('Maximum 4 images per product')
    setUploadingEdit(true)
    const remaining = 4 - editImages.length
    const filesToUpload = Array.from(files).slice(0, remaining)
    const newUrls: string[] = []

    for (const file of filesToUpload) {
      const canvas = document.createElement('canvas')
      const img = new Image()
      await new Promise<void>(resolve => {
        img.onload = async () => {
          const maxSize = 800
          let width = img.width
          let height = img.height
          if (width > height && width > maxSize) {
            height = (height * maxSize) / width
            width = maxSize
          } else if (height > maxSize) {
            width = (width * maxSize) / height
            height = maxSize
          }
          canvas.width = width
          canvas.height = height
          const ctx = canvas.getContext('2d')!
          ctx.drawImage(img, 0, 0, width, height)
          canvas.toBlob(async blob => {
            const compressed = new File([blob!], file.name, { type: 'image/jpeg' })
            const formData = new FormData()
            formData.append('file', compressed)
            formData.append('upload_preset', UPLOAD_PRESET)
            const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, { method: 'POST', body: formData })
            const data = await res.json()
            newUrls.push(data.secure_url)
            resolve()
          }, 'image/jpeg', 0.7)
        }
        img.src = URL.createObjectURL(file)
      })
    }

    setEditImages(prev => [...prev, ...newUrls])
    setUploadingEdit(false)
  }

  const removeEditImage = (index: number) => {
    setEditImages(prev => prev.filter((_, i) => i !== index))
  }

  const handleSave = async () => {
    const { updateDoc, doc } = await import('firebase/firestore')
    await updateDoc(doc(db, 'sellers', sellerId, 'products', p.id), {
      name: editName,
      price: editPrice,
      description: editDescription,
      imageUrl: editImages[0] || p.imageUrl,
      images: editImages
    })
    setEditing(false)
    onRefresh()
  }

  const handleDelete = async () => {
    if (!confirm(`Delete ${p.name}?`)) return
    const { deleteDoc, doc } = await import('firebase/firestore')
    await deleteDoc(doc(db, 'sellers', sellerId, 'products', p.id))
    onRefresh()
  }

  const toggleOutOfStock = async () => {
    const newStatus = !isOutOfStock
    const { updateDoc, doc } = await import('firebase/firestore')
    await updateDoc(doc(db, 'sellers', sellerId, 'products', p.id), { outOfStock: newStatus })
    setIsOutOfStock(newStatus)
  }

  const storeLink = `${window.location.origin}${window.location.pathname}`
  const getProductUrl = () => `${storeLink}?productId=${p.id}`
  const getCaption = () =>
    `${p.name} — UGX ${p.price}\nSee more from this seller at ${storeLink}\n${getProductUrl()}`

  const shareToWhatsApp = () => window.open(`https://wa.me/?text=${encodeURIComponent(getCaption())}`, '_blank')
  const shareToTelegram = () => window.open(`https://t.me/share/url?url=${encodeURIComponent(getProductUrl())}&text=${encodeURIComponent(getCaption())}`, '_blank')
  const shareToTwitter = () => window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(getCaption())}`, '_blank')
  const shareToFacebook = () => window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(getProductUrl())}`, '_blank')
  const copyCaption = async () => { await navigator.clipboard.writeText(getCaption()); alert('Caption copied!') }


  return (
    <div style={{ background: '#1a1a1a', borderRadius: '12px', overflow: 'hidden', border: `1px solid ${isOutOfStock ? '#333' : '#222'}`, position: 'relative', opacity: isOutOfStock && !isOwner ? 0.7 : 1 }}>

      {/* Out of Stock Badge */}
      {isOutOfStock && (
        <div style={{ position: 'absolute', top: '8px', left: '8px', background: '#ff4444', color: '#fff', padding: '4px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: '700', zIndex: 2 }}>
          Out of Stock
        </div>
      )}

      {/* Image Counter */}
      {images.length > 1 && (
        <div style={{ position: 'absolute', top: '8px', right: '8px', background: 'rgba(0,0,0,0.6)', color: '#fff', padding: '4px 8px', borderRadius: '20px', fontSize: '11px', fontWeight: '700', zIndex: 2 }}>
          {currentImageIndex + 1}/{images.length}
        </div>
      )}

      {/* Image with Navigation */}
      <div style={{ position: 'relative' }}>
        <img
          src={images[currentImageIndex] || 'https://placehold.co/300x200/1a1a1a/333333'}
          alt={p.name}
          style={{ width: '100%', height: '160px', objectFit: 'cover', filter: isOutOfStock ? 'grayscale(60%)' : 'none' }}
        />
        {images.length > 1 && (
          <>
            <button
              onClick={() => setCurrentImageIndex(prev => prev === 0 ? images.length - 1 : prev - 1)}
              style={{ position: 'absolute', left: '6px', top: '50%', transform: 'translateY(-50%)', background: 'rgba(0,0,0,0.5)', border: 'none', color: '#fff', borderRadius: '50%', width: '24px', height: '24px', cursor: 'pointer', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              ‹
            </button>
            <button
              onClick={() => setCurrentImageIndex(prev => prev === images.length - 1 ? 0 : prev + 1)}
              style={{ position: 'absolute', right: '6px', top: '50%', transform: 'translateY(-50%)', background: 'rgba(0,0,0,0.5)', border: 'none', color: '#fff', borderRadius: '50%', width: '24px', height: '24px', cursor: 'pointer', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              ›
            </button>
          </>
        )}
      </div>

      <div style={{ padding: '12px' }}>
        {editing ? (
          <>
            {/* Image Management */}
            <p style={{ color: '#888', fontSize: '12px', marginBottom: '8px' }}>Product Images ({editImages.length}/4)</p>
            <div style={{ display: 'flex', gap: '6px', marginBottom: '8px', flexWrap: 'wrap' }}>
              {editImages.map((url, i) => (
                <div key={i} style={{ position: 'relative' }}>
                  <img src={url} alt="" style={{ width: '56px', height: '56px', objectFit: 'cover', borderRadius: '6px', border: i === 0 ? `2px solid ${green}` : '2px solid #333' }} />
                  <button onClick={() => removeEditImage(i)}
                    style={{ position: 'absolute', top: '-6px', right: '-6px', background: '#ff4444', border: 'none', color: '#fff', borderRadius: '50%', width: '16px', height: '16px', cursor: 'pointer', fontSize: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    ✕
                  </button>
                  {i === 0 && <p style={{ color: green, fontSize: '9px', textAlign: 'center', margin: '2px 0 0' }}>Main</p>}
                </div>
              ))}
              {editImages.length < 4 && (
                <label style={{ width: '56px', height: '56px', border: '1px dashed #333', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#555', fontSize: '20px' }}>
                  <input type="file" accept="image/*" multiple onChange={e => { if (e.target.files) handleEditImageUpload(e.target.files) }} style={{ display: 'none' }} />
                  +
                </label>
              )}
            </div>
            {uploadingEdit && <p style={{ color: '#888', fontSize: '12px', marginBottom: '8px' }}>Uploading...</p>}

            <input value={editName} onChange={e => setEditName(e.target.value)}
              style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #333', background: '#111', color: '#fff', fontSize: '13px', marginBottom: '8px', boxSizing: 'border-box' }} />
            <input value={editPrice} onChange={e => setEditPrice(e.target.value)}
              style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #333', background: '#111', color: '#fff', fontSize: '13px', marginBottom: '8px', boxSizing: 'border-box' }} />
            <input value={editDescription} onChange={e => setEditDescription(e.target.value)}
              style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #333', background: '#111', color: '#fff', fontSize: '13px', marginBottom: '8px', boxSizing: 'border-box' }} />
            <button onClick={handleSave} disabled={uploadingEdit}
              style={{ width: '100%', padding: '8px', background: uploadingEdit ? '#333' : green, color: '#000', border: 'none', borderRadius: '6px', fontWeight: '700', cursor: 'pointer', fontSize: '13px', marginBottom: '6px' }}>
              Save
            </button>
            <button onClick={() => setEditing(false)}
              style={{ width: '100%', padding: '8px', background: 'transparent', color: '#555', border: '1px solid #333', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <p style={{ margin: '0 0 4px', fontWeight: '700', fontSize: '14px', color: isOutOfStock ? '#666' : '#fff' }}>{p.name}</p>
            <p style={{ margin: '0 0 8px', color: '#555', fontSize: '12px' }}>{p.description}</p>
            <p style={{ margin: '0 0 12px', fontWeight: '800', color: isOutOfStock ? '#555' : green, fontSize: '15px' }}>UGX {p.price}</p>

            {isOwner && (
              <>
                <button onClick={() => setEditing(true)}
                  style={{ width: '100%', padding: '8px', background: 'transparent', color: green, border: `1px solid ${green}`, borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: '600', marginBottom: '6px' }}>
                  Edit
                </button>
                <button onClick={toggleOutOfStock}
                  style={{ width: '100%', padding: '8px', background: isOutOfStock ? '#1a2a1a' : 'transparent', color: isOutOfStock ? green : '#ff4444', border: `1px solid ${isOutOfStock ? green : '#ff4444'}`, borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: '600', marginBottom: '6px' }}>
                  {isOutOfStock ? '✓ Back in Stock' : 'Mark Out of Stock'}
                </button>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '6px' }}>
                  <button onClick={shareToWhatsApp} style={{ flex: '1 1 48%', padding: '8px', background: '#25D366', border: 'none', color: '#000', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>WhatsApp</button>
                  <button onClick={shareToTelegram} style={{ flex: '1 1 48%', padding: '8px', background: '#2CA5E0', border: 'none', color: '#000', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>Telegram</button>
                  <button onClick={shareToTwitter} style={{ flex: '1 1 48%', padding: '8px', background: '#1DA1F2', border: 'none', color: '#000', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>Twitter</button>
                  <button onClick={shareToFacebook} style={{ flex: '1 1 48%', padding: '8px', background: '#4267B2', border: 'none', color: '#fff', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>Facebook</button>
                  <button onClick={copyCaption} style={{ width: '100%', padding: '8px', marginTop: '6px', background: '#444', border: 'none', color: '#fff', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>Copy caption</button>
                </div>
                <button onClick={handleDelete}
                  style={{ width: '100%', padding: '8px', background: 'transparent', color: '#555', border: '1px solid #333', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>
                  Delete
                </button>
              </>
            )}

            {!isOwner && (
              isOutOfStock ? (
                <div>
                  <div style={{ width: '100%', padding: '10px', background: '#222', color: '#666', borderRadius: '8px', fontSize: '13px', textAlign: 'center', marginBottom: '6px' }}>
                    Out of Stock
                  </div>
                  <a href={`https://wa.me/${p.sellerWhatsapp}?text=Hi! Is ${p.name} back in stock soon?`}
                    target="_blank"
                    style={{ display: 'block', width: '100%', padding: '10px', background: 'transparent', color: green, border: `1px solid ${green}`, borderRadius: '8px', fontSize: '12px', textAlign: 'center', textDecoration: 'none', boxSizing: 'border-box', fontWeight: '600' }}>
                    Ask Seller
                  </a>
                </div>
              ) : (
                <div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={onMessage}
                    style={{ flex: 1, padding: '10px', background: '#222', color: green, border: `1px solid ${green}`, borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '13px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                    <img src="/message icon.png" alt="message" style={{ width: '14px', height: '14px' }} />
                    Message
                  </button>
                  <button onClick={onOrder}
                    style={{ flex: 1, padding: '10px', background: green, color: '#000', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '13px' }}>
                    Order Now
                  </button>
                </div>
              </div>
              )
            )}
          </>
        )}
      </div>
    </div>
  )
}
function StorePage() {
  const { slug } = useParams()
  const [searchParams] = useSearchParams()
  const productDeepLinkId = searchParams.get('productId')
  const [seller, setSeller] = useState<Seller | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [isOwner, setIsOwner] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(true)
  const [sellerId, setSellerId] = useState<string>('')
  const [orderSuccess, setOrderSuccess] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string>('')

  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [description, setDescription] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [category, setCategory] = useState('')
  const [subCategory, setSubCategory] = useState('')

  const [orderProduct, setOrderProduct] = useState<Product | null>(null)
  const [messageProduct, setMessageProduct] = useState<Product | null>(null)
  const [messageText, setMessageText] = useState('')
  const {sendMessage} = useConversation(sellerId, auth.currentUser?.uid ?? null)
  const [showSignupSheet, setShowSignupSheet] = useState(false)
  const [buyerName, setBuyerName] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [deliveryArea, setDeliveryArea] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    const fetchSeller = async () => {
      try {
        const q = query(collection(db, 'sellers'), where('slug', '==', slug))
        const snapshot = await getDocs(q)
        console.log('StorePage: seller query count', snapshot.size, 'slug', slug)
        if (!snapshot.empty) {
          const docData = snapshot.docs[0]
          console.log('StorePage: found seller doc', docData.id, docData.data())
          setSeller(docData.data() as Seller)
          setSellerId(docData.id)
          await fetchProducts(docData.id)
          const unsubscribe = onAuthStateChanged(auth, (user) => {
            if (user && user.uid === docData.id) setIsOwner(true)
          })
          return unsubscribe
        }
      } catch (err) {
        console.error('Store page load failed:', err)
      } finally {
        setLoading(false)
      }
    }
    const cleanupPromise = fetchSeller()
    return () => {
      cleanupPromise.then((unsubscribe) => {
        if (typeof unsubscribe === 'function') unsubscribe()
      }).catch(() => {})
    }
  }, [slug])

  useEffect(() => {
    if (!orderProduct && productDeepLinkId && products.length > 0) {
      const deepProduct = products.find(p => p.id === productDeepLinkId)
      if (deepProduct) {
        setOrderProduct(deepProduct)
      }
    }
  }, [productDeepLinkId, products, orderProduct])

  const fetchProducts = async (sid: string) => {
    try {
      console.log('StorePage: fetching products for seller', sid)
      const q = query(collection(db, 'sellers', sid, 'products'))
      const snapshot = await getDocs(q)
      console.log('StorePage: products query result count', snapshot.size)
      const list = snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as Product[]
      setProducts(list)
      setErrorMsg('')
    } catch (err: any) {
      console.error('Failed to load store products:', err)
      if (err?.code === 'permission-denied') {
        setErrorMsg('Permission denied when loading products. Check Firestore rules or authentication.')
      } else {
        setErrorMsg('Failed to load products. Check network or permissions.')
      }
      setProducts([])
    }
  }

const compressImage = (file: File): Promise<File> => {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas')
    const img = new Image()
    img.onload = () => {
      const maxSize = 800
      let width = img.width
      let height = img.height
      if (width > height && width > maxSize) {
        height = (height * maxSize) / width
        width = maxSize
      } else if (height > maxSize) {
        width = (width * maxSize) / height
        height = maxSize
      }
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0, width, height)
      canvas.toBlob(blob => {
        resolve(new File([blob!], file.name, { type: 'image/jpeg' }))
      }, 'image/jpeg', 0.7)
    }
    img.src = URL.createObjectURL(file)
  })
}

const handleImageUpload = async (file: File) => {
  setUploading(true)
  const compressed = await compressImage(file)
  const formData = new FormData()
  formData.append('file', compressed)
  formData.append('upload_preset', UPLOAD_PRESET)
  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, {
    method: 'POST',
    body: formData
  })
  const data = await res.json()
  setImageUrl(data.secure_url)
  setUploading(false)
}

  const handleAddProduct = async () => {
    if (!name || !price) return alert('Name and price are required')
    if (!imageUrl) return alert('Please upload a product image')
    if (!category) return alert('Please select a category')
    if (!subCategory) return alert('Please select a subcategory')
    await addDoc(collection(db, 'sellers', sellerId, 'products'), {
      name, price, description, imageUrl, category, subCategory
    })
    setName(''); setPrice(''); setDescription(''); setImageUrl(''); setCategory(''); setSubCategory('')
    setShowForm(false)
    fetchProducts(sellerId)
  }

const handleOrder = async () => {
  if (!buyerName) return alert('Please enter your name')
  if (!deliveryArea) return alert('Please enter your delivery area')
  if (!orderProduct || !seller) return

  const sourcePlatform = detectPlatform(searchParams)

  const orderRef = await addDoc(collection(db, 'sellers', sellerId, 'orders'), {
    buyerName,
    productName: orderProduct.name,
    productPrice: orderProduct.price,
    quantity,
    deliveryArea,
    status: 'pending',
    read: false,
    sourcePlatform,
    createdAt: new Date()
  })

  const orderId = `RT-${orderRef.id.slice(0, 6).toUpperCase()}`

  await import('firebase/firestore').then(({ updateDoc, doc }) =>
    updateDoc(doc(db, 'sellers', sellerId, 'orders', orderRef.id), { orderId })
  )

  // Increment product orderCount
  await import('firebase/firestore').then(({ updateDoc, doc }) =>
    updateDoc(doc(db, 'sellers', sellerId, 'products', orderProduct.id), { 
      orderCount: (orderProduct.orderCount || 0) + 1 
    })
  )

  if (auth.currentUser?.uid === sellerId) {
    suppressNextSellerOrderAlert()
  }

  const whatsappText =
`🟢 NEW ORDER — Rachett

Customer: ${buyerName}
Product: ${orderProduct.name}
Price: UGX ${orderProduct.price}
Quantity: ${quantity}
Total: UGX ${Number(orderProduct.price.replace(/,/g, '')) * Number(quantity)}
Delivery Area: ${deliveryArea}
Platform: ${sourcePlatform}
${message ? `Message: ${message}
` : ''}
Order ID: #${orderId}`


  const whatsappNumber = seller.whatsapp || ''
  setOrderSuccess(true)
  setTimeout(() => {
    window.open(`https://wa.me/${whatsappNumber}?text=${encodeURIComponent(whatsappText)}`, '_blank')
    setBuyerName(''); setQuantity('1'); setDeliveryArea(''); setMessage('')
    setOrderProduct(null)
    setOrderSuccess(false)
  }, 1500)
}

const handleSendMessage = async () => {
  if (!messageText.trim()) return alert('Please write a message')
  if (!messageProduct || !seller) return

  if (!auth.currentUser) {
    setShowSignupSheet(true)
    return
  }

  try {
    await sendMessage(
      auth.currentUser.uid,
      messageText.trim(),
      seller.businessName || 'Seller',
      auth.currentUser.displayName || 'Buyer'
    )
    console.log('Message sent')
    setMessageText('')
    setMessageProduct(null)
  } catch (err: any) {
    console.error('opps! something is not adding up:', err?.code, err?.message, err)
    alert(`opps! something is not adding up: ${err?.code || 'error'} - ${err?.message || err}`)
  }
}

const handleSignupAndSendMessage = async () => {
  try {
    const provider = new GoogleAuthProvider()
    const result = await signInWithPopup(auth, provider)
    console.log('User signed up/in:', result.user.uid)

    await setDoc(doc(db, 'users', result.user.uid), {
      displayName: result.user.displayName || '',
      email: result.user.email || '',
      lastSeen: new Date(),
      signupAt: new Date()
    }, { merge: true })

    // Now send the message
    if (messageText.trim() && messageProduct && seller) {
      await sendMessage(
        result.user.uid,
        messageText.trim(),
        seller.businessName || 'Seller',
        result.user.displayName || 'Buyer'
      )
      console.log('Message sent')
      setMessageText('')
      setMessageProduct(null)
      setShowSignupSheet(false)
    }
  } catch (err) {
    console.error('Signup/message error:', err)
    alert('opps! something went wrong during signup or sending the message. Please try again.')
  }
}

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#0f0f0f', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: '#555', fontFamily: 'sans-serif' }}>Loading store...</p>
    </div>
  )

  if (!seller) return (
    <div style={{ minHeight: '100vh', background: '#0f0f0f', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: '#555', fontFamily: 'sans-serif' }}>Store not found.</p>
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f0f', fontFamily: 'sans-serif', color: '#fff' }}>
      {/* Back to Browse */}
       <div style={{ padding: '12px 20px', borderBottom: '1px solid #1a1a1a' }}>
          <button onClick={() => window.history.back()}
            style={{ background: 'transparent', border: 'none', color: '#888', cursor: 'pointer', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '6px', padding: 0 }}>
           ← Back
       </button>
    </div>

      {/* Header */}
      <div style={{ padding: '48px 20px 32px', textAlign: 'center', borderBottom: '1px solid #1a1a1a' }}>
        <img src={seller.logoUrl || 'https://placehold.co/100'} alt="logo"
          style={{ width: '90px', height: '90px', borderRadius: '50%', objectFit: 'cover', marginBottom: '16px', border: `3px solid ${green}` }} />
        <h1 style={{ margin: '0 0 8px', fontSize: '26px', fontWeight: '800', color: '#fff', letterSpacing: '-0.5px' }}>
          {seller.businessName}
        </h1>
        <p style={{ margin: '0 0 16px', color: '#888', fontSize: '15px', maxWidth: '360px', marginInline: 'auto' }}>
          {seller.bio}
        </p>
        {productDeepLinkId && (
          <div style={{ maxWidth: '520px', margin: '0 auto 18px', background: '#111', border: `1px solid ${green}`, borderRadius: '14px', padding: '16px' }}>
            <p style={{ margin: 0, color: '#fff', fontWeight: '700', fontSize: '15px' }}>See more products below</p>
            <p style={{ margin: '8px 0 0', color: '#bbb', fontSize: '13px' }}>
              This product was shared from {seller.businessName}. Browse the full store for more items.
            </p>
          </div>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '10px', marginBottom: '16px' }}>
          {seller.email && (
            <a href={`mailto:${seller.email}`} style={{ color: '#fff', fontSize: '13px', textDecoration: 'none', background: '#111', padding: '8px 12px', borderRadius: '999px', border: '1px solid #333' }}>
              ✉️ {seller.email}
            </a>
          )}
          {seller.instagram && (
            <a href={`https://instagram.com/${seller.instagram}`} target="_blank" rel="noreferrer" style={{ color: '#fff', fontSize: '13px', textDecoration: 'none', background: '#111', padding: '8px 12px', borderRadius: '999px', border: '1px solid #333' }}>
              📸 @{seller.instagram}
            </a>
          )}
          {seller.tiktok && (
            <a href={`https://www.tiktok.com/@${seller.tiktok}`} target="_blank" rel="noreferrer" style={{ color: '#fff', fontSize: '13px', textDecoration: 'none', background: '#111', padding: '8px 12px', borderRadius: '999px', border: '1px solid #333' }}>
              🎵 @{seller.tiktok}
            </a>
          )}
        </div>
        {isOwner && (
          <button onClick={() => { auth.signOut(); window.location.href = '/' }}
            style={{ background: 'transparent', border: '1px solid #333', borderRadius: '8px', padding: '8px 16px', fontSize: '13px', color: '#555', cursor: 'pointer' }}>
            Log out
          </button>
        )}
      </div>

      {/* Products */}
      <div style={{ maxWidth: '640px', margin: '0 auto', padding: '32px 16px' }}>
        <div className="rt-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2 style={{ fontSize: '16px', fontWeight: '700', margin: 0, color: '#aaa', textTransform: 'uppercase', letterSpacing: '1px' }}>Products</h2>
          {isOwner && (
            <button onClick={() => setShowForm(!showForm)}
              style={{ background: green, color: '#000', border: 'none', borderRadius: '8px', padding: '10px 18px', cursor: 'pointer', fontWeight: '700', fontSize: '13px' }}>
              + Add Product
            </button>
          )}
        </div>
        {errorMsg && (
          <div style={{ background: '#fee', border: '1px solid #fcc', color: '#c33', padding: '12px', borderRadius: '8px', marginBottom: '16px' }}>
            {errorMsg}
          </div>
        )}

        {/* Add Product Form */}
        {showForm && (
          <div style={{ background: '#1a1a1a', borderRadius: '12px', padding: '24px', marginBottom: '24px', border: '1px solid #222' }}>
            <input placeholder="Product name" value={name} onChange={e => setName(e.target.value)}
              style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #333', marginBottom: '12px', boxSizing: 'border-box', fontSize: '14px', background: '#111', color: '#fff' }} />
            <input placeholder="Price e.g. 200000" value={price} onChange={e => setPrice(e.target.value)}
              style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #333', marginBottom: '12px', boxSizing: 'border-box', fontSize: '14px', background: '#111', color: '#fff' }} />
            <select value={category} onChange={e => { setCategory(e.target.value); setSubCategory('') }}
              style={{ width: '100%', padding: '12px', borderRadius: '8px', border: category ? '1px solid #333' : '1px solid #ff4444', marginBottom: '12px', boxSizing: 'border-box', fontSize: '14px', background: '#111', color: category ? '#fff' : '#666' }}>
              <option value="">Select Category *</option>
              {Object.keys(CATEGORIES).map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
            {category && (
              <select value={subCategory} onChange={e => setSubCategory(e.target.value)}
                style={{ width: '100%', padding: '12px', borderRadius: '8px', border: subCategory ? '1px solid #333' : '1px solid #ff4444', marginBottom: '12px', boxSizing: 'border-box', fontSize: '14px', background: '#111', color: subCategory ? '#fff' : '#666' }}>
                <option value="">Select Subcategory *</option>
                {getSubcategories(category).map(sub => (
                  <option key={sub} value={sub}>{sub}</option>
                ))}
              </select>
            )}
            <textarea placeholder="Description" value={description} onChange={e => setDescription(e.target.value)}
              style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #333', marginBottom: '12px', boxSizing: 'border-box', fontSize: '14px', background: '#111', color: '#fff', resize: 'none' }} rows={3} />
            <div style={{ marginBottom: '16px' }}>
              <label style={{ fontSize: '13px', color: '#888', marginBottom: '8px', display: 'block' }}>Product Image</label>
              <input type="file" accept="image/*"
                onChange={e => { const file = e.target.files?.[0]; if (file) handleImageUpload(file) }}
                style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #333', boxSizing: 'border-box', fontSize: '14px', background: '#111', color: '#fff' }} />
              {uploading && <p style={{ color: '#888', fontSize: '13px', marginTop: '8px' }}>Uploading image...</p>}
              {imageUrl && !uploading && (
                <img src={imageUrl} alt="preview"
                  style={{ width: '100%', height: '140px', objectFit: 'cover', borderRadius: '8px', marginTop: '8px', border: `1px solid ${green}` }} />
              )}
            </div>
            <button onClick={handleAddProduct} disabled={uploading}
              style={{ width: '100%', padding: '12px', background: uploading ? '#333' : green, color: '#000', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '15px' }}>
              {uploading ? 'Uploading...' : 'Save Product'}
            </button>
          </div>
        )}

        {/* Product Grid */}
        {products.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px', border: '1px dashed #222', borderRadius: '12px' }}>
            <p style={{ color: '#444', fontSize: '14px' }}>{isOwner ? 'Add your first product above' : 'No products yet'}</p>
            {errorMsg && <p style={{ color: '#c33', fontSize: '13px', marginTop: '8px' }}>{errorMsg}</p>}
          </div>
        ) : (
          <div className="rt-products" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            {products.map(p => (
              <ProductCard
                key={p.id}
                p={{ ...p, sellerWhatsapp: seller.whatsapp }}
                isOwner={isOwner}
                sellerId={sellerId}
                onOrder={() => setOrderProduct(p)}
                onMessage={() => setMessageProduct(p)}
                onRefresh={() => fetchProducts(sellerId)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{ textAlign: 'center', padding: '24px', borderTop: '1px solid #1a1a1a' }}>
        <p style={{ color: '#333', fontSize: '12px', margin: 0 }}>
          Powered by <span style={{ color: green, fontWeight: '700' }}>Rachett</span>
        </p>
      </div>

      {/* Order Modal */}
      {orderProduct && (
        <div className="rt-modal-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
          <div className="rt-modal-box" style={{ background: '#1a1a1a', borderRadius: '16px', padding: '28px', width: '100%', maxWidth: '400px', border: '1px solid #222', textAlign: 'center' }}>
            {orderSuccess ? (
              <div>
                <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: green, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', fontSize: '28px', color: '#000', fontWeight: '800' }}>
                  ✓
                </div>
                <h3 style={{ color: '#fff', fontWeight: '800', fontSize: '18px', margin: '0 0 8px' }}>Order Sent!</h3>
                <p style={{ color: '#888', fontSize: '14px', margin: 0 }}>Opening WhatsApp...</p>
              </div>
            ) : (
              <>
                <h3 style={{ margin: '0 0 4px', fontSize: '18px', fontWeight: '800', color: '#fff', textAlign: 'left' }}>
                  Order {orderProduct.name}
                </h3>
                <p style={{ margin: '0 0 24px', color: green, fontSize: '14px', fontWeight: '700', textAlign: 'left' }}>
                  UGX {orderProduct.price} each
                </p>
                <input placeholder="Your name" value={buyerName} onChange={e => setBuyerName(e.target.value)}
                  style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #333', marginBottom: '12px', boxSizing: 'border-box', fontSize: '14px', background: '#111', color: '#fff' }} />
                <input placeholder="Quantity" value={quantity} onChange={e => setQuantity(e.target.value)} type="number" min="1"
                  style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #333', marginBottom: '24px', boxSizing: 'border-box', fontSize: '14px', background: '#111', color: '#fff' }} />
                <input placeholder="Delivery area e.g. Nakawa, Kampala" value={deliveryArea} onChange={e => setDeliveryArea(e.target.value)}
                  style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #333', marginBottom: '24px', boxSizing: 'border-box', fontSize: '14px', background: '#111', color: '#fff' }} />
                <textarea placeholder="Write a message to the seller (optional)" value={message} onChange={e => setMessage(e.target.value)}
                  style={{ width: '100%', minHeight: '100px', padding: '12px', borderRadius: '8px', border: '1px solid #333', marginBottom: '24px', boxSizing: 'border-box', fontSize: '14px', background: '#111', color: '#fff', resize: 'vertical' }} />
                <button onClick={handleOrder}
                  style={{ width: '100%', padding: '14px', background: green, color: '#000', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '15px', marginBottom: '12px' }}>
                  Send Order on WhatsApp
                </button>
                <a href={`tel:+${seller.whatsapp}`}
                  style={{ display: 'block', width: '100%', padding: '14px', background: 'transparent', color: '#fff', border: '1px solid #333', borderRadius: '8px', fontWeight: '600', cursor: 'pointer', fontSize: '15px', marginBottom: '12px', textAlign: 'center', textDecoration: 'none', boxSizing: 'border-box' }}>
                  📞 Call Seller
                </a>
                <button onClick={() => setOrderProduct(null)}
                  style={{ width: '100%', padding: '12px', background: 'transparent', color: '#555', border: '1px solid #222', borderRadius: '8px', cursor: 'pointer', fontSize: '14px' }}>
                  Cancel
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Message Composer Modal */}
      {messageProduct && (
        <div className="rt-modal-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
          <div className="rt-modal-box" style={{ background: '#1a1a1a', borderRadius: '16px', padding: '28px', width: '100%', maxWidth: '400px', border: '1px solid #222', textAlign: 'center' }}>
            <h3 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: '800', color: '#fff', textAlign: 'left' }}>
              Message about {messageProduct.name}
            </h3>

            {/* Product Preview */}
            <div style={{ marginBottom: '20px', padding: '12px', background: '#111', borderRadius: '8px', border: `1px solid #333` }}>
              <img src={messageProduct.imageUrl} alt={messageProduct.name}
                style={{ width: '100%', height: '120px', objectFit: 'cover', borderRadius: '6px', marginBottom: '8px' }} />
              <p style={{ margin: '0 0 4px', fontWeight: '700', fontSize: '13px', color: '#fff', textAlign: 'left' }}>{messageProduct.name}</p>
              <p style={{ margin: 0, color: green, fontSize: '13px', fontWeight: '700', textAlign: 'left' }}>UGX {messageProduct.price}</p>
            </div>

            {/* Message Input */}
            <textarea placeholder="Write your message..." value={messageText} onChange={e => setMessageText(e.target.value)}
              style={{ width: '100%', minHeight: '100px', padding: '12px', borderRadius: '8px', border: '1px solid #333', marginBottom: '20px', boxSizing: 'border-box', fontSize: '14px', background: '#111', color: '#fff', resize: 'vertical' }} />

            {/* Send Button */}
            <button onClick={handleSendMessage}
              style={{ width: '100%', padding: '14px', background: green, color: '#000', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '15px', marginBottom: '12px' }}>
              Send Message
            </button>

            {/* Cancel Button */}
            <button onClick={() => { setMessageProduct(null); setMessageText('') }}
              style={{ width: '100%', padding: '12px', background: 'transparent', color: '#555', border: '1px solid #222', borderRadius: '8px', cursor: 'pointer', fontSize: '14px' }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Signup Sheet Modal */}
      {showSignupSheet && (
        <div className="rt-modal-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1001, padding: '20px' }}>
          <div className="rt-modal-box" style={{ background: '#1a1a1a', borderRadius: '16px', padding: '28px', width: '100%', maxWidth: '380px', border: '1px solid #222', textAlign: 'center' }}>
            <h3 style={{ margin: '0 0 8px', fontSize: '18px', fontWeight: '800', color: '#fff' }}>Join Rachett</h3>
            <p style={{ margin: '0 0 24px', color: '#888', fontSize: '14px' }}>Sign up to send your message</p>

            {/* Google Sign In */}
            <button onClick={handleSignupAndSendMessage}
              style={{ width: '100%', padding: '14px', background: '#fff', color: '#000', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '14px', marginBottom: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
              <span style={{ fontSize: '16px' }}>🔵</span> Continue with Google
            </button>

            {/* Phone Auth Note */}
            <p style={{ margin: '12px 0', color: '#666', fontSize: '12px' }}>Phone sign-up coming soon</p>

            {/* Cancel */}
            <button onClick={() => setShowSignupSheet(false)}
              style={{ width: '100%', padding: '12px', background: 'transparent', color: '#555', border: '1px solid #222', borderRadius: '8px', cursor: 'pointer', fontSize: '14px' }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default StorePage