import { signInWithPopup } from 'firebase/auth'
import { auth, googleProvider } from './firebase'
import { useNavigate } from 'react-router-dom'

function SignIn() {
  const navigate = useNavigate()

  const handleGoogleSignIn = async () => {
    try {
      await signInWithPopup(auth, googleProvider)
      navigate('/setup')
    } catch (error) {
      console.error(error)
      alert('Sign in failed. Try again.')
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', background: '#f9f9f9', fontFamily: 'sans-serif' }}>
      <h1 style={{ fontSize: '28px', fontWeight: '700', marginBottom: '8px', color: '#1a1a1a' }}>SocialBridge</h1>
      <p style={{ color: '#666', marginBottom: '40px', fontSize: '15px' }}>Turn your social media into a real store</p>
      <button
        onClick={handleGoogleSignIn}
        style={{ background: '#fff', border: '1px solid #ddd', borderRadius: '8px', padding: '14px 28px', fontSize: '15px', fontWeight: '600', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}
      >
        <img src="https://www.google.com/favicon.ico" width="18" />
        Continue with Google
      </button>
    </div>
  )
}

export default SignIn