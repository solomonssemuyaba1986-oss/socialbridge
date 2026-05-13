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

  const green = '#adff2f'
  const CLOUD_NAME = 'dzudmmuxg'
  const UPLOAD_PRESET = 'p2z65zrv'

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

  const handleImageUpload = async (file: File) => {
    setUploading(true)
    const formData = new FormData()
    formData.append('file', file)
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
    if (!orderProduct || !seller) return
    await addDoc(collection(db, 'sellers', sellerId, 'orders'), {
      buyerName,
      productName: orderProduct.name,
      productPrice: orderProduct.price,
      quantity,
      createdAt: new Date()
    })
    const message = `Hi! I'm *${buyerName}* and I want to order *${orderProduct.name}* x${quantity} at UGX ${orderProduct.price} each.`
    const whatsappNumber = seller.whatsapp || ''
    setOrderSuccess(true)
    setTimeout(() => {
      window.open(`https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}`, '_blank')
      setBuyerName(''); setQuantity('1')
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
              <input
                type="file"
                accept="image/*"
                onChange={e => {
                  const file = e.target.files?.[0]
                  if (file) handleImageUpload(file)
                }}
                style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #333', boxSizing: 'border-box', fontSize: '14px', background: '#111', color: '#fff' }}
              />
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
              <div key={p.id} style={{ background: '#1a1a1a', borderRadius: '12px', overflow: 'hidden', border: '1px solid #222' }}>
                <img src={p.imageUrl || 'https://placehold.co/300x200/1a1a1a/333333'} alt={p.name}
                  style={{ width: '100%', height: '160px', objectFit: 'cover' }} />
                <div style={{ padding: '12px' }}>
                  <p style={{ margin: '0 0 4px', fontWeight: '700', fontSize: '14px', color: '#fff' }}>{p.name}</p>
                  <p style={{ margin: '0 0 8px', color: '#666', fontSize: '12px' }}>{p.description}</p>
                  <p style={{ margin: '0 0 12px', fontWeight: '800', color: green, fontSize: '15px' }}>UGX {p.price}</p>
                  {!isOwner && (
                    <button onClick={() => setOrderProduct(p)}
                      style={{ width: '100%', padding: '10px', background: green, color: '#000', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '13px' }}>
                      Order Now
                    </button>
                  )}
                </div>
              </div>
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