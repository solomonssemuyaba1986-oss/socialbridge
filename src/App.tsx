import { Routes, Route, Navigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db } from './firebase'
import StorePage from './StorePage.tsx'
import SignIn from './SignIn.tsx'
import SetupStore from './SetupStore.tsx'
import Onboarding from './Onboarding.tsx'
import Dashboard from './Dashboard.tsx'

function App() {
  const [loading, setLoading] = useState(true)
  const [slug, setSlug] = useState<string | null>(null)
  const [signedIn, setSignedIn] = useState(false)

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
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
      setLoading(false)
    })
    return () => unsubscribe()
  }, [])

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
      <p>Loading...</p>
    </div>
  )

  return (
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
    </Routes>
  )
}

export default App