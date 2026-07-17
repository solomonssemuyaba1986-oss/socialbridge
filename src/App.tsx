import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { onAuthStateChanged, getRedirectResult } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db } from './firebase'
import StorePage from './StorePage.tsx'
import SignIn from './SignIn.tsx'
import SetupStore from './SetupStore.tsx'
import Onboarding from './Onboarding.tsx'
import Dashboard from './Dashboard.tsx'
import BrowsePage from './BrowsePage.tsx'
import BulkUpload from './BulkUpload.tsx'
import Inbox from './Inbox.tsx'
import MyChats from './MyChats.tsx'
import OrderHistory from './OrderHistory.tsx'
import EditStore from './EditStore.tsx'
import ProductsPage from './ProductsPage.tsx'
import TopNav from './TopNav.tsx'

function BulkUploadWrapper() {
  const navigate = useNavigate()
  const user = auth.currentUser
  if (!user) return <Navigate to="/" />
  return <BulkUpload sellerId={user.uid} onDone={() => navigate('/dashboard')} />
}

function App() {
  const [loading, setLoading] = useState(true)
  const [slug, setSlug] = useState<string | null>(null)
  const [signedIn, setSignedIn] = useState(false)

  useEffect(() => {
    // If the user was redirected after sign-in (mobile redirect fallback), finalize the redirect login.
    (async () => {
      try {
        await getRedirectResult(auth)
      } catch (err) {
        console.warn('Redirect result error:', err)
      }
    })()

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      try {
        if (user) {
          setSignedIn(true)
          const docRef = doc(db, 'sellers', user.uid)
          const docSnap = await getDoc(docRef)
          if (docSnap.exists()) {
            setSlug(docSnap.data().slug)
          }
        } else {
          setSignedIn(false)
          setSlug(null)
        }
      } catch (err) {
        console.error('Auth state error:', err)
      } finally {
        setLoading(false)
      }
    })
    return () => unsubscribe()
  }, [])

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
      <p>Loading...</p>
    </div>
  )

  return (
    <>
      <TopNav />
      <Routes>
      <Route path="/" element={
        !signedIn ? <SignIn /> :
        slug ? <Navigate to="/dashboard" /> :
        <Navigate to="/onboarding" />
      } />
      <Route path="/onboarding" element={signedIn ? <Onboarding /> : <Navigate to="/" />} />
      <Route path="/setup" element={signedIn ? <SetupStore /> : <Navigate to="/" />} />
      <Route path="/store/:slug" element={<StorePage />} />
      <Route path="/dashboard" element={signedIn ? <Dashboard /> : <Navigate to="/" />} />
      <Route path="/browse" element={<BrowsePage />} />
      <Route path="/bulk-upload" element={signedIn ? <BulkUploadWrapper /> : <Navigate to="/" />} />
      <Route path="/products" element={signedIn ? <ProductsPage /> : <Navigate to="/" />} />
      <Route path="/inbox" element={signedIn ? <Inbox /> : <Navigate to="/" />} />
      <Route path="/my-chats" element={signedIn ? <MyChats /> : <Navigate to="/" />} />
      <Route path="/orders" element={signedIn ? <OrderHistory /> : <Navigate to="/" />} />
      <Route path="/edit-store" element={signedIn ? <EditStore /> : <Navigate to="/" />} />
      </Routes>
    </>
  )
}

export default App