import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.tsx'
import ErrorBoundary from './ErrorBoundary.tsx'
import './index.css'
import './responsive.css'
import { initAnalytics } from './analytics'

// Journey analytics starts before the first render, so the landing page and the
// channel that brought this visitor in are recorded. Idempotent by design.
initAnalytics()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Outside the router on purpose: if a screen throws, the boundary must still offer a way
        out — including a plain link back to the market. */}
    <ErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
)