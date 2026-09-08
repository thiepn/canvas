import { lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import { createPublicConfig } from './config/public-config.ts'
import './styles/app.css'
const CanvasEditor = lazy(() => import('./canvas/CanvasEditor.tsx'))
function App() {
  if (!globalThis.crypto?.randomUUID || !('WebSocket' in window)) throw new Error('Use a current Chrome, Edge, Firefox, or Safari browser over HTTPS.')
  const config = createPublicConfig(import.meta.env.VITE_CANVAS_API_URL, import.meta.env.VITE_TLDRAW_LICENSE_KEY, location.href)
  return <Suspense fallback={<main className="boot" role="status"><span>Canvas<span aria-hidden="true">.</span></span><p>Opening the shared canvas…</p></main>}><CanvasEditor config={config} /></Suspense>
}
createRoot(document.getElementById('root')!).render(<ErrorBoundary><App /></ErrorBoundary>)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => { void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).catch(() => { /* Installation is optional; live Canvas still works without caching. */ }) })
}
