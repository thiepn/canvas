export type LiveTableName = 'canvas_elements' | 'canvas_ci_elements'
export interface LiveConfig { supabaseUrl: string; supabaseKey: string; tableName: LiveTableName }

export const DEFAULT_SUPABASE_URL = 'https://hycegznamzjhwinegaai.supabase.co'
export const DEFAULT_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_1rZzRPzfLMaAH5pIgCwIjA_19UPMIsR'

export function createLiveConfig(urlValue: string | undefined, keyValue: string | undefined, tableValue?: string): LiveConfig {
  const rawUrl = urlValue?.trim() || DEFAULT_SUPABASE_URL
  const rawKey = keyValue?.trim() || DEFAULT_SUPABASE_PUBLISHABLE_KEY
  let url: URL
  try { url = new URL(rawUrl) } catch { throw new Error('VITE_SUPABASE_URL must be a complete HTTPS URL.') }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) throw new Error('Canvas Supabase URL must be an HTTPS origin without credentials, path, query, or fragment.')
  if (!rawKey || rawKey.length > 512) throw new Error('Canvas needs a Supabase publishable key.')
  const tableName = tableValue?.trim() || 'canvas_elements'
  if (tableName !== 'canvas_elements' && tableName !== 'canvas_ci_elements') throw new Error('Canvas table name is not allowed.')
  return { supabaseUrl: url.origin, supabaseKey: rawKey, tableName }
}

export function normalizeBasePath(value = '/canvas/'): string {
  if (!value.startsWith('/') || /[?#\\]/.test(value) || value.split('/').includes('..')) throw new Error('VITE_BASE_PATH must be an absolute URL path, for example /canvas/ or /.')
  return value.endsWith('/') ? value : `${value}/`
}
