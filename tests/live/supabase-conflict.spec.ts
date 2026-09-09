import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { DEFAULT_SUPABASE_PUBLISHABLE_KEY, DEFAULT_SUPABASE_URL } from '../../app/config/public-config.ts'

const TABLE = 'canvas_ci_elements'
const supabase = createClient(DEFAULT_SUPABASE_URL, DEFAULT_SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
})

async function readNonce(id: string): Promise<number | null> {
  const { data, error } = await supabase.from(TABLE).select('version_nonce').eq('id', id).maybeSingle()
  if (error) throw error
  return data?.version_nonce ?? null
}

test('equal-version conflicts use Excalidraw lower-versionNonce ordering', async ({ browserName }) => {
  test.skip(browserName !== 'chromium', 'Database ordering needs one execution, not one per browser engine.')

  const id = `nonce-order-${Date.now()}`
  const row = (versionNonce: number) => ({
    id,
    version: 7,
    version_nonce: versionNonce,
    is_deleted: false,
    updated_by: 'production-e2e',
    element: {
      id,
      type: 'rectangle',
      version: 7,
      versionNonce,
      isDeleted: false,
    },
  })

  try {
    const { error: insertError } = await supabase.from(TABLE).insert(row(100))
    expect(insertError).toBeNull()
    expect(await readNonce(id)).toBe(100)

    const { error: higherNonceError } = await supabase.from(TABLE).update(row(200)).eq('id', id)
    expect(higherNonceError).toBeNull()
    expect(await readNonce(id)).toBe(100)

    const { error: lowerNonceError } = await supabase.from(TABLE).update(row(50)).eq('id', id)
    expect(lowerNonceError).toBeNull()
    expect(await readNonce(id)).toBe(50)
  } finally {
    await supabase.from(TABLE).delete().eq('id', id)
  }
})
