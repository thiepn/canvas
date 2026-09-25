const CACHE_NAME = 'canvas-shell-v9'
const SHELL = ['./', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png']

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

async function cacheResponse(request, response) {
  if (!response || !response.ok || response.type !== 'basic') return response
  const cache = await caches.open(CACHE_NAME)
  await cache.put(request, response.clone())
  return response
}

async function navigationResponse(request) {
  try {
    const response = await fetch(request, { cache: 'no-store' })
    return await cacheResponse(request, response)
  } catch {
    const cache = await caches.open(CACHE_NAME)
    return (await cache.match(request, { ignoreSearch: true }))
      || (await cache.match('./'))
      || Response.error()
  }
}

self.addEventListener('fetch', event => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith(navigationResponse(request))
    return
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME)
    const cached = await cache.match(request)
    if (cached) return cached
    try {
      return await cacheResponse(request, await fetch(request))
    } catch {
      return Response.error()
    }
  })())
})
