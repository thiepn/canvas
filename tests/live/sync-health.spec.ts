import { expect, test } from '@playwright/test'
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

async function rowCount() {
  const { data, error } = await supabase.from(TABLE).select('id')
  if (error) throw error
  return data?.length ?? 0
}

test.beforeEach(cleanWorld)
test.afterEach(cleanWorld)

test('sync health distinguishes saved, offline, reconnecting and recovered states', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } })
  const page = await context.newPage()
  try {
    await page.goto('./?debug=1')
    await expect(page.locator('[data-sync-health="saved"]')).toBeVisible()
    await expect(page.getByRole('status', { name: /Saved\. All completed changes are saved/i })).toBeVisible()

    await context.setOffline(true)
    await expect(page.locator('[data-sync-health="offline"]')).toBeVisible()
    await expect(page.locator('.network-banner')).toContainText('Editing is paused')

    await context.setOffline(false)
    await expect.poll(async () => page.locator('[data-sync-health]').getAttribute('data-sync-health'), { timeout: 15_000 })
      .toBe('saved')
    await expect(page.locator('.network-banner')).toHaveCount(0)
  } finally {
    await context.close()
  }
})

test('a failed durable write stays visible and Retry now saves the queued change', async ({ browser, browserName }) => {
  test.skip(browserName !== 'chromium', 'One real transport-fault test is sufficient; state rendering is covered across all live browser projects.')
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } })
  const page = await context.newPage()
  const restPattern = `**/rest/v1/${TABLE}*`
  let blockWrites = true
  await page.route(restPattern, async route => {
    if (blockWrites && route.request().method() === 'POST') {
      await route.abort('failed')
      return
    }
    await route.continue()
  })
  try {
    await page.goto('./?debug=1')
    await expect(page.locator('[data-sync-health="saved"]')).toBeVisible()

    await page.getByTitle(/^Rectangle\b/i).click()
    await dragOnCanvas(page, [300, 250], [430, 330], 8)

    await expect(page.locator('[data-sync-health="retrying-save"]')).toBeVisible({ timeout: 10_000 })
    const warning = page.locator('.save-health-banner')
    await expect(warning).toContainText('still in this tab')
    await expect(warning.getByRole('button', { name: 'Retry now' })).toBeVisible()
    expect(await rowCount()).toBe(0)

    blockWrites = false
    await warning.getByRole('button', { name: 'Retry now' }).click()
    await expect.poll(rowCount, { timeout: 10_000 }).toBe(1)
    await expect(page.locator('[data-sync-health="saved"]')).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('.save-health-banner')).toHaveCount(0)
  } finally {
    await context.close()
  }
})
