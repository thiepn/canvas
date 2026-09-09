import { test, expect, type Page } from '@playwright/test'

async function readZoomPercent(page: Page): Promise<number> {
  const text = await page.locator('.zoom-actions').innerText()
  const match = text.match(/(\d+(?:\.\d+)?)%/)
  if (!match) throw new Error(`Could not read Excalidraw zoom from: ${JSON.stringify(text)}`)
  return Number(match[1])
}

test('plain vertical wheel zooms instead of vertically panning the canvas', async ({ page }) => {
  await page.goto('./')
  await expect(page.getByText('Live', { exact: true })).toBeVisible()

  await page.locator('.reset-zoom-button').click()
  await expect.poll(() => readZoomPercent(page)).toBe(100)

  const canvas = page.locator('canvas.excalidraw__canvas.interactive')
  await expect(canvas).toBeVisible()
  const box = await canvas.boundingBox()
  if (!box) throw new Error('Interactive Excalidraw canvas has no bounding box.')
  await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.55)

  const documentScrollBefore = await page.evaluate(() => ({ x: scrollX, y: scrollY }))
  await page.mouse.wheel(0, -120)
  await expect.poll(() => readZoomPercent(page)).toBeGreaterThan(100)
  expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual(documentScrollBefore)

  const zoomedIn = await readZoomPercent(page)
  await page.mouse.wheel(0, 240)
  await expect.poll(() => readZoomPercent(page)).toBeLessThan(zoomedIn)
})
