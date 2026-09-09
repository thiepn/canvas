export interface PublicConfig { apiUrl: string; websocketUrl: string; licenseKey?: string }
export interface LiveConfig { supabaseUrl: string; supabaseKey: string }

export const DEFAULT_SUPABASE_URL = 'https://hycegznamzjhwinegaai.supabase.co'
export const DEFAULT_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_1rZzRPzfLMaAH5pIgCwIjA_19UPMIsR'

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

export function createLiveConfig(urlValue: string | undefined, keyValue: string | undefined): LiveConfig {
  const rawUrl = urlValue?.trim() || DEFAULT_SUPABASE_URL
  const rawKey = keyValue?.trim() || DEFAULT_SUPABASE_PUBLISHABLE_KEY
  let url: URL
  try { url = new URL(rawUrl) } catch { throw new Error('VITE_SUPABASE_URL must be a complete HTTPS URL.') }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) throw new Error('Canvas Supabase URL must be an HTTPS origin without credentials, path, query, or fragment.')
  if (!rawKey || rawKey.length > 512) throw new Error('Canvas needs a Supabase publishable key.')
  return { supabaseUrl: url.origin, supabaseKey: rawKey }
}

export function normalizeBasePath(value = '/canvas/'): string {
  if (!value.startsWith('/') || /[?#\\]/.test(value) || value.split('/').includes('..')) throw new Error('VITE_BASE_PATH must be an absolute URL path, for example /canvas/ or /.')
  return value.endsWith('/') ? value : `${value}/`
}
