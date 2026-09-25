import { expect, test, type Browser, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { DEFAULT_SUPABASE_PUBLISHABLE_KEY, DEFAULT_SUPABASE_URL } from '../../app/config/public-config.ts'
import type { DiagnosticsSnapshot } from '../../app/diagnostics/metrics.ts'
import { dragOnCanvas, readScene } from './scene-helpers.ts'
import { retryTransientSupabaseTestOperation } from './supabase-test-helpers.ts'

const TABLE = 'canvas_ci_elements'
const supabase = createClient(DEFAULT_SUPABASE_URL, DEFAULT_SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
})

async function cleanWorld() {
  const { error } = await retryTransientSupabaseTestOperation(() => supabase.from(TABLE).delete().neq('id', ''))
  if (error) throw error
}

async function activeRows() {
  const { data, error } = await retryTransientSupabaseTestOperation(() =>
    supabase.from(TABLE).select('id,version,element,is_deleted').eq('is_deleted', false),
  )
  if (error) throw error
  return data ?? []
}

async function diagnostics(page: Page): Promise<DiagnosticsSnapshot> {
  return page.evaluate(() => {
    if (!window.__CANVAS_DIAGNOSTICS__) throw new Error('Diagnostics API is unavailable.')
    return window.__CANVAS_DIAGNOSTICS__.snapshot()
  })
}

test.beforeEach(cleanWorld)
test.afterEach(cleanWorld)

test('IndexedDB recovery journal restores an unsaved finished gesture after reload', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Crash-journal recovery contract needs one browser execution.')
  test.setTimeout(90_000)
  await page.goto('./?debug=1')
  await expect(page.getByText('Live', { exact: true })).toBeVisible()

  const postPattern = `**/rest/v1/${TABLE}**`
  await page.route(postPattern, async route => {
    if (route.request().method() === 'POST') {
      await route.abort('failed')
      return
    }
    await route.continue()
  })

  await page.getByTitle(/^Rectangle\b/i).click()
  await dragOnCanvas(page, [300, 250], [430, 330])

  await expect.poll(async () => Number((await diagnostics(page)).gauges.recoveryJournalElements ?? 0)).toBeGreaterThan(0)
  await expect(page.locator('[data-sync-health="retrying-save"]')).toBeVisible()
  await expect.poll(async () => (await activeRows()).length).toBe(0)

  await page.unroute(postPattern)
  await page.reload()
  await expect(page.getByText('Live', { exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/Recovered 1 unsaved local change/i)).toBeVisible()

  await expect.poll(async () => {
    const rows = await activeRows()
    return rows.some(row => row.element?.type === 'rectangle' && row.element?.width === 130 && row.element?.height === 80)
  }, { timeout: 30_000 }).toBe(true)
  await expect(page.locator('[data-sync-health="saved"]')).toBeVisible()
  await expect.poll(async () => Number((await diagnostics(page)).gauges.recoveryJournalElements ?? 0)).toBe(0)
})

test('delayed PostgREST writes stay visibly saving and converge once without duplicate rows', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Latency stress contract needs one browser execution.')
  await page.goto('./?debug=1')
  await expect(page.getByText('Live', { exact: true })).toBeVisible()

  let delayed = 0
  await page.route(`**/rest/v1/${TABLE}**`, async route => {
    if (route.request().method() === 'POST' && delayed < 1) {
      delayed += 1
      await new Promise(resolve => setTimeout(resolve, 1_500))
    }
    await route.continue()
  })

  await page.getByTitle(/^Rectangle\b/i).click()
  await dragOnCanvas(page, [340, 280], [470, 360])
  await expect.poll(() => delayed).toBe(1)
  await expect(page.locator('[data-sync-health="saving"]')).toBeVisible()
  await expect(page.locator('[data-sync-health="saved"]')).toBeVisible({ timeout: 20_000 })

  await expect.poll(async () => {
    const rows = await activeRows()
    return rows.filter(row => row.element?.type === 'rectangle' && row.element?.width === 130 && row.element?.height === 80).length
  }).toBe(1)
})

test('database rejects pathological scene geometry independently of the client', async ({ browserName }) => {
  test.skip(browserName !== 'chromium', 'Backend geometry contract needs one execution.')
  const id = `phase9-geometry-${Date.now()}`
  const element = {
    id,
    type: 'rectangle',
    x: 1_000_000_001,
    y: 0,
    width: 100,
    height: 80,
    angle: 0,
    version: 1,
    versionNonce: 1,
    isDeleted: false,
  }
  const { error } = await supabase.from(TABLE).insert({
    id,
    version: 1,
    version_nonce: 1,
    is_deleted: false,
    updated_by: 'phase9-geometry-test',
    element,
  })
  expect(error).toBeTruthy()
  expect((await activeRows()).some(row => row.id === id)).toBe(false)
})

test('large custom-shape scenes index all objects while rendering only viewport overlays', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'DOM-overlay culling contract needs one browser execution.')
  test.setTimeout(120_000)
  await page.goto('./?debug=1')
  await expect(page.getByText('Live', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Shape library' }).click()
  await page.getByRole('button', { name: 'Heart', exact: true }).click()
  let template: Record<string, unknown> | null = null
  await expect.poll(async () => {
    const row = (await activeRows()).find(candidate => {
      const custom = candidate.element?.customData?.canvasShape
      return custom?.kind === 'heart'
    })
    template = row?.element as Record<string, unknown> | null
    return Boolean(template)
  }).toBe(true)
  if (!template) throw new Error('Custom-shape template did not persist.')

  const rows = Array.from({ length: 600 }, (_, index) => {
    const id = `phase9-shape-${index}`
    const versionNonce = 50_000 + index
    return {
      id,
      version: 1,
      version_nonce: versionNonce,
      is_deleted: false,
      updated_by: 'phase9-culling-seed',
      element: {
        ...template,
        id,
        x: 20_000 + (index % 30) * 180,
        y: 20_000 + Math.floor(index / 30) * 150,
        version: 1,
        versionNonce,
        isDeleted: false,
        updated: Date.now() + index,
      },
    }
  })
  for (let offset = 0; offset < rows.length; offset += 150) {
    const { error } = await supabase.from(TABLE).upsert(rows.slice(offset, offset + 150), { onConflict: 'id' })
    if (error) throw error
  }

  await page.reload()
  await expect(page.getByText('Live', { exact: true })).toBeVisible({ timeout: 30_000 })
  await expect.poll(async () => Number((await diagnostics(page)).gauges.customShapeIndexSize ?? 0), { timeout: 30_000 }).toBeGreaterThanOrEqual(600)
  const visible = Number((await diagnostics(page)).gauges.customShapeVisible ?? 0)
  expect(visible).toBeLessThan(40)
  await expect(page.locator('.canvas-custom-shape')).toHaveCount(1)
})

test('320px, short landscape, keyboard skip navigation and forced colors remain usable', async ({ browser, browserName }) => {
  test.skip(browserName !== 'chromium', 'Accessibility/responsive contract needs one browser execution.')

  const narrow = await browser.newContext({ viewport: { width: 320, height: 568 } })
  const narrowPage = await narrow.newPage()
  try {
    await narrowPage.goto('./')
    await expect(narrowPage.getByText('Live', { exact: true })).toBeVisible()
    const overflow = await narrowPage.evaluate(() => ({
      body: document.body.scrollWidth - document.documentElement.clientWidth,
      root: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }))
    expect(overflow.body).toBeLessThanOrEqual(1)
    expect(overflow.root).toBeLessThanOrEqual(1)

    await narrowPage.keyboard.press('Tab')
    await expect(narrowPage.getByRole('link', { name: 'Skip to canvas' })).toBeFocused()
    await narrowPage.keyboard.press('Enter')
    await expect(narrowPage.locator('#shared-canvas-workspace')).toBeFocused()

    await narrowPage.getByRole('button', { name: 'Canvas visuals' }).click()
    const visual = narrowPage.getByLabel('Canvas visuals menu')
    await expect(visual).toBeVisible()
    const visualBox = await visual.boundingBox()
    expect(visualBox).not.toBeNull()
    expect((visualBox?.x ?? -1) >= 0).toBe(true)
    expect((visualBox?.x ?? 0) + (visualBox?.width ?? 9999) <= 320.5).toBe(true)
  } finally {
    await narrow.close()
  }

  const landscape = await browser.newContext({ viewport: { width: 844, height: 390 } })
  const landscapePage = await landscape.newPage()
  try {
    await landscapePage.goto('./')
    await expect(landscapePage.getByText('Live', { exact: true })).toBeVisible()
    await landscapePage.getByRole('button', { name: 'Drawing tools' }).click()
    const panel = landscapePage.getByLabel('Drawing tools menu')
    const box = await panel.boundingBox()
    expect(box).not.toBeNull()
    expect((box?.y ?? -1) >= 0).toBe(true)
    expect((box?.y ?? 0) + (box?.height ?? 9999) <= 390.5).toBe(true)
  } finally {
    await landscape.close()
  }

  const forced = await browser.newContext({ viewport: { width: 900, height: 700 }, forcedColors: 'active' })
  const forcedPage = await forced.newPage()
  try {
    await forcedPage.goto('./')
    await expect(forcedPage.getByText('Live', { exact: true })).toBeVisible()
    expect(await forcedPage.evaluate(() => matchMedia('(forced-colors: active)').matches)).toBe(true)
    await forcedPage.keyboard.press('Tab')
    const outline = await forcedPage.getByRole('link', { name: 'Skip to canvas' }).evaluate(element => {
      const style = getComputedStyle(element)
      return { style: style.outlineStyle, width: style.outlineWidth }
    })
    expect(outline.style).not.toBe('none')
    expect(Number.parseFloat(outline.width)).toBeGreaterThanOrEqual(2)
  } finally {
    await forced.close()
  }
})

test('four live clients converge under a small collaboration burst', async ({ browser, browserName }) => {
  test.skip(browserName !== 'chromium', 'Phase 9 collaboration-load contract needs one browser execution.')
  test.setTimeout(120_000)
  const contexts = await Promise.all(Array.from({ length: 4 }, () => browser.newContext({ viewport: { width: 1100, height: 720 } })))
  const pages = await Promise.all(contexts.map(context => context.newPage()))
  try {
    await Promise.all(pages.map(page => page.goto('./?debug=1')))
    await Promise.all(pages.map(page => expect(page.getByText('Live', { exact: true })).toBeVisible({ timeout: 30_000 })))

    for (let index = 0; index < pages.length; index++) {
      const page = pages[index]
      await page.getByTitle(/^Rectangle\b/i).click()
      const x = 240 + index * 55
      const y = 220 + index * 35
      await dragOnCanvas(page, [x, y], [x + 100, y + 70], 4)
    }

    await expect.poll(async () => (await activeRows()).filter(row => row.element?.type === 'rectangle').length, { timeout: 30_000 }).toBe(4)

    for (const page of pages) {
      await page.bringToFront()
      await page.evaluate(() => window.dispatchEvent(new Event('focus')))
      await expect.poll(async () => (await readScene(page)).filter(element => element.type === 'rectangle').length, { timeout: 30_000 }).toBe(4)
      await expect(page.getByText('Live', { exact: true })).toBeVisible()
    }
  } finally {
    await Promise.allSettled(contexts.map(context => context.close()))
  }
})
