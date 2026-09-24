import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { DEFAULT_SUPABASE_PUBLISHABLE_KEY, DEFAULT_SUPABASE_URL } from '../../app/config/public-config.ts'
import { dragOnCanvas } from './scene-helpers.ts'
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
  const { data, error } = await retryTransientSupabaseTestOperation(() => supabase.from(TABLE).select('element,is_deleted'))
  if (error) throw error
  return (data ?? []).filter(row => !row.is_deleted).map(row => row.element as Record<string, unknown>)
}

async function openPeer(browser: Browser, page: Page): Promise<{ context: BrowserContext; page: Page }> {
  const baseURL = new URL('.', page.url()).href
  const context = await browser.newContext({ baseURL })
  const peer = await context.newPage()
  await peer.goto('./')
  await expect(peer.getByText('Live', { exact: true })).toBeVisible()
  return { context, page: peer }
}

async function openCanvasSettings(page: Page) {
  const settings = page.getByLabel('Canvas settings')
  if (!(await settings.isVisible())) await page.getByRole('button', { name: 'Canvas menu and presence' }).click()
  await expect(settings).toBeVisible()
  return settings
}

test.beforeEach(cleanWorld)
test.afterEach(cleanWorld)

test('Collaboration V2 exposes peer actions, follow mode, reactions and attention pings', async ({ page, browser, browserName }) => {
  test.skip(browserName !== 'chromium', 'Realtime multi-client collaboration contract needs one browser execution.')
  await page.goto('./')
  await expect(page.getByText('Live', { exact: true })).toBeVisible()
  const peer = await openPeer(browser, page)

  try {
    const settings = await openCanvasSettings(page)
    const collaboration = settings.getByLabel('Collaboration controls')
    await expect(collaboration).toBeVisible()
    await expect(collaboration.getByRole('button', { name: 'Jump' })).toHaveCount(1)
    await expect(collaboration.getByRole('button', { name: 'Follow' })).toHaveCount(1)
    await expect(collaboration.getByRole('button', { name: 'Ping' })).toHaveCount(1)

    await collaboration.getByRole('button', { name: 'Follow' }).click()
    await page.keyboard.press('Escape')
    await expect(page.locator('.collaboration-follow-banner')).toContainText('Following')

    const peerSettings = await openCanvasSettings(peer.page)
    const peerCollaboration = peerSettings.getByLabel('Collaboration controls')
    await peerCollaboration.getByRole('button', { name: 'React 🎉' }).click()
    await peer.page.keyboard.press('Escape')
    await expect(page.locator('.collaboration-effect--reaction')).toContainText('🎉')

    const settingsAgain = await openCanvasSettings(page)
    await settingsAgain.getByLabel('Collaboration controls').getByRole('button', { name: 'Ping' }).click()
    await page.keyboard.press('Escape')
    await expect(peer.page.getByText(/wants your attention\./)).toBeVisible()

    await page.locator('.collaboration-follow-banner').getByRole('button', { name: 'Stop' }).click()
    await expect(page.locator('.collaboration-follow-banner')).toBeHidden()
  } finally {
    await peer.context.close()
  }
})

test('cursor visibility controls persist locally without changing shared canvas data', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Device-local collaboration preferences need one browser execution.')
  await page.goto('./')
  await expect(page.getByText('Live', { exact: true })).toBeVisible()
  let settings = await openCanvasSettings(page)
  const collaboration = settings.getByLabel('Collaboration controls')
  const share = collaboration.getByLabel('Share my cursor')
  const show = collaboration.getByLabel('Show collaborator cursors')
  await expect(share).toBeChecked()
  await expect(show).toBeChecked()
  await share.uncheck()
  await show.uncheck()
  await page.keyboard.press('Escape')

  expect(await activeRows()).toEqual([])
  await page.reload()
  await expect(page.getByText('Live', { exact: true })).toBeVisible()
  settings = await openCanvasSettings(page)
  await expect(settings.getByLabel('Collaboration controls').getByLabel('Share my cursor')).not.toBeChecked()
  await expect(settings.getByLabel('Collaboration controls').getByLabel('Show collaborator cursors')).not.toBeChecked()
  expect(await activeRows()).toEqual([])
})

test('own-action undo tombstones a creation only while its exact shared version is still current', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Own-action undo persistence contract needs one browser execution.')
  await page.goto('./')
  await expect(page.getByText('Live', { exact: true })).toBeVisible()
  await page.getByTitle(/^Rectangle\b/i).click()
  await dragOnCanvas(page, [330, 210], [450, 300])
  await expect.poll(async () => (await activeRows()).filter(element => element.type === 'rectangle').length).toBe(1)

  const settings = await openCanvasSettings(page)
  const undo = settings.getByLabel('Collaboration controls').getByRole('button', { name: 'Undo my last action' })
  await expect(undo).toBeEnabled()
  await undo.click()
  await page.keyboard.press('Escape')

  await expect.poll(async () => (await activeRows()).filter(element => element.type === 'rectangle').length).toBe(0)
})
