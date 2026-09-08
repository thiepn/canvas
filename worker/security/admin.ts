export async function authorizedAdmin(request: Request, expected: string | undefined): Promise<boolean> {
  if (!expected || expected.length < 32) return false
  const supplied = request.headers.get('Authorization')
  if (!supplied?.startsWith('Bearer ') || supplied.length > 1024) return false
  const bytes = (value: string) => new TextEncoder().encode(value)
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', bytes(supplied.slice(7))),
    crypto.subtle.digest('SHA-256', bytes(expected)),
  ])
  const left = new Uint8Array(a), right = new Uint8Array(b)
  let mismatch = 0
  for (let i = 0; i < left.length; i++) mismatch |= left[i]! ^ right[i]!
  return mismatch === 0
}
export async function readLimitedBody(request: Request, maxBytes: number): Promise<string> {
  const length = request.headers.get('Content-Length')
  if (length && Number(length) > maxBytes) throw new Error('Request body too large.')
  const reader = request.body?.getReader()
  if (!reader) throw new Error('Request body is missing.')
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) { await reader.cancel(); throw new Error('Request body too large.') }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const result = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength }
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(result)
}
