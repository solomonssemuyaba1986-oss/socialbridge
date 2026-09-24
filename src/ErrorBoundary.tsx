import { Component, type ErrorInfo, type ReactNode } from 'react'
import { trackEvent } from './analytics'

/**
 * The last line of defence: a crash mid-render used to leave a **white page** — no message, no way
 * back, and nothing in the app to tell us what happened. React only unmounts the tree; it does not
 * explain itself.
 *
 * This catches it, keeps the person on a screen they can act from, and records what broke so it
 * can be fixed rather than reported as "it just went blank". (`error_shown` was reserved in the
 * taxonomy for exactly this moment.)
 */
interface Props {
  children: ReactNode
}

interface State {
  message: string
  /** The React component stack, which is what actually points at the guilty file. */
  where: string
  crashed: boolean
}

class ErrorBoundary extends Component<Props, State> {
  state: State = { message: '', where: '', crashed: false }

  static getDerivedStateFromError(error: unknown): State {
    return {
      crashed: true,
      message: error instanceof Error ? error.message : String(error),
      where: '',
    }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    const where = info.componentStack || ''
    // Keep it in the console too — that is where a developer will look first.
    console.error('rachett: a screen crashed and was caught by the boundary.', error, info)
    this.setState({ where })
    try {
      trackEvent('error_shown', {
        kind: 'render',
        message: (error instanceof Error ? error.message : String(error)).slice(0, 140),
      })
    } catch {
      // The analytics layer must never be the thing that breaks the error screen.
    }
  }

  render() {
    if (!this.state.crashed) return this.props.children

    return (
      <div className="rt-page" style={{ minHeight: '100vh', background: '#0f0f0f', color: '#fff', fontFamily: 'sans-serif', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
        <div style={{ maxWidth: '460px', width: '100%', background: '#1a1a1a', border: '1px solid #262626', borderRadius: '16px', padding: '24px' }}>
          <p style={{ margin: 0, fontSize: '15px', fontWeight: 800, color: '#fff' }}>
            Something on this screen broke
          </p>
          <p style={{ margin: '8px 0 0', fontSize: '13px', color: '#aaa', lineHeight: 1.6 }}>
            Your bag, orders and messages are safe — nothing was lost. Reload, or go back to the market.
          </p>

          {this.state.message && (
            <p style={{ margin: '12px 0 0', padding: '10px', background: '#111', border: '1px solid #2a2a2a', borderRadius: '8px', color: '#f88', fontSize: '12px', fontFamily: 'monospace', lineHeight: 1.5, wordBreak: 'break-word' }}>
              {this.state.message}
            </p>
          )}
          {this.state.where && (
            <details style={{ marginTop: '10px' }}>
              <summary style={{ color: '#777', fontSize: '12px', cursor: 'pointer' }}>Where it happened</summary>
              <pre style={{ margin: '8px 0 0', color: '#666', fontSize: '11px', lineHeight: 1.5, whiteSpace: 'pre-wrap', maxHeight: '180px', overflow: 'auto' }}>
                {this.state.where}
              </pre>
            </details>
          )}

          <div style={{ display: 'flex', gap: '8px', marginTop: '18px' }}>
            <button onClick={() => window.location.reload()}
              style={{ flex: 1, padding: '12px', background: '#adff2f', color: '#000', border: 'none', borderRadius: '10px', fontWeight: 800, fontSize: '14px', cursor: 'pointer' }}>
              Reload
            </button>
            <button onClick={() => { window.location.href = '/browse' }}
              style={{ flex: 1, padding: '12px', background: '#222', color: '#fff', border: '1px solid #333', borderRadius: '10px', fontWeight: 700, fontSize: '14px', cursor: 'pointer' }}>
              Back to the market
            </button>
          </div>
        </div>
      </div>
    )
  }
}

export default ErrorBoundary
