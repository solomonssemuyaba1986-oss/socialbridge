import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { collection, query, where, getDocs, addDoc } from 'firebase/firestore'
import { db, auth } from './firebase'
import { onAuthStateChanged } from 'firebase/auth'

interface Seller {
  businessName: string
  bio: string
  logoUrl: string
  slug: string
  whatsapp?: string
}

interface Product {
  id: string
  name: string
  price: string
  description: string
  imageUrl: string
}

const green = '#adff2f'
const CLOUD_NAME = 'dzudmmuxg'
const UPLOAD_PRESET = 'p2z65zrv'

function ProductCard({ p, isOwner, sellerId, onOrder, onRefresh }: any) {
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
                <button onClick={onOrder}
                  style={{ width: '100%', padding: '10px', background: green, color: '#000', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '13px' }}>
                  Order Now
                </button>
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
  const [seller, setSeller] = useState<Seller | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [isOwner, setIsOwner] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(true)
  const [sellerId, setSellerId] = useState<string>('')
  const [orderSuccess, setOrderSuccess] = useState(false)
  const [uploading, setUploading] = useState(false)

  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [description, setDescription] = useState('')
  const [imageUrl, setImageUrl] = useState('')

  const [orderProduct, setOrderProduct] = useState<Product | null>(null)
  const [buyerName, setBuyerName] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [deliveryArea, setDeliveryArea] = useState('')

  useEffect(() => {
    const fetchSeller = async () => {
      const q = query(collection(db, 'sellers'), where('slug', '==', slug))
      const snapshot = await getDocs(q)
      if (!snapshot.empty) {
        const docData = snapshot.docs[0]
        setSeller(docData.data() as Seller)
        setSellerId(docData.id)
        fetchProducts(docData.id)
        onAuthStateChanged(auth, (user) => {
          if (user && user.uid === docData.id) setIsOwner(true)
        })
      }
      setLoading(false)
    }
    fetchSeller()
  }, [slug])

  const fetchProducts = async (sid: string) => {
    const q = query(collection(db, 'sellers', sid, 'products'))
    const snapshot = await getDocs(q)
    const list = snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as Product[]
    setProducts(list)
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
    await addDoc(collection(db, 'sellers', sellerId, 'products'), {
      name, price, description, imageUrl
    })
    setName(''); setPrice(''); setDescription(''); setImageUrl('')
    setShowForm(false)
    fetchProducts(sellerId)
  }

const handleOrder = async () => {
  if (!buyerName) return alert('Please enter your name')
  if (!deliveryArea) return alert('Please enter your delivery area')
  if (!orderProduct || !seller) return

  const orderRef = await addDoc(collection(db, 'sellers', sellerId, 'orders'), {
    buyerName,
    productName: orderProduct.name,
    productPrice: orderProduct.price,
    quantity,
    deliveryArea,
    status: 'pending',
    read: false,
    createdAt: new Date()
  })

  const orderId = `SB-${orderRef.id.slice(0, 6).toUpperCase()}`

  await import('firebase/firestore').then(({ updateDoc, doc }) =>
    updateDoc(doc(db, 'sellers', sellerId, 'orders', orderRef.id), { orderId })
  )

  const message =
`🟢 NEW ORDER — SocialBridge

Customer: ${buyerName}
Product: ${orderProduct.name}
Price: UGX ${orderProduct.price}
Quantity: ${quantity}
Total: UGX ${Number(orderProduct.price.replace(/,/g, '')) * Number(quantity)}
Delivery Area: ${deliveryArea}

Order ID: #${orderId}

Reply with:
1️⃣ Confirm Order
2️⃣ Out of Stock
3️⃣ Need More Details`

  const whatsappNumber = seller.whatsapp || ''
  setOrderSuccess(true)
  setTimeout(() => {
    window.open(`https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}`, '_blank')
    setBuyerName(''); setQuantity('1'); setDeliveryArea('')
    setOrderProduct(null)
    setOrderSuccess(false)
  }, 1500)
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
        {isOwner && (
          <button onClick={() => { auth.signOut(); window.location.href = '/' }}
            style={{ background: 'transparent', border: '1px solid #333', borderRadius: '8px', padding: '8px 16px', fontSize: '13px', color: '#555', cursor: 'pointer' }}>
            Log out
          </button>
        )}
      </div>

      {/* Products */}
      <div style={{ maxWidth: '640px', margin: '0 auto', padding: '32px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2 style={{ fontSize: '16px', fontWeight: '700', margin: 0, color: '#aaa', textTransform: 'uppercase', letterSpacing: '1px' }}>Products</h2>
          {isOwner && (
            <button onClick={() => setShowForm(!showForm)}
              style={{ background: green, color: '#000', border: 'none', borderRadius: '8px', padding: '10px 18px', cursor: 'pointer', fontWeight: '700', fontSize: '13px' }}>
              + Add Product
            </button>
          )}
        </div>

        {/* Add Product Form */}
        {showForm && (
          <div style={{ background: '#1a1a1a', borderRadius: '12px', padding: '24px', marginBottom: '24px', border: '1px solid #222' }}>
            <input placeholder="Product name" value={name} onChange={e => setName(e.target.value)}
              style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #333', marginBottom: '12px', boxSizing: 'border-box', fontSize: '14px', background: '#111', color: '#fff' }} />
            <input placeholder="Price e.g. 200000" value={price} onChange={e => setPrice(e.target.value)}
              style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #333', marginBottom: '12px', boxSizing: 'border-box', fontSize: '14px', background: '#111', color: '#fff' }} />
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
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            {products.map(p => (
              <ProductCard
                key={p.id}
                p={{ ...p, sellerWhatsapp: seller.whatsapp }}
                isOwner={isOwner}
                sellerId={sellerId}
                onOrder={() => setOrderProduct(p)}
                onRefresh={() => fetchProducts(sellerId)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{ textAlign: 'center', padding: '24px', borderTop: '1px solid #1a1a1a' }}>
        <p style={{ color: '#333', fontSize: '12px', margin: 0 }}>
          Powered by <span style={{ color: green, fontWeight: '700' }}>SocialBridge</span>
        </p>
      </div>

      {/* Order Modal */}
      {orderProduct && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
          <div style={{ background: '#1a1a1a', borderRadius: '16px', padding: '28px', width: '100%', maxWidth: '400px', border: '1px solid #222', textAlign: 'center' }}>
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
    </div>
  )
}

export default StorePage