import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import App from './App'
import { registerPwaServiceWorker } from './pwa'
import { installGlobalObservabilityHandlers } from './observability'

registerPwaServiceWorker()
installGlobalObservabilityHandlers()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
