import { lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { installCanvasWheelZoom } from './canvas/wheel-zoom.ts'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import { createLiveConfig, createPublicConfig } from './config/public-config.ts'
import { DiagnosticsOverlay } from './diagnostics/DiagnosticsOverlay.tsx'
import { canvasDiagnostics, diagnosticsRequested, exposeDiagnostics } from './diagnostics/metrics.ts'
import { installDiagnosticsRuntime } from './diagnostics/runtime.ts'
import './styles/app.css'

const useLegacyHarness = import.meta.env.MODE === 'test' || import.meta.env.VITE_CANVAS_TEST_BACKEND === 'legacy'
const usePerformanceFixture = import.meta.env.MODE === 'performance' && new URLSearchParams(location.search).get('fixture') === '1'
const diagnosticsEnabled = !useLegacyHarness && diagnosticsRequested(location.search, import.meta.env.MODE)
if (diagnosticsEnabled) {
  canvasDiagnostics.enable()
  exposeDiagnostics()
  const removeDiagnosticsRuntime = installDiagnosticsRuntime()
  import.meta.hot?.dispose(removeDiagnosticsRuntime)
}

// Keep the old Worker/tldraw harness available for its regression suite without shipping
// that editor in normal production bundles. Vite can eliminate this branch when false.
const LegacyCanvasEditor = useLegacyHarness ? lazy(() => import('./canvas/CanvasEditor.tsx')) : null
const SupabaseCanvasEditor = lazy(() => import('./canvas/SupabaseCanvasEditor.tsx'))
const PerformanceHarness = usePerformanceFixture ? lazy(() => import('./diagnostics/PerformanceHarness.tsx').then(module => ({ default: module.PerformanceHarness }))) : null

if (!useLegacyHarness) {
  const removeWheelZoom = installCanvasWheelZoom()
  import.meta.hot?.dispose(removeWheelZoom)
}

function Loading() {
  return <main className="boot" role="status"><span>Canvas<span aria-hidden="true">.</span></span><p>Opening the shared canvas…</p></main>
}

function App() {
  if (!globalThis.crypto?.randomUUID || !('WebSocket' in window)) throw new Error('Use a current Chrome, Edge, Firefox, or Safari browser over HTTPS.')
  if (useLegacyHarness && LegacyCanvasEditor) {
    const config = createPublicConfig(import.meta.env.VITE_CANVAS_API_URL, import.meta.env.VITE_TLDRAW_LICENSE_KEY, location.href)
    return <Suspense fallback={<Loading />}><LegacyCanvasEditor config={config} /></Suspense>
  }
  if (usePerformanceFixture && PerformanceHarness) return <><Suspense fallback={<Loading />}><PerformanceHarness /></Suspense>{diagnosticsEnabled && <DiagnosticsOverlay />}</>
  const config = createLiveConfig(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, import.meta.env.VITE_CANVAS_TABLE)
  return <>
    <Suspense fallback={<Loading />}><SupabaseCanvasEditor config={config} /></Suspense>
    {diagnosticsEnabled && <DiagnosticsOverlay />}
  </>
}

createRoot(document.getElementById('root')!).render(<ErrorBoundary><App /></ErrorBoundary>)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => { void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).catch(() => { /* Installation is optional; live Canvas still works without caching. */ }) })
}
