import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { chromium, expect, request } from '@playwright/test'
import { deploymentUrl, requireSecureResponse } from './deployment-url.mjs'

async function readZoomPercent(page) {
  const text = await page.locator('.zoom-actions').innerText()
  const match = text.match(/(\d+(?:\.\d+)?)%/)
  if (!match) throw new Error(`Could not read Excalidraw zoom from: ${JSON.stringify(text)}`)
  return Number(match[1])
}

const url = deploymentUrl(process.env.CANVAS_DEPLOYED_URL)
url.searchParams.set('release', process.env.GITHUB_SHA || 'verified')
const html = await readFile('dist/index.html', 'utf8')
const expectedAsset = html.match(/<script\b[^>]*\bsrc="([^"]+)"/)?.[1]
if (!expectedAsset) throw new Error('Built index.html has no entry module.')
await mkdir('artifacts/deployed', { recursive: true })

const http = await request.newContext({ ignoreHTTPSErrors: false })
try {
  await expect.poll(async () => {
    const response = await http.get(url.href, { timeout: 20_000 })
    requireSecureResponse(response.url())
    return response.ok() && (await response.text()).includes(expectedAsset)
  }, { timeout: 120_000, intervals: [1000, 2000, 5000], message: 'Pages must serve this release over HTTPS, not an older cached bundle.' }).toBe(true)
} finally {
  await http.dispose()
}

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, ignoreHTTPSErrors: false })
const page = await context.newPage()
const pageErrors = []
const failedAssets = []
page.on('pageerror', error => pageErrors.push(error.message))
page.on('response', response => {
  if (response.url().startsWith(url.origin) && response.status() >= 400) failedAssets.push(response.url())
})
try {
  await page.goto(url.href, { waitUntil: 'domcontentloaded' })
  requireSecureResponse(page.url())
  await expect(page.locator('[data-canvas-engine="excalidraw-supabase"]')).toBeVisible({ timeout: 45_000 })
  await expect(page.getByText('Live', { exact: true })).toBeVisible({ timeout: 45_000 })
  await expect(page.getByRole('button', { name: 'Frame tool' })).toBeEnabled()
  expect(await page.locator('script[type="module"][src]').first().getAttribute('src')).toBe(expectedAsset)
  expect(await page.evaluate(() => '__CANVAS_TEST__' in window)).toBe(false)

  // Normal vertical wheel is a Canvas zoom gesture, not Excalidraw's default pan.
  await page.locator('.reset-zoom-button').click()
  await expect.poll(() => readZoomPercent(page)).toBe(100)
  const interactiveCanvas = page.locator('canvas.excalidraw__canvas.interactive')
  const canvasBox = await interactiveCanvas.boundingBox()
  if (!canvasBox) throw new Error('Published interactive canvas has no bounding box.')
  await page.mouse.move(canvasBox.x + canvasBox.width * 0.65, canvasBox.y + canvasBox.height * 0.55)
  await page.mouse.wheel(0, -120)
  await expect.poll(() => readZoomPercent(page)).toBeGreaterThan(100)
  const zoomedIn = await readZoomPercent(page)
  await page.mouse.wheel(0, 240)
  await expect.poll(() => readZoomPercent(page)).toBeLessThan(zoomedIn)
  await page.locator('.reset-zoom-button').click()
  await expect.poll(() => readZoomPercent(page)).toBe(100)
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
  const evidence = { commit: process.env.GITHUB_SHA, reportedUrl: process.env.CANVAS_DEPLOYED_URL, url: url.origin + url.pathname, finalUrl: page.url(), expectedAsset, checkedAt: new Date().toISOString(), checks: ['https-with-valid-certificate', 'exact-published-bundle', 'real-supabase-live', 'wheel-zooms-canvas', 'no-test-bridge', 'offline-reconnect', '320px-menu', 'no-page-errors', 'no-missing-assets'], layout }
  await writeFile('artifacts/deployed/verification.json', JSON.stringify(evidence, null, 2))
  console.log(JSON.stringify(evidence))
} finally {
  await page.screenshot({ path: 'artifacts/deployed/final-state.png' }).catch(() => {})
  await context.close()
  await browser.close()
}
