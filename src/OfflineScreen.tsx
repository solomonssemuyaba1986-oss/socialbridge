const green = '#adff2f'

type Props = {
  onRetry: () => void
}

function OfflineScreen({ onRetry }: Props) {
  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 5000,
      background: '#0f0f0f', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', padding: '24px',
      fontFamily: 'sans-serif', color: '#fff', textAlign: 'center',
    }}>
      <div style={{ fontSize: 56, marginBottom: 16 }}>📡</div>
      <h1 style={{ margin: '0 0 8px', fontSize: 24, fontWeight: 800 }}>You're offline</h1>
      <p style={{ margin: '0 0 28px', color: '#888', fontSize: 14, maxWidth: 320 }}>
        rachett needs an internet connection to keep working.
      </p>

      <div style={{ textAlign: 'left', width: '100%', maxWidth: 320, display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 28 }}>
        {[
          ['📶', 'Check Wi-Fi or mobile data is on'],
          ['✈️', 'Turn off Airplane mode'],
          ['🔌', 'Restart your router or modem'],
          ['💳', 'Check your data balance'],
        ].map(([icon, text]) => (
          <div key={text} style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#1a1a1a', border: '1px solid #222', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#ccc' }}>
            <span style={{ fontSize: 18 }}>{icon}</span>
            <span>{text}</span>
          </div>
        ))}
      </div>

      <button onClick={onRetry}
        style={{ padding: '14px 32px', background: green, color: '#000', border: 'none', borderRadius: 12, fontWeight: 800, cursor: 'pointer', fontSize: 15 }}>
        🔁 Try again
      </button>
      <p style={{ marginTop: 20, color: '#555', fontSize: 12 }}>
        rachett resumes automatically when you're back online.
      </p>
    </div>
  )
}

export default OfflineScreen
