import { readFile } from 'node:fs/promises'
import { expect, type Page } from '@playwright/test'

/** Read the actual client scene through the public backup action, not a test bridge. */
export async function readScene(page: Page): Promise<Array<Record<string, unknown>>> {
  const settings = page.getByLabel('Canvas settings')
  if (!(await settings.isVisible())) await page.getByRole('button', { name: 'Canvas menu and presence' }).click()
  await expect(settings).toBeVisible()
  try {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      settings.getByRole('button', { name: 'Export JSON backup' }).click(),
    ])
    const path = await download.path()
    if (!path) throw new Error('Canvas backup download has no local path.')
    const parsed = JSON.parse(await readFile(path, 'utf8')) as { elements?: Array<Record<string, unknown>> }
    return parsed.elements ?? []
  } finally {
    await page.keyboard.press('Escape')
    await expect(settings).toBeHidden()
  }
}

export async function exportElement(page: Page, id: string): Promise<Record<string, unknown> | null> {
  return (await readScene(page)).find(element => element.id === id) ?? null
}

/** Fail at the pointer target, rather than timing out later on a database assertion. */
export async function dragOnCanvas(page: Page, from: [number, number], to: [number, number], steps = 8) {
  const box = await page.locator('.live-excalidraw').boundingBox()
  if (!box) throw new Error('Live Excalidraw surface has no bounding box.')
  for (const [x, y] of [from, to]) {
    await expect.poll(() => page.evaluate(([px, py]) => document.elementFromPoint(px, py)?.tagName, [box.x + x, box.y + y]), {
      message: `Pointer target ${x},${y} must be on the drawing canvas, not a toolbar or properties panel.`,
    }).toBe('CANVAS')
  }
  await page.mouse.move(box.x + from[0], box.y + from[1])
  await page.mouse.down()
  await page.mouse.move(box.x + to[0], box.y + to[1], { steps })
  await page.mouse.up()
}
