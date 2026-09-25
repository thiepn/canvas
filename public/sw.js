/* Static application shell only. Shared Supabase state is never cached here. */
const CACHE = 'canvas-shell-__BUILD_ID__'
const scope = new URL(self.registration.scope)
const shell = [
  scope.href,
  new URL('manifest.webmanifest', scope).href,
  new URL('icon.svg', scope).href,
  new URL('icon-192.png', scope).href,
  new URL('icon-512.png', scope).href,
]

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(shell)))
  // Do not skipWaiting automatically: an update must not swap the worker
  // controlling an editor session in the middle of that session.
})

self.addEventListener('message', event => {
  if (event.data?.type === 'CANVAS_ACTIVATE_UPDATE') void self.skipWaiting()
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key.startsWith('canvas-shell-') && key !== CACHE)
          .map(key => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  )
})

async function cacheStatic(request, response) {
  if (!response || !response.ok || response.type !== 'basic') return response
  const cache = await caches.open(CACHE)
  await cache.put(request, response.clone())
  return response
}

async function navigationResponse(request) {
  try {
    const response = await fetch(request, { cache: 'no-store' })
    if (response.ok) {
      const cache = await caches.open(CACHE)
      await cache.put(scope.href, response.clone())
    }
    return response
  } catch {
    const cache = await caches.open(CACHE)
    return (await cache.match(scope.href))
      || new Response('Canvas is offline. Reconnect once to load the application.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
  }
}

self.addEventListener('fetch', event => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)

  // Never intercept cross-origin Supabase/API traffic or URLs outside this PWA scope.
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return

  if (request.mode === 'navigate') {
    event.respondWith(navigationResponse(request))
    return
  }

  if (!['script', 'style', 'font', 'image'].includes(request.destination)
    && !url.pathname.endsWith('.webmanifest')) return

  event.respondWith((async () => {
    const cache = await caches.open(CACHE)
    const cached = await cache.match(request)
    if (cached) return cached
    try {
      return await cacheStatic(request, await fetch(request))
    } catch {
      return Response.error()
    }
  })())
})
