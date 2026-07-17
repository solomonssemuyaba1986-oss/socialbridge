import { useNavigate } from 'react-router-dom'
import { auth } from './firebase'
import { signOut } from 'firebase/auth'

function TopNav() {
  const navigate = useNavigate()
  const user = auth.currentUser
  const green = '#adff2f'

  return (
    <nav style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 20px', borderBottom: '1px solid #111', background: '#0f0f0f' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <div style={{ background: green, width: 28, height: 28, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 12, color: '#000' }}>R</div>
        <span style={{ fontWeight: 800, fontSize: 16, color: '#fff' }}>Rachett</span>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        {!user && (
          <>
            <button onClick={() => navigate('/')} style={{ background: 'transparent', color: '#fff', border: '1px solid #333', padding: '8px 12px', borderRadius: 8, cursor: 'pointer' }}>Log in</button>
            <button onClick={() => navigate('/setup')} style={{ background: green, color: '#000', border: 'none', padding: '8px 12px', borderRadius: 8, cursor: 'pointer', fontWeight: 700 }}>Sign up</button>
          </>
        )}

        {user && (
          <>
            <button onClick={() => navigate('/my-chats')} style={{ background: 'transparent', color: '#fff', border: '1px solid #333', padding: '8px 12px', borderRadius: 8, cursor: 'pointer' }}>💬 Chats</button>
            <button onClick={() => navigate('/dashboard')} style={{ background: 'transparent', color: '#fff', border: '1px solid #333', padding: '8px 12px', borderRadius: 8, cursor: 'pointer' }}>Manage Store</button>
            <button onClick={async () => { await signOut(auth); navigate('/') }} style={{ background: '#444', color: '#fff', border: 'none', padding: '8px 12px', borderRadius: 8, cursor: 'pointer' }}>Sign out</button>
          </>
        )}
      </div>
    </nav>
  )
}

export default TopNav
