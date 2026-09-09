import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { chromium, expect, request } from '@playwright/test'

const url = new URL(process.env.CANVAS_DEPLOYED_URL || '')
if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Expected a public HTTPS deployment URL.')
url.searchParams.set('release', process.env.GITHUB_SHA || 'verified')
const html = await readFile('dist/index.html', 'utf8')
const expectedAsset = html.match(/<script\b[^>]*\bsrc="([^"]+)"/)?.[1]
if (!expectedAsset) throw new Error('Built index.html has no entry module.')
await mkdir('artifacts/deployed', { recursive: true })

const http = await request.newContext()
try {
  await expect.poll(async () => {
    const response = await http.get(url.href)
    return response.ok() && (await response.text()).includes(expectedAsset)
  }, { timeout: 120_000, intervals: [1000, 2000, 5000], message: 'Pages must serve this release, not an older cached bundle.' }).toBe(true)
} finally {
  await http.dispose()
}

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1366, height: 768 } })
const page = await context.newPage()
const pageErrors = []
const failedAssets = []
page.on('pageerror', error => pageErrors.push(error.message))
page.on('response', response => {
  if (response.url().startsWith(url.origin) && response.status() >= 400) failedAssets.push(response.url())
})
try {
  await page.goto(url.href, { waitUntil: 'domcontentloaded' })
  await expect(page.locator('[data-canvas-engine="excalidraw-supabase"]')).toBeVisible({ timeout: 45_000 })
  await expect(page.getByText('Live', { exact: true })).toBeVisible({ timeout: 45_000 })
  await expect(page.getByRole('button', { name: 'Frame tool' })).toBeEnabled()
  expect(await page.locator('script[type="module"][src]').first().getAttribute('src')).toBe(expectedAsset)
  expect(await page.evaluate(() => '__CANVAS_TEST__' in window)).toBe(false)
  await page.screenshot({ path: 'artifacts/deployed/desktop.png' })

  // No drawing, deletion, restore, or other persistent mutation of the public canvas.
  await context.setOffline(true)
  await expect(page.getByText('Offline', { exact: true })).toBeVisible()
  await context.setOffline(false)
  await expect(page.getByText('Live', { exact: true })).toBeVisible({ timeout: 45_000 })

  await page.setViewportSize({ width: 320, height: 568 })
  await page.getByRole('button', { name: 'Canvas menu and presence' }).click()
  const settings = page.getByLabel('Canvas settings')
  await expect(settings).toBeVisible()
  await expect(settings.getByLabel('Display name')).toBeVisible()
  await expect(settings.getByRole('button', { name: 'Frame tool' })).toBeEnabled()
  const layout = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
    scrollWidth: document.scrollingElement?.scrollWidth ?? 0,
    scrollHeight: document.scrollingElement?.scrollHeight ?? 0,
  }))
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width + 1)
  expect(layout.scrollHeight).toBeLessThanOrEqual(layout.height + 1)
  await page.screenshot({ path: 'artifacts/deployed/mobile-menu.png' })
  expect(pageErrors).toEqual([])
  expect(failedAssets).toEqual([])
  const evidence = { commit: process.env.GITHUB_SHA, url: url.origin + url.pathname, expectedAsset, checkedAt: new Date().toISOString(), checks: ['exact-published-bundle', 'real-supabase-live', 'no-test-bridge', 'offline-reconnect', '320px-menu', 'no-page-errors', 'no-missing-assets'], layout }
  await writeFile('artifacts/deployed/verification.json', JSON.stringify(evidence, null, 2))
  console.log(JSON.stringify(evidence))
} finally {
  await page.screenshot({ path: 'artifacts/deployed/final-state.png' }).catch(() => {})
  await context.close()
  await browser.close()
}
