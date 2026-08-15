const green = '#adff2f'

type Props = {
  open: boolean
  title: string
  message: string
  confirmLabel: string
  cancelLabel: string
  onConfirm: () => void
  onClose: () => void
}

function ConfirmDialog({ open, title, message, confirmLabel, cancelLabel, onConfirm, onClose }: Props) {
  if (!open) return null

  return (
    <div onClick={onClose}
      style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: '#1a1a1a', borderRadius: 16, padding: '28px 24px', maxWidth: 380, width: '100%', textAlign: 'center', border: '1px solid #222' }}>
        <div style={{ width: 52, height: 52, borderRadius: '50%', background: '#2a1a1a', border: '1px solid #ff4444', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', fontSize: 24 }}>
          ⚠️
        </div>
        <h3 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 800 }}>{title}</h3>
        <p style={{ margin: '0 0 20px', color: '#888', fontSize: 14, lineHeight: 1.6 }}>{message}</p>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} autoFocus
            style={{ flex: 1, padding: '12px', background: green, color: '#000', border: 'none', borderRadius: 10, fontWeight: 800, cursor: 'pointer', fontSize: 14 }}>
            {cancelLabel}
          </button>
          <button onClick={onConfirm}
            style={{ flex: 1, padding: '12px', background: 'transparent', color: '#ff4444', border: '1px solid #ff4444', borderRadius: 10, fontWeight: 700, cursor: 'pointer', fontSize: 14 }}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

export default ConfirmDialog
