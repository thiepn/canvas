type SupabaseErrorLike = {
  message?: unknown
  code?: unknown
  details?: unknown
  hint?: unknown
}

type SupabaseResultLike = { error: unknown }

function errorText(error: unknown): string {
  if (!error) return ''
  if (typeof error === 'string') return error
  if (error instanceof Error) return `${error.name} ${error.message}`
  if (typeof error === 'object') {
    const value = error as SupabaseErrorLike
    return [value.message, value.code, value.details, value.hint]
      .filter(part => typeof part === 'string')
      .join(' ')
  }
  return String(error)
}

export function isTransientSupabaseTestError(error: unknown): boolean {
  return /gateway\s*timeout|bad\s*gateway|service\s*unavailable|temporar(?:y|ily)\s*unavailable|timeout|timed\s*out|fetch\s*failed|network\s*error|connection\s*(?:reset|closed|refused)|\b50[234]\b/i.test(errorText(error))
}

/**
 * Retry only idempotent test-fixture Supabase operations on transient transport/
 * gateway failures. Product assertions and browser interactions must not use
 * this helper: a semantic failure still fails immediately.
 */
export async function retryTransientSupabaseTestOperation<T extends SupabaseResultLike>(
  operation: () => PromiseLike<T>,
  options: { attempts?: number; baseDelayMs?: number } = {},
): Promise<T> {
  const attempts = options.attempts ?? 4
  const baseDelayMs = options.baseDelayMs ?? 200
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 6) throw new Error('Supabase test retry attempts must be between 1 and 6.')
  if (!Number.isFinite(baseDelayMs) || baseDelayMs < 0 || baseDelayMs > 5000) throw new Error('Supabase test retry delay must be between 0 and 5000 ms.')

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const result = await operation()
    if (!result.error) return result
    if (!isTransientSupabaseTestError(result.error) || attempt === attempts) throw result.error
    const delay = baseDelayMs * 2 ** (attempt - 1)
    if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay))
  }

  throw new Error('Unreachable Supabase test retry state.')
}
