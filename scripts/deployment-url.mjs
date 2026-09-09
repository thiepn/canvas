/**
 * Pages may report an HTTP custom-domain URL even when HTTPS is available.
 * Upgrade the verification target; never disable certificate validation or
 * accept an insecure final response as a successful deployment.
 * @param {string | undefined} value
 * @returns {URL}
 */
export function deploymentUrl(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('CANVAS_DEPLOYED_URL is required.')
  let url
  try { url = new URL(value.trim()) } catch { throw new Error('CANVAS_DEPLOYED_URL must be an absolute HTTP(S) URL.') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Expected an HTTP(S) deployment URL without credentials.')
  }
  url.protocol = 'https:'
  url.search = ''
  url.hash = ''
  if (!url.pathname.endsWith('/')) url.pathname += '/'
  return url
}

/** @param {string} value */
export function requireSecureResponse(value) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('Deployment verification must finish on HTTPS without credentials.')
  }
  return url
}
