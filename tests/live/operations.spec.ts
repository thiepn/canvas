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

async function resetDiagnostics(page: Page) {
  await expect.poll(() => page.evaluate(() => Boolean(window.__CANVAS_DIAGNOSTICS__))).toBe(true)
  await page.evaluate(() => window.__CANVAS_DIAGNOSTICS__!.reset())
}

async function operationSnapshot(page: Page) {
  return page.evaluate(() => window.__CANVAS_DIAGNOSTICS__!.snapshot())
}

test.beforeEach(cleanWorld)
test.afterEach(cleanWorld)

test('one long pointer gesture becomes one logical mutation while Phase 2 leaves durable cadence unchanged', async ({ page }) => {
  await page.goto('./?debug=1')
  await expect(page.getByText('Live', { exact: true })).toBeVisible()
  await resetDiagnostics(page)

  await page.getByTitle(/^Rectangle\b/i).click()
  await expect(page.getByRole('radio', { name: /^Rectangle\b/i })).toBeChecked()
  // Keep the gesture active long enough for the existing 120ms durable timer
  // to fire more than once. Phase 2 models the operation but does not optimize
  // that persistence cadence; Phase 3 will do so deliberately.
  await dragOnCanvas(page, [300, 250], [530, 390], 20)

  await expect.poll(async () => (await operationSnapshot(page)).counters.logicalMutations ?? 0).toBe(1)
  await expect.poll(async () => (await operationSnapshot(page)).counters.dbWriteBatches ?? 0).toBeGreaterThan(1)
  const snapshot = await operationSnapshot(page)
  expect(snapshot.gauges.lastMutationSource).toBe('pointer')
  expect(snapshot.gauges.lastMutationKind).toBe('create')
  expect(snapshot.gauges.lastMutationChanges).toBe(1)
  expect(snapshot.samples.changesPerMutation?.p95).toBe(1)
  expect(snapshot.counters.logicalMutationChanges).toBe(1)
  expect(snapshot.counters.dbWriteBatches).toBeGreaterThan(snapshot.counters.logicalMutations)
})

test('a slow real text-edit session is one logical mutation instead of idle-time fragments', async ({ page }) => {
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
  const snapshot = await operationSnapshot(page)
  expect(snapshot.gauges.lastMutationSource).toBe('text')
  expect(snapshot.gauges.lastMutationKind).toBe('create')
  expect(snapshot.gauges.lastMutationChanges).toBe(1)
  expect(snapshot.samples.changesPerMutation?.p95).toBe(1)
})
