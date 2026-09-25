import { expect, test, type Browser, type Page } from '@playwright/test'
import { createClient, type RealtimeChannel } from '@supabase/supabase-js'
import { DEFAULT_SUPABASE_PUBLISHABLE_KEY, DEFAULT_SUPABASE_URL } from '../../app/config/public-config.ts'
import { CANVAS_PREVIEW_PROTOCOL } from '../../app/canvas/preview-lane.ts'
import { dragOnCanvas, exportElement } from './scene-helpers.ts'
import { retryTransientSupabaseTestOperation } from './supabase-test-helpers.ts'

const TABLE = 'canvas_ci_elements'
const supabase = createClient(DEFAULT_SUPABASE_URL, DEFAULT_SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
})

async function cleanWorld() {
  const { error } = await retryTransientSupabaseTestOperation(() => supabase.from(TABLE).delete().neq('id', ''))
  if (error) throw error
}

async function rows() {
  const { data, error } = await retryTransientSupabaseTestOperation(() => supabase.from(TABLE).select('id,version,version_nonce,is_deleted,element'))
  if (error) throw error
  return data ?? []
}

async function diagnostics(page: Page) {
  await expect.poll(() => page.evaluate(() => Boolean(window.__CANVAS_DIAGNOSTICS__))).toBe(true)
  return page.evaluate(() => window.__CANVAS_DIAGNOSTICS__!.snapshot())
}

async function resetDiagnostics(page: Page) {
  await diagnostics(page)
  await page.evaluate(() => window.__CANVAS_DIAGNOSTICS__!.reset())
}

async function connectPair(browser: Browser) {
  const contextA = await browser.newContext({ viewport: { width: 1366, height: 768 } })
  const contextB = await browser.newContext({ viewport: { width: 1366, height: 768 } })
  const pageA = await contextA.newPage()
  const pageB = await contextB.newPage()
  await Promise.all([pageA.goto('./?debug=1'), pageB.goto('./?debug=1')])
  await Promise.all([
    expect(pageA.getByText('Live', { exact: true })).toBeVisible(),
    expect(pageB.getByText('Live', { exact: true })).toBeVisible(),
  ])
  await Promise.all([resetDiagnostics(pageA), resetDiagnostics(pageB)])
  return { contextA, contextB, pageA, pageB }
}

async function beginHeldRectangle(page: Page) {
  await page.bringToFront()
  await page.getByTitle(/^Rectangle\b/i).click()
  await expect(page.getByRole('radio', { name: /^Rectangle\b/i })).toBeChecked()
  const box = await page.locator('.live-excalidraw').boundingBox()
  if (!box) throw new Error('Live Excalidraw surface has no bounding box.')
  const from: [number, number] = [310, 260]
  const to: [number, number] = [500, 370]
  await page.mouse.move(box.x + from[0], box.y + from[1])
  await page.mouse.down()
  // Keep this synthetic hold far below the 1.5 s durability checkpoint even
  // on a slow CI browser. Two real pointer moves are enough to produce an
  // intermediate geometry snapshot and a Broadcast preview.
  for (let step = 1; step <= 2; step++) {
    await page.mouse.move(
      box.x + from[0] + (to[0] - from[0]) * step / 2,
      box.y + from[1] + (to[1] - from[1]) * step / 2,
    )
    await page.waitForTimeout(25)
  }
}

async function createRectangle(page: Page): Promise<Record<string, unknown>> {
  await page.getByTitle(/^Rectangle\b/i).click()
  await dragOnCanvas(page, [300, 250], [430, 330], 8)
  let stored: Record<string, unknown> | undefined
  await expect.poll(async () => {
    const current = await rows()
    stored = current.find(row => row.element && typeof row.element === 'object')?.element as Record<string, unknown> | undefined
    return stored?.type
  }).toBe('rectangle')
  return stored!
}

function subscribe(channel: RealtimeChannel): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Synthetic preview channel did not subscribe.')), 10_000)
    channel.subscribe(status => {
      if (status === 'SUBSCRIBED') { clearTimeout(timeout); resolve() }
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') { clearTimeout(timeout); reject(new Error(`Synthetic preview channel: ${status}`)) }
    })
  })
}

test.beforeEach(cleanWorld)
test.afterEach(cleanWorld)

test('active pointer geometry reaches the peer over Broadcast without requiring the final durability boundary', async ({ browser }) => {
  const { contextA, contextB, pageA, pageB } = await connectPair(browser)
  try {
    await beginHeldRectangle(pageA)

    // Broadcast must become visible while the pointer is still held. On a very
    // slow CI engine the 1.5 s safety checkpoint may legitimately fire before
    // the assertion process samples the database, so do not confuse that
    // bounded safety write with the final operation boundary.
    await expect.poll(
      async () => Number((await diagnostics(pageB)).counters.previewBroadcastsReceived ?? 0),
      { timeout: 5_000 },
    ).toBeGreaterThan(0)

    const heldA = await diagnostics(pageA)
    const heldB = await diagnostics(pageB)
    expect(heldA.counters.previewBroadcastsSent ?? 0).toBeGreaterThan(0)
    expect(Number(heldB.gauges.activeRemotePreviews ?? 0)).toBeGreaterThan(0)
    expect(heldA.counters.durabilityBoundaryFlushes ?? 0).toBe(0)

    const rowsWhileHeld = await rows()
    const checkpointsWhileHeld = Number(heldA.counters.durabilityCheckpoints ?? 0)
    if (rowsWhileHeld.length) {
      // The only durable state allowed before pointer-up is a long-operation
      // safety checkpoint. It must still be one logical row, never a second
      // object or an early final-boundary flush.
      expect(checkpointsWhileHeld).toBeGreaterThan(0)
      expect(rowsWhileHeld).toHaveLength(1)
      expect(Number(heldA.counters.dbWriteBatches ?? 0)).toBeLessThanOrEqual(checkpointsWhileHeld)
    } else {
      expect(Number(heldA.counters.dbWriteBatches ?? 0)).toBe(0)
    }

    await pageA.mouse.up()
    await expect.poll(async () => (await rows()).length).toBe(1)
    await expect.poll(
      async () => Number((await diagnostics(pageA)).counters.durabilityBoundaryFlushes ?? 0),
    ).toBe(1)
    await expect.poll(async () => Number((await diagnostics(pageB)).gauges.activeRemotePreviews ?? 0)).toBe(0)

    const settled = await diagnostics(pageA)
    expect(Number(settled.counters.dbWriteBatches ?? 0)).toBeLessThanOrEqual(
      Number(settled.counters.durabilityCheckpoints ?? 0) + 1,
    )
  } finally {
    await pageA.mouse.up().catch(() => {})
    await Promise.allSettled([contextA.close(), contextB.close()])
  }
})

test('an abandoned remote preview expires back to the authoritative element without a database write', async ({ browser }) => {
  const { contextA, contextB, pageA, pageB } = await connectPair(browser)
  const synthetic = createClient(DEFAULT_SUPABASE_URL, DEFAULT_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  let channel: RealtimeChannel | null = null
  try {
    const stored = await createRectangle(pageA)
    const id = String(stored.id)
    const authoritativeX = Number(stored.x)
    const authoritativeVersion = Number(stored.version)
    const previewX = authoritativeX + 180

    // This test targets preview expiry, not Realtime row-delivery timing. The
    // rectangle is already proven durable above, so reload the peer and let the
    // production initial-hydration path deterministically establish the exact
    // authoritative fallback map that expiry restores from.
    await pageB.reload()
    await expect(pageB.getByText('Live', { exact: true })).toBeVisible({ timeout: 15_000 })
    await expect.poll(
      async () => Number((await diagnostics(pageB)).counters.authoritativeRowsAccepted ?? 0),
      { timeout: 10_000 },
    ).toBeGreaterThan(0)
    await expect.poll(
      async () => Number((await exportElement(pageB, id))?.x),
      { timeout: 5_000 },
    ).toBe(authoritativeX)
    await expect.poll(
      async () => Number((await diagnostics(pageB)).gauges.activeRemotePreviews ?? 0),
      { timeout: 5_000 },
    ).toBe(0)
    await resetDiagnostics(pageB)

    const previewElement = { ...stored, x: previewX, version: authoritativeVersion + 1 }
    channel = synthetic.channel(`canvas:${TABLE}:v1`, { config: { broadcast: { self: false } } })
    await subscribe(channel)
    const result = await channel.send({
      type: 'broadcast',
      event: 'preview',
      payload: {
        protocol: CANVAS_PREVIEW_PROTOCOL,
        deviceId: 'synthetic-preview-peer',
        sessionId: `expiry-${Date.now()}`,
        sequence: 1,
        sentAt: Date.now(),
        source: 'pointer',
        elements: [previewElement],
      },
    })
    expect(result).toBe('ok')

    await expect.poll(
      async () => Number((await diagnostics(pageB)).counters.previewBroadcastsReceived ?? 0),
      { timeout: 5_000 },
    ).toBeGreaterThan(0)
    await expect.poll(
      async () => Number((await diagnostics(pageB)).gauges.activeRemotePreviews ?? 0),
      { timeout: 5_000 },
    ).toBeGreaterThan(0)
    const beforeExpiryRows = await rows()
    expect(beforeExpiryRows).toHaveLength(1)
    expect(Number((beforeExpiryRows[0].element as Record<string, unknown>).x)).toBe(authoritativeX)

    // The first preview test already certifies geometry rendering. This test is
    // specifically the abandoned-preview lifecycle: receipt becomes active,
    // no database write occurs, and receive-time TTL restores authority.
    await expect.poll(
      async () => ({
        active: Number((await diagnostics(pageB)).gauges.activeRemotePreviews ?? 0),
        expirations: Number((await diagnostics(pageB)).counters.previewExpirations ?? 0),
      }),
      { timeout: 4_000 },
    ).toEqual({ active: 0, expirations: 1 })
    await expect.poll(async () => Number((await exportElement(pageB, id))?.x), { timeout: 5_000 }).toBe(authoritativeX)
    const afterExpiryRows = await rows()
    expect(afterExpiryRows).toHaveLength(1)
    expect(Number((afterExpiryRows[0].element as Record<string, unknown>).x)).toBe(authoritativeX)
  } finally {
    if (channel) await synthetic.removeChannel(channel).catch(() => {})
    await Promise.allSettled([contextA.close(), contextB.close()])
  }
})
