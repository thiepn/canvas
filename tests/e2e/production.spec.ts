import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { DEFAULT_SUPABASE_PUBLISHABLE_KEY, DEFAULT_SUPABASE_URL } from '../../app/config/public-config.ts'

const TABLE = 'canvas_ci_elements'
const supabase = createClient(DEFAULT_SUPABASE_URL, DEFAULT_SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
})

async function cleanTestWorld() {
  const { error } = await supabase.from(TABLE).delete().neq('id', '')
  if (error) throw error
}

async function latestActiveElement() {
  const { data, error } = await supabase
    .from(TABLE)
    .select('id,element,is_deleted,updated_at')
    .eq('is_deleted', false)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data
}

test.beforeEach(cleanTestWorld)
test.afterEach(cleanTestWorld)

test('built /canvas/ loads the shipped engine and persists a real vector through Supabase', async ({ page, request }) => {
  const errors: string[] = []
  const failedAssets: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('response', response => {
    if (response.url().startsWith('http://127.0.0.1:4173/') && response.status() >= 400) failedAssets.push(response.url())
  })

  await page.goto('/canvas/')
  await expect(page.locator('[data-canvas-engine="excalidraw-supabase"]')).toBeVisible()
  await expect(page.getByText('Live', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => '__CANVAS_TEST__' in window)).toBe(false)

  const surface = page.locator('.live-excalidraw')
  const box = await surface.boundingBox()
  if (!box) throw new Error('Production Excalidraw surface has no bounding box.')

  const rectangleTool = page.getByRole('radio', { name: /^Rectangle\b/i })
  await page.getByTitle(/^Rectangle\b/i).click()
  await expect(rectangleTool).toBeChecked()
  await page.mouse.move(box.x + 320, box.y + 260)
  await page.mouse.down()
  await page.mouse.move(box.x + 460, box.y + 350, { steps: 8 })
  await page.mouse.up()

  let persistedId = ''
  await expect.poll(async () => {
    const row = await latestActiveElement()
    persistedId = row?.id ?? ''
    return row?.element?.type ?? ''
  }).toBe('rectangle')
  expect(persistedId).not.toBe('')

  const manifest = await request.get('/canvas/manifest.webmanifest')
  expect(manifest.ok()).toBe(true)
  expect((await manifest.json()).name).toBe('Canvas')

  await page.reload()
  await expect(page.locator('[data-canvas-engine="excalidraw-supabase"]')).toBeVisible()
  await expect(page.getByText('Live', { exact: true })).toBeVisible()
  await expect.poll(async () => (await latestActiveElement())?.id ?? '').toBe(persistedId)

  await page.screenshot({ path: 'artifacts/Canvas-desktop.png' })
  expect(failedAssets).toEqual([])
  expect(errors).toEqual([])
})

test('built PWA restores its static shell offline without caching shared Supabase state', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'Service-worker lifecycle certification needs one Chromium execution.')

  await page.goto('/canvas/')
  await expect(page.locator('[data-canvas-engine="excalidraw-supabase"]')).toBeVisible()
  await expect(page.getByText('Live', { exact: true })).toBeVisible()

  const registration = await page.evaluate(async () => {
    const ready = await navigator.serviceWorker.ready
    return { scope: ready.scope, active: ready.active?.state ?? null }
  })
  expect(new URL(registration.scope).pathname).toBe('/canvas/')
  expect(registration.active).toBe('activated')

  // Reload once under the active worker so hashed JS/CSS/font/image responses
  // are observed and added to the build-scoped static cache.
  await page.reload()
  await expect(page.locator('[data-canvas-engine="excalidraw-supabase"]')).toBeVisible()
  await expect(page.getByText('Live', { exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)

  const cached = await page.evaluate(async () => {
    const names = await caches.keys()
    const urls: string[] = []
    for (const name of names) {
      const cache = await caches.open(name)
      for (const request of await cache.keys()) urls.push(request.url)
    }
    return { names, urls }
  })
  expect(cached.names.some(name => name.startsWith('canvas-shell-'))).toBe(true)
  expect(cached.urls.some(url => url.includes('supabase.co'))).toBe(false)
  expect(cached.urls.some(url => new URL(url).pathname === '/canvas/')).toBe(true)

  await context.setOffline(true)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.locator('[data-canvas-engine="excalidraw-supabase"]')).toBeVisible()
  await expect(page.getByText('Offline', { exact: true })).toBeVisible()

  await context.setOffline(false)
  await expect(page.getByText('Live', { exact: true })).toBeVisible({ timeout: 45_000 })
})

test('production presents one simple native-style editing surface', async ({ page }) => {
  await page.goto('/canvas/')
  await expect(page.locator('[data-canvas-engine="excalidraw-supabase"]')).toBeVisible()
  await expect(page.getByText('Live', { exact: true })).toBeVisible()

  await expect(page.locator('[data-testid="toolbar-text"]')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Canvas visuals' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Drawing tools' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Shape library' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Rich text' })).toHaveCount(0)
  await expect(page.getByRole('toolbar', { name: 'Canvas navigation' })).toHaveCount(0)
  await expect(page.locator('.selection-toolbar')).toHaveCount(0)
  await expect(page.locator('.canvas-app')).toHaveAttribute('data-canvas-grid', 'none')

  // Standard tool shortcuts belong to Excalidraw again; T must select the
  // visible native text tool instead of Canvas's retired parallel text mode.
  await page.keyboard.press('t')
  await expect(page.locator('[data-testid="toolbar-text"]')).toHaveAttribute('aria-checked', 'true')

  await page.getByRole('button', { name: 'Canvas menu and presence' }).click()
  const settings = page.getByLabel('Canvas settings')
  await expect(settings.getByLabel('Display name')).toBeVisible()
  await expect(settings.getByLabel('Appearance')).toBeVisible()
  await expect(settings.getByText('Collaboration', { exact: true })).toBeVisible()
  await expect(settings.getByText('More', { exact: true })).toBeVisible()
})

