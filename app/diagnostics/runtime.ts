import { canvasDiagnostics } from './metrics.ts'

const CANVAS_REST_PATH = '/rest/v1/canvas_'

function requestInfo(input: RequestInfo | URL, init?: RequestInit): { url: string; method: string; body: BodyInit | null | undefined } {
  if (input instanceof Request) return { url: input.url, method: (init?.method ?? input.method ?? 'GET').toUpperCase(), body: init?.body }
  return { url: String(input), method: (init?.method ?? 'GET').toUpperCase(), body: init?.body }
}

function countBodyRows(body: BodyInit | null | undefined): number {
  if (typeof body !== 'string') return 0
  try {
    const parsed: unknown = JSON.parse(body)
    return Array.isArray(parsed) ? parsed.length : parsed && typeof parsed === 'object' ? 1 : 0
  } catch {
    return 0
  }
}

function installNetworkMetrics(): () => void {
  const originalFetch = window.fetch.bind(window)
  let inFlightWrites = 0
  const knownRows = new Map<string, boolean>()

  const instrumentedFetch: typeof window.fetch = async (input, init) => {
    const info = requestInfo(input, init)
    const isCanvas = info.url.includes(CANVAS_REST_PATH)
    const isWrite = isCanvas && ['POST', 'PATCH', 'PUT', 'DELETE'].includes(info.method)
    const started = performance.now()
    if (isWrite) {
      inFlightWrites += 1
      canvasDiagnostics.gauge('pendingWrites', inFlightWrites)
      canvasDiagnostics.increment('dbWriteBatches')
      canvasDiagnostics.increment('dbRowsWritten', countBodyRows(info.body))
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
  window.fetch = instrumentedFetch

  return () => { window.fetch = originalFetch }
}

function isPostgresRealtimeMessage(data: unknown): boolean {
  if (typeof data !== 'string' || !data.includes('postgres_changes')) return false
  try {
    const parsed: unknown = JSON.parse(data)
    if (Array.isArray(parsed)) return parsed[3] === 'postgres_changes'
    return Boolean(parsed && typeof parsed === 'object' && (parsed as Record<string, unknown>).event === 'postgres_changes')
  } catch {
    return false
  }
}

function installRealtimeMetrics(): () => void {
  const NativeWebSocket = window.WebSocket
  class DiagnosticsWebSocket extends NativeWebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols)
      const socketUrl = String(url)
      if (!socketUrl.includes('supabase') && !socketUrl.includes('/realtime/')) return
      this.addEventListener('message', event => {
        if (!isPostgresRealtimeMessage(event.data)) return
        const receivedAt = performance.now()
        canvasDiagnostics.increment('realtimeMessages')
        requestAnimationFrame(() => canvasDiagnostics.sample('realtimeReceiveToFrameMs', performance.now() - receivedAt))
      })
    }
  }
  window.WebSocket = DiagnosticsWebSocket
  return () => { window.WebSocket = NativeWebSocket }
}

function displayConnectionState(raw: string): string {
  return raw ? `${raw.slice(0, 1).toUpperCase()}${raw.slice(1)}` : ''
}

function installConnectionMetrics(): () => void {
  let lastConnection = ''
  let lastSyncHealth = ''
  let everLive = false
  let reconnectStartedAt: number | null = null
  const read = () => {
    const indicator = document.querySelector<HTMLElement>('[data-connection-state]')
    const connection = displayConnectionState(indicator?.dataset.connectionState ?? '')
    const syncHealth = indicator?.dataset.syncHealth ?? ''

    if (syncHealth && syncHealth !== lastSyncHealth) {
      lastSyncHealth = syncHealth
      canvasDiagnostics.gauge('syncHealth', syncHealth)
    }

    if (!connection || connection === lastConnection) return
    const previous = lastConnection
    lastConnection = connection
    canvasDiagnostics.gauge('connectionState', connection)
    if (connection === 'Live') {
      if (everLive && reconnectStartedAt !== null) canvasDiagnostics.sample('reconnectMs', performance.now() - reconnectStartedAt)
      everLive = true
      reconnectStartedAt = null
    } else if (everLive && previous === 'Live' && reconnectStartedAt === null) {
      reconnectStartedAt = performance.now()
    }
  }
  const observer = new MutationObserver(read)
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-connection-state', 'data-sync-health'] })
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
  const cleanups = [installNetworkMetrics(), installRealtimeMetrics(), installConnectionMetrics(), installGestureMetrics()]
  return () => { for (const cleanup of cleanups.reverse()) cleanup() }
}
