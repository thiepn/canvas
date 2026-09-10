import { expect, test } from '@playwright/test'

test('diagnostics stay off by default and expose local sync metrics only when requested', async ({ browser }) => {
  const normalContext = await browser.newContext()
  const normalPage = await normalContext.newPage()
  try {
    await normalPage.goto('./')
    await expect(normalPage.getByText('Live', { exact: true })).toBeVisible()
    await expect(normalPage.getByLabel('Canvas diagnostics')).toHaveCount(0)
    expect(await normalPage.evaluate(() => '__CANVAS_DIAGNOSTICS__' in window)).toBe(false)
  } finally {
    await normalContext.close()
  }

  const debugContext = await browser.newContext()
  const debugPage = await debugContext.newPage()
  try {
    await debugPage.goto('./?debug=1')
    await expect(debugPage.getByText('Live', { exact: true })).toBeVisible()
    await expect(debugPage.getByLabel('Canvas diagnostics')).toBeVisible()
    await expect.poll(() => debugPage.evaluate(() => window.__CANVAS_DIAGNOSTICS__?.snapshot().samples.initialHydrationMs?.count ?? 0)).toBeGreaterThan(0)
    const snapshot = await debugPage.evaluate(() => window.__CANVAS_DIAGNOSTICS__?.snapshot())
    expect(snapshot?.enabled).toBe(true)
    expect(snapshot?.gauges.connectionState).toBe('Live')
    expect(snapshot?.samples.hydrationQueryMs?.count ?? 0).toBeGreaterThan(0)
    expect(JSON.stringify(snapshot)).not.toContain('element')
  } finally {
    await debugContext.close()
  }
})
