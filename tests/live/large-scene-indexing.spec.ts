import { test, expect, type Browser, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { DEFAULT_SUPABASE_PUBLISHABLE_KEY, DEFAULT_SUPABASE_URL } from '../../app/config/public-config.ts'
import type { DiagnosticsSnapshot } from '../../app/diagnostics/metrics.ts'
import { dragOnCanvas, readScene } from './scene-helpers.ts'

const TABLE = 'canvas_ci_elements'
const TARGET_ROWS = 1100
const supabase = createClient(DEFAULT_SUPABASE_URL, DEFAULT_SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
})

type StoredRow = {
  id: string
  version: number
  version_nonce: number
  element: Record<string, unknown>
}

async function cleanWorld() {
  const { error } = await supabase.from(TABLE).delete().neq('id', '')
  if (error) throw error
}

async function diagnostics(page: Page): Promise<DiagnosticsSnapshot> {
  return page.evaluate(() => {
    if (!window.__CANVAS_DIAGNOSTICS__) throw new Error('Diagnostics API is unavailable.')
    return window.__CANVAS_DIAGNOSTICS__.snapshot()
  })
}

async function createTemplate(browser: Browser): Promise<StoredRow> {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } })
  const page = await context.newPage()
  try {
    await page.goto('./?debug=1')
    await expect(page.getByText('Live', { exact: true })).toBeVisible()
    await page.getByTitle(/^Rectangle\b/i).click()
    await dragOnCanvas(page, [300, 250], [430, 330])
    let row: StoredRow | null = null
    await expect.poll(async () => {
      const { data, error } = await supabase.from(TABLE)
        .select('id,version,version_nonce,element')
        .eq('is_deleted', false)
        .order('revision', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      if (data?.element?.type === 'rectangle' && data.element.width === 130 && data.element.height === 80) row = data as StoredRow
      return Boolean(row)
    }).toBe(true)
    if (!row) throw new Error('Failed to create the large-scene seed rectangle.')
    return row
  } finally {
    await context.close()
  }
}

async function seedLargeScene(template: StoredRow) {
  const rows: Array<Record<string, unknown>> = []
  const baseX = Number(template.element.x)
  const baseY = Number(template.element.y)
  if (!Number.isFinite(baseX) || !Number.isFinite(baseY)) throw new Error('Seed rectangle has invalid coordinates.')

  for (let index = 1; index < TARGET_ROWS; index++) {
    const id = `phase6-scale-${index}`
    const versionNonce = 10_000 + index
    const element = {
      ...template.element,
      id,
      x: 1000 + (index % 50) * 155,
      y: 200 + Math.floor(index / 50) * 110,
      version: 1,
      versionNonce,
      isDeleted: false,
      seed: 20_000 + index,
      updated: Date.now() + index,
    }
    rows.push({
      id,
      version: 1,
      version_nonce: versionNonce,
      is_deleted: false,
      element,
      updated_by: 'phase6-large-scene-seed',
    })
  }

  for (let offset = 0; offset < rows.length; offset += 200) {
    const { error } = await supabase.from(TABLE).upsert(rows.slice(offset, offset + 200), { onConflict: 'id' })
    if (error) throw error
  }

  await expect.poll(async () => {
    const { count, error } = await supabase.from(TABLE).select('*', { count: 'exact', head: true }).eq('is_deleted', false)
    if (error) throw error
    return count
  }).toBe(TARGET_ROWS)
}

test.beforeEach(cleanWorld)
test.afterEach(cleanWorld)

test('large scenes hydrate atomically and local edits skip unchanged element work', async ({ browser }) => {
  test.setTimeout(150_000)
  const template = await createTemplate(browser)
  await seedLargeScene(template)

  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } })
  const page = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    await page.goto('./?debug=1')
    await expect(page.getByText('Live', { exact: true })).toBeVisible({ timeout: 30_000 })

    const hydrated = await diagnostics(page)
    expect(hydrated.gauges.initialHydrationPages).toBe(3)
    expect(hydrated.gauges.initialHydrationRows).toBe(TARGET_ROWS)
    expect(hydrated.counters.initialHydrationSceneCommits).toBe(1)
    const initialScene = await readScene(page)
    expect(initialScene.length).toBe(TARGET_ROWS)
    const initialIds = new Set(initialScene.map(element => element.id))

    // Create a fresh shape in a viewport area that is intentionally left empty
    // by the seeded scene. Reopening a large Excalidraw world does not guarantee
    // that fixed browser coordinates still map to the original seed rectangle,
    // so a new shape is a deterministic way to exercise the same Phase 6 path:
    // 1,100 unchanged elements plus one genuine local mutation.
    const before = await diagnostics(page)
    await page.getByTitle(/^Rectangle\b/i).click()
    await expect(page.getByRole('radio', { name: /^Rectangle\b/i })).toBeChecked()
    await dragOnCanvas(page, [600, 450], [710, 520], 5)

    let createdId = ''
    await expect.poll(async () => {
      const { data, error } = await supabase.from(TABLE)
        .select('id,element,is_deleted,updated_by,revision')
        .eq('is_deleted', false)
        .order('revision', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      if (!data || initialIds.has(data.id)) return ''
      if (data.updated_by === 'phase6-large-scene-seed') return ''
      if (data.element?.type !== 'rectangle' || data.element.width !== 110 || data.element.height !== 70) return ''
      createdId = data.id
      return createdId
    }, { message: 'A fresh rectangle must persist from the 1,100-element scene.' }).not.toBe('')

    await expect.poll(async () => (await readScene(page)).some(element => element.id === createdId)).toBe(true)

    const after = await diagnostics(page)
    const skipped = (after.counters.sceneElementsStampSkipped ?? 0) - (before.counters.sceneElementsStampSkipped ?? 0)
    const changed = (after.counters.sceneElementsChanged ?? 0) - (before.counters.sceneElementsChanged ?? 0)
    const scanned = (after.counters.sceneElementsScanned ?? 0) - (before.counters.sceneElementsScanned ?? 0)

    expect(scanned).toBeGreaterThanOrEqual(TARGET_ROWS)
    expect(skipped).toBeGreaterThan(500)
    expect(changed).toBeGreaterThan(0)
    expect(skipped).toBeGreaterThan(changed * 10)
    expect(errors).toEqual([])
  } finally {
    await context.close()
  }
})
