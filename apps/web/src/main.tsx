import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import App from './App'
import { DesktopWindowChrome } from './components/WindowControls'
import { isTauri } from './secureStorage'
import { registerPwaServiceWorker } from './pwa'
import { installGlobalObservabilityHandlers } from './observability'
import { initializeTheme } from './theme'

initializeTheme()
registerPwaServiceWorker()
installGlobalObservabilityHandlers()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
      {isTauri() && <DesktopWindowChrome />}
    </BrowserRouter>
  </StrictMode>,
)
