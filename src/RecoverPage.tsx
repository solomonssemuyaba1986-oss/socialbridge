import { useState } from 'react'
import RecoveryModal from './RecoveryModal'

function RecoverPage() {
  const [open, setOpen] = useState(true)

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f0f', fontFamily: 'sans-serif', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <RecoveryModal open={open} onClose={() => setOpen(false)} />
    </div>
  )
}

export default RecoverPage
