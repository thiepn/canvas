import { canvasDiagnostics } from './metrics.ts'

const CANVAS_REST_PATH = '/rest/v1/canvas_'

function requestInfo(input: RequestInfo | URL, init?: RequestInit): { url: string; method: string } {
  if (input instanceof Request) return { url: input.url, method: (init?.method ?? input.method ?? 'GET').toUpperCase() }
  return { url: String(input), method: (init?.method ?? 'GET').toUpperCase() }
}

function installNetworkMetrics(): () => void {
  const originalFetch = window.fetch.bind(window)
  let inFlightWrites = 0
  const knownRows = new Map<string, boolean>()

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const info = requestInfo(input, init)
    const isCanvas = info.url.includes(CANVAS_REST_PATH)
    const isWrite = isCanvas && ['POST', 'PATCH', 'PUT', 'DELETE'].includes(info.method)
    const started = performance.now()
    if (isWrite) {
      inFlightWrites += 1
      canvasDiagnostics.gauge('pendingWrites', inFlightWrites)
      canvasDiagnostics.increment('dbWriteBatches')
    }
    try {
      const response = await originalFetch(input, init)
      if (isCanvas) {
        const duration = performance.now() - started
        if (isWrite) {
          canvasDiagnostics.sample('supabaseWriteMs', duration)
          if (!response.ok) canvasDiagnostics.increment('dbWriteFailures')
        } else if (info.method === 'GET') {
          canvasDiagnostics.sample('hydrationQueryMs', duration)
          void response.clone().json().then((rows: unknown) => {
            if (!Array.isArray(rows)) return
            for (const candidate of rows) {
              if (!candidate || typeof candidate !== 'object') continue
              const row = candidate as Record<string, unknown>
              if (typeof row.id === 'string' && typeof row.is_deleted === 'boolean') knownRows.set(row.id, row.is_deleted)
            }
            canvasDiagnostics.gauge('sceneElements', [...knownRows.values()].filter(isDeleted => !isDeleted).length)
            canvasDiagnostics.gauge('serverRowsObserved', knownRows.size)
          }).catch(() => {})
        }
      }
      return response
    } finally {
      if (isWrite) {
        inFlightWrites = Math.max(0, inFlightWrites - 1)
        canvasDiagnostics.gauge('pendingWrites', inFlightWrites)
      }
    }
  }

  return () => { window.fetch = originalFetch }
}

function installConnectionMetrics(): () => void {
  const startedAt = performance.now()
  let last = ''
  let everLive = false
  let reconnectStartedAt: number | null = null
  const read = () => {
    const state = document.querySelector('.connection')?.textContent?.trim() ?? ''
    if (!state || state === last) return
    const previous = last
    last = state
    canvasDiagnostics.gauge('connectionState', state)
    if (state === 'Live') {
      if (!everLive) canvasDiagnostics.sample('initialHydrationMs', performance.now() - startedAt)
      else if (reconnectStartedAt !== null) canvasDiagnostics.sample('reconnectMs', performance.now() - reconnectStartedAt)
      everLive = true
      reconnectStartedAt = null
    } else if (everLive && previous === 'Live' && reconnectStartedAt === null) reconnectStartedAt = performance.now()
  }
  const observer = new MutationObserver(read)
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true })
  read()
  return () => observer.disconnect()
}

function installGestureMetrics(): () => void {
  let active = false
  let writesAtStart = 0
  let token = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  const down = (event: PointerEvent) => {
    if (!(event.target instanceof HTMLCanvasElement) || !event.target.matches('canvas.excalidraw__canvas.interactive')) return
    active = true
    token += 1
    writesAtStart = canvasDiagnostics.counter('dbWriteBatches')
    if (timer) clearTimeout(timer)
  }
  const end = () => {
    if (!active) return
    active = false
    const current = token
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      if (current !== token) return
      canvasDiagnostics.sample('writesPerGesture', canvasDiagnostics.counter('dbWriteBatches') - writesAtStart)
      timer = null
    }, 650)
  }
  document.addEventListener('pointerdown', down, true)
  document.addEventListener('pointerup', end, true)
  document.addEventListener('pointercancel', end, true)
  return () => {
    if (timer) clearTimeout(timer)
    document.removeEventListener('pointerdown', down, true)
    document.removeEventListener('pointerup', end, true)
    document.removeEventListener('pointercancel', end, true)
  }
}

export function installDiagnosticsRuntime(): () => void {
  if (!canvasDiagnostics.enabled || typeof window === 'undefined') return () => {}
  const cleanups = [installNetworkMetrics(), installConnectionMetrics(), installGestureMetrics()]
  return () => { for (const cleanup of cleanups.reverse()) cleanup() }
}
