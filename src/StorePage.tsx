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

  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [description, setDescription] = useState('')
  const [imageUrl, setImageUrl] = useState('')

  const [orderProduct, setOrderProduct] = useState<Product | null>(null)
  const [buyerName, setBuyerName] = useState('')
  const [quantity, setQuantity] = useState('1')

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

  const handleAddProduct = async () => {
    if (!name || !price) return alert('Name and price are required')
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
    window.open(`https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}`, '_blank')

    setBuyerName(''); setQuantity('1')
    setOrderProduct(null)
  }

  if (loading) return <p style={{ textAlign: 'center', marginTop: '40px' }}>Loading...</p>
  if (!seller) return <p style={{ textAlign: 'center', marginTop: '40px' }}>Store not found.</p>

  return (
    <div style={{ minHeight: '100vh', background: '#f9f9f9', fontFamily: 'sans-serif' }}>

      {/* Header */}
      <div style={{ background: '#fff', padding: '40px 20px', textAlign: 'center', borderBottom: '1px solid #eee' }}>
        <img src={seller.logoUrl || 'https://placehold.co/100'} alt="logo"
          style={{ width: '90px', height: '90px', borderRadius: '50%', objectFit: 'cover', marginBottom: '16px' }} />
        <h1 style={{ margin: '0 0 8px', fontSize: '24px', fontWeight: '700', color: '#1a1a1a' }}>{seller.businessName}</h1>
        <p style={{ margin: 0, color: '#666', fontSize: '15px' }}>{seller.bio}</p>
        {isOwner && (
          <button onClick={() => { auth.signOut(); window.location.href = '/' }}
            style={{ marginTop: '12px', background: 'transparent', border: '1px solid #ddd', borderRadius: '8px', padding: '8px 16px', fontSize: '13px', color: '#888', cursor: 'pointer' }}>
            Log out
          </button>
        )}
      </div>

      {/* Products */}
      <div style={{ maxWidth: '600px', margin: '0 auto', padding: '30px 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ fontSize: '18px', fontWeight: '600', margin: 0 }}>Products</h2>
          {isOwner && (
            <button onClick={() => setShowForm(!showForm)}
              style={{ background: '#1a1a1a', color: '#fff', border: 'none', borderRadius: '8px', padding: '10px 18px', cursor: 'pointer', fontWeight: '600' }}>
              + Add Product
            </button>
          )}
        </div>

        {showForm && (
          <div style={{ background: '#fff', borderRadius: '12px', padding: '24px', marginBottom: '24px', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
            <input placeholder="Product name" value={name} onChange={e => setName(e.target.value)}
              style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #ddd', marginBottom: '12px', boxSizing: 'border-box', fontSize: '14px' }} />
            <input placeholder="Price (UGX)" value={price} onChange={e => setPrice(e.target.value)}
              style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #ddd', marginBottom: '12px', boxSizing: 'border-box', fontSize: '14px' }} />
            <input placeholder="Image URL" value={imageUrl} onChange={e => setImageUrl(e.target.value)}
              style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #ddd', marginBottom: '12px', boxSizing: 'border-box', fontSize: '14px' }} />
            <textarea placeholder="Description" value={description} onChange={e => setDescription(e.target.value)}
              style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #ddd', marginBottom: '16px', boxSizing: 'border-box', fontSize: '14px', resize: 'none' }} rows={3} />
            <button onClick={handleAddProduct}
              style={{ width: '100%', padding: '12px', background: '#1a1a1a', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: '600', cursor: 'pointer', fontSize: '15px' }}>
              Save Product
            </button>
          </div>
        )}

        {products.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', background: '#fff', borderRadius: '12px', border: '1px dashed #ddd' }}>
            <p style={{ color: '#aaa' }}>{isOwner ? 'Add your first product above' : 'No products yet'}</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            {products.map(p => (
              <div key={p.id} style={{ background: '#fff', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
                <img src={p.imageUrl || 'https://placehold.co/300x200'} alt={p.name}
                  style={{ width: '100%', height: '160px', objectFit: 'cover' }} />
                <div style={{ padding: '12px' }}>
                  <p style={{ margin: '0 0 4px', fontWeight: '600', fontSize: '14px' }}>{p.name}</p>
                  <p style={{ margin: '0 0 4px', color: '#666', fontSize: '13px' }}>{p.description}</p>
                  <p style={{ margin: '0 0 10px', fontWeight: '700', color: '#1a1a1a', fontSize: '15px' }}>UGX {p.price}</p>
                  {!isOwner && (
                    <button onClick={() => setOrderProduct(p)}
                      style={{ width: '100%', padding: '10px', background: '#25D366', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: '600', cursor: 'pointer', fontSize: '13px' }}>
                      Order Now
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Order Form Modal */}
      {orderProduct && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
          <div style={{ background: '#fff', borderRadius: '16px', padding: '24px', width: '100%', maxWidth: '400px' }}>
            <h3 style={{ margin: '0 0 4px', fontSize: '18px', fontWeight: '700' }}>Order {orderProduct.name}</h3>
            <p style={{ margin: '0 0 20px', color: '#666', fontSize: '14px' }}>UGX {orderProduct.price} each</p>

            <input placeholder="Your name" value={buyerName} onChange={e => setBuyerName(e.target.value)}
              style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #ddd', marginBottom: '12px', boxSizing: 'border-box', fontSize: '14px' }} />
            <input placeholder="Quantity" value={quantity} onChange={e => setQuantity(e.target.value)} type="number" min="1"
              style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #ddd', marginBottom: '20px', boxSizing: 'border-box', fontSize: '14px' }} />

            <button onClick={handleOrder}
              style={{ width: '100%', padding: '14px', background: '#25D366', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '15px', marginBottom: '12px' }}>
              Order on WhatsApp
            </button>
            <button onClick={() => setOrderProduct(null)}
              style={{ width: '100%', padding: '12px', background: 'transparent', color: '#888', border: '1px solid #ddd', borderRadius: '8px', cursor: 'pointer', fontSize: '14px' }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default StorePage