import { expect, test, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { DEFAULT_SUPABASE_PUBLISHABLE_KEY, DEFAULT_SUPABASE_URL } from '../../app/config/public-config.ts'
import { dragOnCanvas } from './scene-helpers.ts'

const TABLE = 'canvas_ci_elements'
const supabase = createClient(DEFAULT_SUPABASE_URL, DEFAULT_SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
})

async function cleanWorld() {
  const { error } = await supabase.from(TABLE).delete().neq('id', '')
  if (error) throw error
}

async function persistedElements(): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await supabase.from(TABLE).select('element')
  if (error) throw error
  return (data ?? []).map(row => row.element as Record<string, unknown>)
}

async function resetDiagnostics(page: Page) {
  await expect.poll(() => page.evaluate(() => Boolean(window.__CANVAS_DIAGNOSTICS__))).toBe(true)
  await page.evaluate(() => window.__CANVAS_DIAGNOSTICS__!.reset())
}

async function operationSnapshot(page: Page) {
  return page.evaluate(() => window.__CANVAS_DIAGNOSTICS__!.snapshot())
}

test.beforeEach(cleanWorld)
test.afterEach(cleanWorld)

test('one pointer gesture becomes one logical mutation and one final durable write', async ({ page }) => {
  await page.goto('./?debug=1')
  await expect(page.getByText('Live', { exact: true })).toBeVisible()
  await resetDiagnostics(page)

  await page.getByTitle(/^Rectangle\b/i).click()
  await expect(page.getByRole('radio', { name: /^Rectangle\b/i })).toBeChecked()
  // Eight frame-paced moves still span well beyond the old 120 ms save timer,
  // while remaining below the intentional 1.5 s long-operation checkpoint on
  // slower browser engines. The separate long-operation test covers checkpoints.
  await dragOnCanvas(page, [300, 250], [530, 390], 8)

  await expect.poll(async () => (await operationSnapshot(page)).counters.logicalMutations ?? 0).toBe(1)
  await expect.poll(async () => (await operationSnapshot(page)).counters.dbWriteBatches ?? 0).toBe(1)
  const snapshot = await operationSnapshot(page)
  expect(snapshot.gauges.lastMutationSource).toBe('pointer')
  expect(snapshot.gauges.lastMutationKind).toBe('create')
  expect(snapshot.gauges.lastMutationChanges).toBe(1)
  expect(snapshot.samples.changesPerMutation?.p95).toBe(1)
  expect(snapshot.counters.logicalMutationChanges).toBe(1)
  expect(snapshot.counters.dbWriteBatches).toBe(1)
  expect(snapshot.counters.dbRowsWritten).toBe(1)
  expect(snapshot.counters.durabilityBoundaryFlushes).toBe(1)
  expect(snapshot.counters.durabilityCheckpoints ?? 0).toBe(0)

  // Network diagnostics count a write when fetch starts. Wait separately for
  // authoritative storage so this assertion proves completed durability rather
  // than merely observing that a request was launched.
  await expect.poll(async () => (await persistedElements()).length).toBe(1)
  const [persisted] = await persistedElements()
  expect(Number(persisted.width)).toBeGreaterThan(200)
  expect(Number(persisted.height)).toBeGreaterThan(120)
})

test('a slow text-edit session remains one logical mutation and saves once at its boundary', async ({ page }) => {
  await page.goto('./?debug=1')
  await expect(page.getByText('Live', { exact: true })).toBeVisible()
  await resetDiagnostics(page)

  await page.getByTitle(/^Text\b/i).click()
  await expect(page.getByRole('radio', { name: /^Text\b/i })).toBeChecked()
  const box = await page.locator('.live-excalidraw').boundingBox()
  if (!box) throw new Error('Live Excalidraw surface has no bounding box.')
  await page.mouse.click(box.x + 360, box.y + 300)
  await page.keyboard.type('Slow')
  await page.waitForTimeout(450)
  await page.keyboard.type(' text')
  await page.waitForTimeout(450)
  await page.keyboard.type(' session')
  await page.keyboard.press('Escape')

  await expect.poll(async () => (await operationSnapshot(page)).counters.logicalMutations ?? 0).toBe(1)
  await expect.poll(async () => (await operationSnapshot(page)).counters.dbWriteBatches ?? 0).toBe(1)
  const snapshot = await operationSnapshot(page)
  expect(snapshot.gauges.lastMutationSource).toBe('text')
  expect(snapshot.gauges.lastMutationKind).toBe('create')
  expect(snapshot.gauges.lastMutationChanges).toBe(1)
  expect(snapshot.samples.changesPerMutation?.p95).toBe(1)
  expect(snapshot.counters.dbWriteBatches).toBe(1)
  expect(snapshot.counters.dbRowsWritten).toBe(1)
  expect(snapshot.counters.durabilityBoundaryFlushes).toBe(1)
  expect(snapshot.counters.durabilityCheckpoints ?? 0).toBe(0)

  await expect.poll(async () => (await persistedElements()).length).toBe(1)
  const [persisted] = await persistedElements()
  expect(persisted.text).toBe('Slow text session')
})

test('an unusually long pointer operation receives bounded safety checkpoints', async ({ page }) => {
  await page.goto('./?debug=1')
  await expect(page.getByText('Live', { exact: true })).toBeVisible()
  await resetDiagnostics(page)

  await page.getByTitle(/^Rectangle\b/i).click()
  await expect(page.getByRole('radio', { name: /^Rectangle\b/i })).toBeChecked()
  await dragOnCanvas(page, [260, 220], [580, 420], 100)

  await expect.poll(async () => (await operationSnapshot(page)).counters.logicalMutations ?? 0).toBe(1)
  await expect.poll(async () => (await operationSnapshot(page)).counters.durabilityCheckpoints ?? 0).toBeGreaterThanOrEqual(1)
  const snapshot = await operationSnapshot(page)
  expect(snapshot.counters.dbWriteBatches).toBeGreaterThanOrEqual(1)
  expect(snapshot.counters.dbWriteBatches).toBeLessThanOrEqual((snapshot.counters.durabilityCheckpoints ?? 0) + 1)
  expect(snapshot.gauges.lastDurabilityCheckpointSource).toBe('pointer')

  // Even when a checkpoint was persisted mid-gesture, the final boundary must
  // eventually replace it with the completed geometry rather than leaving the
  // peer/database at an intermediate drag frame.
  await expect.poll(async () => {
    const [persisted] = await persistedElements()
    return Number(persisted?.width ?? 0)
  }).toBeGreaterThan(300)
})