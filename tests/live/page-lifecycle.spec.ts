import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { DEFAULT_SUPABASE_PUBLISHABLE_KEY, DEFAULT_SUPABASE_URL } from '../../app/config/public-config.ts'
import { dragOnCanvas, readScene } from './scene-helpers.ts'

const TABLE = 'canvas_ci_elements'
const supabase = createClient(DEFAULT_SUPABASE_URL, DEFAULT_SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
})

async function cleanTestWorld() {
  const { error } = await supabase.from(TABLE).delete().neq('id', '')
  if (error) throw error
}

test.beforeEach(cleanTestWorld)
test.afterEach(cleanTestWorld)

test('pagehide stops recovery fetches and pageshow saves the interrupted gesture', async ({ page }) => {
  await page.goto('./')
  await expect(page.getByText('Live', { exact: true })).toBeVisible()

  let releaseWrites: () => void = () => {}
  const release = new Promise<void>(resolve => { releaseWrites = resolve })
  let interruptWrites = true
  let interceptedWrites = 0
  let abortedWrites = 0
  let suspended = false
  const readsWhileSuspended: string[] = []
  const postResumeErrors: string[] = []
  let resumed = false
  page.on('request', request => {
    if (suspended && request.method() === 'GET' && request.url().includes(`/rest/v1/${TABLE}`)) readsWhileSuspended.push(request.url())
  })
  page.on('pageerror', error => { if (resumed) postResumeErrors.push(error.message) })
  await page.route(`**/rest/v1/${TABLE}**`, async route => {
    if (interruptWrites && route.request().method() === 'POST') {
      interceptedWrites++
      await release
      await route.abort('failed')
      abortedWrites++
      return
    }
    await route.continue()
  })

  try {
    await page.getByTitle(/^Rectangle\b/i).click()
    await expect(page.getByRole('radio', { name: /^Rectangle\b/i })).toBeChecked()
    await dragOnCanvas(page, [300, 250], [430, 330])
    await expect.poll(() => interceptedWrites).toBeGreaterThan(0)

    // The fault is an interrupted SAVE of a finished local gesture. A first
    // intercepted POST may contain only an intermediate pointer position.
    // Observe the actual client model before suspending it, without a test API.
    let expectedId = ''
    let expectedVersion = 0
    await expect.poll(async () => {
      const element = (await readScene(page)).find(value => value.type === 'rectangle' && value.width === 130 && value.height === 80)
      expectedId = element ? String(element.id) : ''
      expectedVersion = element ? Number(element.version) : 0
      return Boolean(element)
    }, { message: 'The complete 130 by 80 rectangle must exist locally before its save is interrupted.' }).toBe(true)

    suspended = true
    // Explicit lifecycle fault injection; this does not claim real BFCache
    // eligibility or stand in for physical Safari/stylus certification.
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })))
    await expect(page.getByRole('button', { name: 'Frame tool' })).toBeDisabled()
    releaseWrites()
    await expect.poll(() => abortedWrites).toBe(interceptedWrites)
    // Bounded absence check: cover the application's 1200ms save-retry interval.
    await page.waitForTimeout(1500)
    expect(readsWhileSuspended).toEqual([])

    interruptWrites = false
    suspended = false
    resumed = true
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })))
    await expect(page.getByText('Live', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Frame tool' })).toBeEnabled()
    await expect.poll(async () => {
      const { data, error } = await supabase.from(TABLE).select('id,version,element').eq('id', expectedId).eq('is_deleted', false)
      if (error) throw error
      return (data ?? []).some(row => row.version >= expectedVersion && row.element?.type === 'rectangle' && row.element.width === 130 && row.element.height === 80)
    }).toBe(true)
    const restored = (await readScene(page)).find(element => element.id === expectedId)
    expect(restored).toMatchObject({ type: 'rectangle', width: 130, height: 80 })
    expect(Number(restored?.version)).toBeGreaterThanOrEqual(expectedVersion)
    expect(postResumeErrors).toEqual([])
  } finally {
    interruptWrites = false
    releaseWrites()
    await page.unrouteAll({ behavior: 'wait' })
  }
})
