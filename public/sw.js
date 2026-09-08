/* Static app shell only. Never cache API responses or shared canvas state. */
const CACHE = 'canvas-shell-__BUILD_ID__'
const scope = new URL(self.registration.scope)
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll([scope.href, new URL('icon.svg', scope).href, new URL('manifest.webmanifest', scope).href])))
  // No skipWaiting: a release must not replace editor code in the middle of a session.
})
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('canvas-shell-') && key !== CACHE).map(key => caches.delete(key)))))
})
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname) || url.pathname.includes('/api/')) return
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => {
      if (response.ok) event.waitUntil(caches.open(CACHE).then(cache => cache.put(scope.href, response.clone())))
      return response
    }).catch(async () => (await caches.match(scope.href)) || new Response('Canvas is offline. Reconnect once to load the application.', { status: 503, headers: { 'Content-Type': 'text/plain' } })))
    return
  }
  if (!['script', 'style', 'font', 'image'].includes(request.destination) && !url.pathname.endsWith('.webmanifest')) return
  event.respondWith(caches.open(CACHE).then(async cache => {
    const cached = await cache.match(request)
    if (cached) return cached
    const response = await fetch(request)
    if (response.ok && response.type === 'basic') await cache.put(request, response.clone())
    return response
  }))
})
