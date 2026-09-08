export function parseOrigins(csv: string): Set<string> {
  const result = new Set<string>()
  for (const raw of csv.split(',').map(item => item.trim()).filter(Boolean)) {
    const value = new URL(raw)
    if (!['https:', 'http:'].includes(value.protocol) || value.username || value.password || value.pathname !== '/' || value.search || value.hash) throw new Error('ALLOWED_ORIGINS contains an invalid origin.')
    result.add(value.origin)
  }
  return result
}
export function originAllowed(request: Request, origins: Set<string>): boolean {
  const value = request.headers.get('Origin')
  return value !== null && origins.has(value)
}
export function corsHeaders(request: Request, origins: Set<string>): Headers {
  const headers = new Headers({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Vary': 'Origin' })
  const origin = request.headers.get('Origin')
  if (origin && origins.has(origin)) {
    headers.set('Access-Control-Allow-Origin', origin)
    headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS')
    headers.set('Access-Control-Allow-Headers', 'Content-Type')
    headers.set('Access-Control-Max-Age', '600')
  }
  return headers
}
