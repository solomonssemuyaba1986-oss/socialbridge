import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.tsx'
import './index.css'
import './responsive.css'
import { initAnalytics } from './analytics'

// Journey analytics starts before the first render, so the landing page and the
// channel that brought this visitor in are recorded. Idempotent by design.
initAnalytics()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)