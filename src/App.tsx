import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { onAuthStateChanged, getRedirectResult } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db } from './firebase'
import { rememberUser } from './userMemory'
import StorePage from './StorePage.tsx'
import SignIn from './SignIn.tsx'
import SetupStore from './SetupStore.tsx'
import Onboarding from './Onboarding.tsx'
import Dashboard from './Dashboard.tsx'
import BrowsePage from './BrowsePage.tsx'
import BagPage from './BagPage.tsx'
import BulkUpload from './BulkUpload.tsx'
import Inbox from './Inbox.tsx'
import OrderHistory from './OrderHistory.tsx'
import EditStore from './EditStore.tsx'
import ProductsPage from './ProductsPage.tsx'
import AnalyticsPage from './AnalyticsPage.tsx'
import FeedbackPage from './FeedbackPage.tsx'
import TopNav from './TopNav.tsx'
import Splash from './Splash.tsx'
import LoadingScreen from './LoadingScreen.tsx'
import RecoverPage from './RecoverPage.tsx'
import HelpPage from './HelpPage.tsx'
import TermsPage from './TermsPage.tsx'
import NearbyPage from './NearbyPage.tsx'
import BuyerHome from './BuyerHome.tsx'
import NotFound from './NotFound.tsx'
import { getRole } from './role.ts'
import { SellerLiveProvider } from './sellerLive.tsx'
import NetworkGuard from './NetworkGuard.tsx'

function BulkUploadWrapper() {
  const navigate = useNavigate()
  const user = auth.currentUser
  if (!user) return <Navigate to="/" />
  return <BulkUpload sellerId={user.uid} onDone={() => navigate('/dashboard')} />
}

function App() {
  const location = useLocation()
  const [loading, setLoading] = useState(true)
  const [slug, setSlug] = useState<string | null>(null)
  const [signedIn, setSignedIn] = useState(false)
  /** Anonymous buyers are real accounts to Firestore, but not sellers — keep them out of store areas. */
  const [isGuest, setIsGuest] = useState(false)
  const [showSplash, setShowSplash] = useState(true)

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
          const guest = !!user.isAnonymous
          setSignedIn(true)
          setIsGuest(guest)
          if (!guest) rememberUser(user) // keep "Continue as" fresh for the next visit
          const docRef = doc(db, 'sellers', user.uid)
          const docSnap = await getDoc(docRef)
          if (docSnap.exists()) {
            setSlug(docSnap.data().slug)
          }
        } else {
          setSignedIn(false)
          setIsGuest(false)
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

  if (showSplash) {
    return <Splash onDone={() => setShowSplash(false)} />
  }

  if (loading) return (
    <LoadingScreen message="Getting everything ready for you..." />
  )

  /** Guests (anonymous) can shop and chat, but store areas still need a real account. */
  const sellerOnly = signedIn && !isGuest

  return (
    <SellerLiveProvider>
      <NetworkGuard />
      {location.pathname !== '/terms' && <TopNav variant={location.pathname === '/bag' ? 'bag' : 'default'} />}
      <Routes>
      {/* Market-first: everyone without a shop lands on the buyer home — logged-out
          visitors included. Sign-in is asked for only when they buy or message. */}
      <Route path="/" element={
        slug ? <Navigate to="/dashboard" /> :
        getRole() === 'seller' ? <Navigate to="/onboarding" /> :
        <Navigate to="/home" />
      } />
      {/* The buyer's home — mirror of the seller's Dashboard. Open to guests too. */}
      <Route path="/home" element={<BuyerHome />} />
      <Route path="/onboarding" element={<Onboarding />} />
      {/* Sign-in has its own route now that "/" is the market. */}
      <Route path="/signin" element={<SignIn />} />
      <Route path="/setup" element={<SetupStore />} />
      <Route path="/store/:slug" element={<StorePage />} />
      <Route path="/dashboard" element={sellerOnly ? <Dashboard /> : <Navigate to="/" />} />
      <Route path="/browse" element={<BrowsePage />} />
      <Route path="/nearby" element={<NearbyPage />} />
      <Route path="/bag" element={<BagPage />} />
      <Route path="/bulk-upload" element={sellerOnly ? <BulkUploadWrapper /> : <Navigate to="/" />} />
      <Route path="/products" element={sellerOnly ? <ProductsPage /> : <Navigate to="/" />} />
      <Route path="/inbox" element={signedIn ? <Inbox /> : <Navigate to="/" />} />
      <Route path="/my-chats" element={<Navigate to="/inbox" />} />
      <Route path="/orders" element={sellerOnly ? <OrderHistory /> : <Navigate to="/" />} />
      <Route path="/analytics" element={sellerOnly ? <AnalyticsPage /> : <Navigate to="/" />} />
      <Route path="/edit-store" element={sellerOnly ? <EditStore /> : <Navigate to="/" />} />
      <Route path="/feedback" element={<FeedbackPage />} />
      <Route path="/recover" element={<RecoverPage />} />
      <Route path="/help" element={<HelpPage />} />
      <Route path="/terms" element={<TermsPage />} />
      {/* Any unmatched URL — previously rendered nothing but the top nav. */}
      <Route path="*" element={<NotFound />} />
      </Routes>
    </SellerLiveProvider>
  )
}

export default App