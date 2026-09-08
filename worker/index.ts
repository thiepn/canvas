import type { CanvasEnv } from './env.ts'
import { corsHeaders, originAllowed, parseOrigins } from './security/origins.ts'
import { authorizedAdmin } from './security/admin.ts'
import { WORLD_ID, ENGINE_VERSION } from '../shared/limits.ts'
export { CanvasRoom } from './CanvasRoom.ts'

export default {
  async fetch(request: Request, env: CanvasEnv): Promise<Response> {
    const url = new URL(request.url)
    try {
      if (env.APP_ENV === 'test' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return new Response('Test configuration cannot serve a public deployment.', { status: 503 })
      const origins = parseOrigins(env.ALLOWED_ORIGINS)
      if (url.pathname === '/health' && request.method === 'GET') {
        return Response.json({ ok: true, app: 'Canvas', world: WORLD_ID, engine: ENGINE_VERSION }, { headers: corsHeaders(request, origins) })
      }
      const isConnect = url.pathname === '/api/connect/main'
      const isSnapshot = url.pathname === '/api/snapshot'
      const isAdmin = url.pathname.startsWith('/api/admin/')
      if (!isConnect && !isSnapshot && !isAdmin) return new Response('Not found.', { status: 404 })
      if (isAdmin) {
        // Administrative tooling is intentionally not a browser feature.
        if (request.headers.has('Origin')) return new Response('Administrative browser requests are disabled.', { status: 403 })
        if (!await authorizedAdmin(request, env.ADMIN_TOKEN)) return new Response('Unauthorized.', { status: 401, headers: { 'Cache-Control': 'no-store' } })
      } else {
        if (!originAllowed(request, origins)) return new Response('Origin not allowed.', { status: 403 })
        if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, origins) })
        if (request.method !== 'GET') return new Response('Method not allowed.', { status: 405, headers: { Allow: 'GET, OPTIONS' } })
        if (isConnect && request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('WebSocket upgrade required.', { status: 426 })
      }
      const room = env.CANVAS_ROOM.get(env.CANVAS_ROOM.idFromName(WORLD_ID))
      const result = await room.fetch(request)
      // Constructing a regular Response around status 101 would discard the WebSocket.
      if (result.status === 101) return result
      const headers = corsHeaders(request, origins)
      result.headers.forEach((value, key) => headers.set(key, value))
      return new Response(result.body, { status: result.status, headers })
    } catch (error) {
      console.error('canvas.request.failed', error instanceof Error ? error.message : 'Unknown error')
      return new Response('Canvas backend encountered an error. Try again shortly.', { status: 500, headers: { 'Cache-Control': 'no-store' } })
    }
  },
} satisfies ExportedHandler<CanvasEnv>
