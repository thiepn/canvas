import { test, expect } from '@playwright/test'
test('built /Canvas/ assets load, real input persists, and no test bridge is shipped', async ({ page, request }) => {
  const errors: string[] = [], failedAssets: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('response', response => { if (response.url().startsWith('http://127.0.0.1:4173/') && response.status() >= 400) failedAssets.push(response.url()) })
  await page.goto('/Canvas/')
  await expect(page.getByRole('status').filter({ hasText: /^Live$/ })).toBeVisible()
  expect(await page.evaluate(() => '__CANVAS_TEST__' in window)).toBe(false)
  await page.getByRole('toolbar', { name: 'Drawing tools' }).getByRole('button', { name: 'Text', exact: true }).click()
  await page.mouse.click(500, 300)
  const text = `Production-smoke-${Date.now()}`
  await page.keyboard.type(text); await page.keyboard.press('Escape')
  await expect.poll(async () => {
    const response = await request.get('http://127.0.0.1:8787/api/snapshot', { headers: { Origin: 'http://127.0.0.1:4173' } })
    return response.text()
  }).toContain(text)
  const manifest = await request.get('/Canvas/manifest.webmanifest')
  expect((await manifest.json()).name).toBe('Canvas')
  await page.reload()
  await expect(page.getByRole('status').filter({ hasText: /^Live$/ })).toBeVisible()
  await page.screenshot({ path: 'artifacts/Canvas-desktop.png' })
  expect(failedAssets).toEqual([])
  expect(errors).toEqual([])
})
