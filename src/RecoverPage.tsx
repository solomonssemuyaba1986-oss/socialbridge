import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import RecoveryModal from './RecoveryModal'

function RecoverPage() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(true)

  const handleClose = () => {
    setOpen(false)
    // Cancel should take you back where you came from — never leave a blank page.
    if (window.history.length > 1) navigate(-1)
    else navigate('/help')
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f0f', fontFamily: 'sans-serif', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <RecoveryModal open={open} onClose={handleClose} />
    </div>
  )
}

export default RecoverPage
