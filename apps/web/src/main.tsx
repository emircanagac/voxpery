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
import { preloadPublicPage } from './pages/publicPageModules'

initializeTheme()
registerPwaServiceWorker()
installGlobalObservabilityHandlers()

function renderApp() {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <BrowserRouter>
        <App />
        {isTauri() && <DesktopWindowChrome />}
      </BrowserRouter>
    </StrictMode>,
  )
}

// The readable HTML of / and /compare stays on screen until their page code is loaded; if the
// load fails, React starts anyway and the lazy route shows its usual loading and error states.
void preloadPublicPage(window.location.pathname).catch(() => {}).finally(renderApp)
