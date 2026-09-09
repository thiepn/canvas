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

async function renderGestureFrame(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    let firstFrame = 0
    let secondFrame = 0
    const timeout = setTimeout(() => {
      cancelAnimationFrame(firstFrame)
      cancelAnimationFrame(secondFrame)
      reject(new Error('The drawing page did not render the pointer gesture.'))
    }, 5000)
    firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => { clearTimeout(timeout); resolve() })
    })
  }))
}

/** Use real, frame-paced pointer input; assert exact geometry in the caller. */
export async function dragOnCanvas(page: Page, from: [number, number], to: [number, number], steps = 8) {
  if (!Number.isInteger(steps) || steps < 1 || steps > 100) throw new Error('Expected 1–100 pointer steps.')
  // Peer contexts may be background tabs. Foreground the page before relying
  // on animation frames; never change the scene through an internal test API.
  await page.bringToFront()
  const box = await page.locator('.live-excalidraw').boundingBox()
  if (!box) throw new Error('Live Excalidraw surface has no bounding box.')
  for (const [x, y] of [from, to]) {
    await expect.poll(() => page.evaluate(([px, py]) => document.elementFromPoint(px, py)?.tagName, [box.x + x, box.y + y]), {
      message: `Pointer target ${x},${y} must be on the drawing canvas, not a toolbar or properties panel.`,
    }).toBe('CANVAS')
  }
  await page.mouse.move(box.x + from[0], box.y + from[1])
  await page.mouse.down()
  try {
    await renderGestureFrame(page)
    // A burst of eight moves can finish before Excalidraw handles its next
    // render. Let each real move reach the editor before sending mouse-up.
    for (let step = 1; step <= steps; step++) {
      await page.mouse.move(
        box.x + from[0] + (to[0] - from[0]) * step / steps,
        box.y + from[1] + (to[1] - from[1]) * step / steps,
      )
      await renderGestureFrame(page)
    }
  } finally {
    await page.mouse.up()
  }
  await renderGestureFrame(page)
}
