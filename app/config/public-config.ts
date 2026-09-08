export interface PublicConfig { apiUrl: string; websocketUrl: string; licenseKey?: string }
export function isLocalHostname(hostname: string): boolean {
  return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname)
}
export function createPublicConfig(apiValue: string | undefined, licenseValue: string | undefined, pageUrl: string): PublicConfig {
  const page = new URL(pageUrl)
  const local = isLocalHostname(page.hostname)
  const raw = apiValue?.trim() || (local ? 'http://127.0.0.1:8787' : '')
  if (!raw) throw new Error('Canvas has no backend URL. Set VITE_CANVAS_API_URL and rebuild the frontend.')
  let api: URL
  try { api = new URL(raw) } catch { throw new Error('VITE_CANVAS_API_URL must be a complete HTTP or HTTPS URL.') }
  if (!['http:', 'https:'].includes(api.protocol) || api.username || api.password || api.search || api.hash || (api.pathname !== '/' && api.pathname !== '')) throw new Error('Use a backend origin only, without a path, credentials, query, or fragment.')
  if (api.protocol !== 'https:' && !(local && isLocalHostname(api.hostname))) throw new Error('Production Canvas requires an HTTPS backend.')
  const key = licenseValue?.trim()
  if (!local && !key) throw new Error('Canvas needs a valid tldraw production license. Add your hobby, trial, or commercial key as VITE_TLDRAW_LICENSE_KEY and rebuild. No key is required on localhost.')
  const ws = new URL('/api/connect/main', api)
  ws.protocol = api.protocol === 'https:' ? 'wss:' : 'ws:'
  return { apiUrl: api.origin, websocketUrl: ws.href, licenseKey: key }
}
export function normalizeBasePath(value = '/Canvas/'): string {
  if (!value.startsWith('/') || /[?#\\]/.test(value) || value.split('/').includes('..')) throw new Error('VITE_BASE_PATH must be an absolute URL path, for example /Canvas/ or /.')
  return value.endsWith('/') ? value : `${value}/`
}
