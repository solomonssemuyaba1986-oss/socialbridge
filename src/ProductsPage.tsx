import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { addDoc, collection, deleteDoc, doc, getDocs, updateDoc } from 'firebase/firestore'
import { auth, db } from './firebase'

interface Product {
  id: string
  name: string
  price: string
  description: string
  imageUrl: string
  colors: string[]
  sizes: string[]
}

interface ProductFormState {
  name: string
  price: string
  description: string
  colors: string
  sizes: string
  imageUrl: string
}

const green = '#adff2f'
const CLOUD_NAME = 'dzudmmuxg'
const UPLOAD_PRESET = 'p2z65zrv'

const emptyForm = (): ProductFormState => ({
  name: '',
  price: '',
  description: '',
  colors: '',
  sizes: '',
  imageUrl: '',
})

function ProductsPage() {
  const navigate = useNavigate()
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<ProductFormState>(emptyForm())
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [sellerId, setSellerId] = useState<string | null>(null)

  useEffect(() => {
    const user = auth.currentUser
    if (!user) {
      navigate('/')
      return
    }

    setSellerId(user.uid)
    loadProducts(user.uid)
  }, [navigate])

  const loadProducts = async (uid: string) => {
    setLoading(true)
    try {
      const snap = await getDocs(collection(db, 'sellers', uid, 'products'))
      const items = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<Product, 'id'>),
      }))
      setProducts(items)
    } catch (err) {
      console.error('Load products failed', err)
    } finally {
      setLoading(false)
    }
  }

  const uploadImage = async (file: File): Promise<string> => {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('upload_preset', UPLOAD_PRESET)
    const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, {
      method: 'POST',
      body: formData,
    })
    const data = await res.json()
    return data.secure_url
  }

  const resetForm = () => {
    setEditingId(null)
    setForm(emptyForm())
    setSelectedFile(null)
    setPreviewUrl('')
  }

  const startEdit = (product: Product) => {
    setEditingId(product.id)
    setForm({
      name: product.name,
      price: product.price,
      description: product.description || '',
      colors: (product.colors || []).join(', '),
      sizes: (product.sizes || []).join(', '),
      imageUrl: product.imageUrl || '',
    })
    setPreviewUrl(product.imageUrl || '')
    setSelectedFile(null)
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setSelectedFile(file)
    setPreviewUrl(URL.createObjectURL(file))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!sellerId) return

    if (!form.name.trim() || !form.price.trim()) {
      alert('Please add a product name and price')
      return
    }

    setSaving(true)
    try {
      let imageUrl = form.imageUrl
      if (selectedFile) {
        imageUrl = await uploadImage(selectedFile)
      }

      const payload = {
        name: form.name.trim(),
        price: form.price.trim(),
        description: form.description.trim(),
        imageUrl,
        colors: form.colors.split(',').map((c) => c.trim()).filter(Boolean),
        sizes: form.sizes.split(',').map((s) => s.trim()).filter(Boolean),
      }

      if (editingId) {
        await updateDoc(doc(db, 'sellers', sellerId, 'products', editingId), payload)
      } else {
        await addDoc(collection(db, 'sellers', sellerId, 'products'), payload)
      }

      await loadProducts(sellerId)
      resetForm()
    } catch (err) {
      console.error('Save product failed', err)
      alert('Could not save the product. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (productId: string) => {
    if (!sellerId) return
    const ok = window.confirm('Delete this product from your store?')
    if (!ok) return

    try {
      await deleteDoc(doc(db, 'sellers', sellerId, 'products', productId))
      setProducts(prev => prev.filter((p) => p.id !== productId))
    } catch (err) {
      console.error('Delete product failed', err)
      alert('Could not delete the product.')
    }
  }

  const productCount = useMemo(() => products.length, [products.length])

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f0f', color: '#fff', fontFamily: 'sans-serif', padding: '24px 16px 48px' }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', gap: '12px', flexWrap: 'wrap' }}>
          <div>
            <p style={{ margin: 0, color: green, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', fontSize: '12px' }}>Products</p>
            <h1 style={{ margin: '6px 0 4px', fontSize: '28px', fontWeight: 800 }}>Your product catalog</h1>
            <p style={{ margin: 0, color: '#888', fontSize: '14px' }}>Manage every listing from one place — add new products, edit details, set colors and sizes, and remove anything you no longer sell.</p>
          </div>
          <button onClick={() => resetForm()} style={{ background: green, color: '#000', border: 'none', borderRadius: '10px', padding: '12px 16px', fontWeight: 800, cursor: 'pointer' }}>
            + Add Product
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.15fr 0.85fr', gap: '20px', alignItems: 'start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ background: '#121212', border: '1px solid #1f1f1f', borderRadius: '16px', padding: '16px 18px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <h2 style={{ margin: 0, fontSize: '18px' }}>Products you own</h2>
                <span style={{ color: '#888', fontSize: '13px' }}>{productCount} total</span>
              </div>
              {loading ? (
                <p style={{ color: '#666', margin: 0 }}>Loading your products...</p>
              ) : products.length === 0 ? (
                <div style={{ border: '1px dashed #333', borderRadius: '12px', padding: '24px', textAlign: 'center', color: '#666' }}>
                  No products yet. Create your first listing with pictures, pricing, colors and sizes.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {products.map((product) => (
                    <div key={product.id} style={{ background: '#1a1a1a', border: '1px solid #222', borderRadius: '14px', padding: '12px', display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                      <img src={product.imageUrl || 'https://placehold.co/220x220/111111/333333'} alt={product.name} style={{ width: '86px', height: '86px', objectFit: 'cover', borderRadius: '10px', flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                          <div>
                            <p style={{ margin: '0 0 4px', fontWeight: 700, fontSize: '15px' }}>{product.name}</p>
                            <p style={{ margin: 0, color: green, fontWeight: 800, fontSize: '14px' }}>UGX {product.price}</p>
                          </div>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button onClick={() => startEdit(product)} style={{ background: '#222', color: '#fff', border: 'none', borderRadius: '8px', padding: '7px 10px', cursor: 'pointer' }}>Edit</button>
                            <button onClick={() => handleDelete(product.id)} style={{ background: 'transparent', color: '#ff6b6b', border: '1px solid #ff6b6b', borderRadius: '8px', padding: '7px 10px', cursor: 'pointer' }}>Delete</button>
                          </div>
                        </div>
                        {product.description ? <p style={{ margin: '8px 0 6px', color: '#888', fontSize: '13px' }}>{product.description}</p> : null}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '6px' }}>
                          {product.colors?.length ? product.colors.map((color) => <span key={color} style={{ padding: '4px 8px', borderRadius: '999px', background: '#222', color: '#ddd', fontSize: '12px' }}>{color}</span>) : null}
                          {product.sizes?.length ? product.sizes.map((size) => <span key={size} style={{ padding: '4px 8px', borderRadius: '999px', border: '1px solid #333', color: '#aaa', fontSize: '12px' }}>{size}</span>) : null}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div style={{ background: '#121212', border: '1px solid #1f1f1f', borderRadius: '16px', padding: '18px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <h2 style={{ margin: 0, fontSize: '18px' }}>{editingId ? 'Edit product' : 'Add a product'}</h2>
              {editingId ? <button onClick={resetForm} style={{ background: 'transparent', color: '#888', border: 'none', cursor: 'pointer' }}>Cancel</button> : null}
            </div>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px', color: '#bbb' }}>
                Product name
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={inputStyle} placeholder="e.g. Handmade bag" />
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px', color: '#bbb' }}>
                Price 
                <input value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} style={inputStyle} placeholder="50000" />
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px', color: '#bbb' }}>
                Description
                <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} style={{ ...inputStyle, minHeight: '90px', resize: 'vertical' }} placeholder="Tell buyers what makes this item special" />
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px', color: '#bbb' }}>
                Colors (comma separated)
                <input value={form.colors} onChange={(e) => setForm({ ...form, colors: e.target.value })} style={inputStyle} placeholder="Black, White, Beige" />
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px', color: '#bbb' }}>
                Sizes (comma separated)
                <input value={form.sizes} onChange={(e) => setForm({ ...form, sizes: e.target.value })} style={inputStyle} placeholder="S, M, L, XL" />
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px', color: '#bbb' }}>
                Product image
                <input type="file" accept="image/*" onChange={handleFileChange} style={{ color: '#fff' }} />
              </label>

              {(previewUrl || form.imageUrl) && (
                <img src={previewUrl || form.imageUrl} alt="Preview" style={{ width: '100%', height: '180px', objectFit: 'cover', borderRadius: '12px', border: '1px solid #2a2a2a' }} />
              )}

              <button type="submit" disabled={saving} style={{ padding: '12px 14px', borderRadius: '10px', border: 'none', background: saving ? '#333' : green, color: '#000', fontWeight: 800, cursor: saving ? 'not-allowed' : 'pointer', marginTop: '4px' }}>
                {saving ? 'Saving...' : editingId ? 'Save changes' : 'Add product'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  background: '#111',
  border: '1px solid #2d2d2d',
  color: '#fff',
  padding: '10px 12px',
  borderRadius: '10px',
  fontSize: '14px',
  boxSizing: 'border-box',
}

export default ProductsPage
