import { expect, test, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { DEFAULT_SUPABASE_PUBLISHABLE_KEY, DEFAULT_SUPABASE_URL } from '../../app/config/public-config.ts'
import { dragOnCanvas, readScene } from './scene-helpers.ts'
import { retryTransientSupabaseTestOperation } from './supabase-test-helpers.ts'

const TABLE = 'canvas_ci_elements'
const supabase = createClient(DEFAULT_SUPABASE_URL, DEFAULT_SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
})

async function cleanWorld() {
  const { error } = await retryTransientSupabaseTestOperation(() => supabase.from(TABLE).delete().neq('id', ''))
  if (error) throw error
}

async function rows(): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await retryTransientSupabaseTestOperation(() => supabase.from(TABLE).select('element,is_deleted'))
  if (error) throw error
  return (data ?? []).filter(row => !row.is_deleted).map(row => row.element as Record<string, unknown>)
}

async function drawRectangle(page: Page, from: [number, number], to: [number, number]) {
  await page.getByTitle(/^Rectangle\b/i).click()
  await dragOnCanvas(page, from, to)
}

async function canvasBox(page: Page) {
  const box = await page.locator('.live-excalidraw').boundingBox()
  if (!box) throw new Error('Canvas has no bounding box.')
  return box
}

async function selectPoints(page: Page, points: Array<[number, number]>) {
  const box = await canvasBox(page)
  await page.keyboard.press('v')
  for (let index = 0; index < points.length; index++) {
    const [x, y] = points[index]
    if (index) await page.keyboard.down('Shift')
    await page.mouse.click(box.x + x, box.y + y)
    if (index) await page.keyboard.up('Shift')
  }
  await expect(page.getByRole('toolbar', { name: 'Selection tools' })).toBeVisible()
}

test.beforeEach(cleanWorld)
test.afterEach(cleanWorld)

test('group, transform, duplicate, lock, unlock, snap and select-same persist through the live path', async ({ page }) => {
  await page.goto('./')
  await expect(page.getByText('Live', { exact: true })).toBeVisible()

  await drawRectangle(page, [300, 170], [370, 225])
  await drawRectangle(page, [470, 180], [540, 235])
  await expect.poll(async () => (await rows()).length).toBe(2)

  await selectPoints(page, [[335, 198], [505, 208]])
  const toolbar = page.getByRole('toolbar', { name: 'Selection tools' })
  await expect(toolbar.locator('.selection-count')).toHaveText('2')
  await toolbar.getByRole('button', { name: 'Group' }).click()

  let groupId = ''
  await expect.poll(async () => {
    const elements = await rows()
    const groups = elements.map(element => (element.groupIds as string[] | undefined)?.at(-1) ?? '')
    groupId = groups[0] ?? ''
    return Boolean(groupId) && groups.every(value => value === groupId)
  }).toBe(true)

  await toolbar.getByText('Transform', { exact: true }).click()
  const xInput = toolbar.getByLabel('Selection X')
  await xInput.fill('200')
  await xInput.press('Enter')
  await expect.poll(async () => Math.round(Math.min(...(await rows()).map(element => Number(element.x))))).toBe(200)

  const beforeResize = await rows()
  const beforeWidth = Math.max(...beforeResize.map(element => Number(element.x) + Number(element.width))) - Math.min(...beforeResize.map(element => Number(element.x)))
  const beforeHeight = Math.max(...beforeResize.map(element => Number(element.y) + Number(element.height))) - Math.min(...beforeResize.map(element => Number(element.y)))
  const widthInput = toolbar.getByLabel('Selection width')
  await widthInput.fill(String(beforeWidth * 1.5))
  await widthInput.press('Enter')
  await expect.poll(async () => {
    const resized = await rows()
    const nextWidth = Math.max(...resized.map(element => Number(element.x) + Number(element.width))) - Math.min(...resized.map(element => Number(element.x)))
    const nextHeight = Math.max(...resized.map(element => Number(element.y) + Number(element.height))) - Math.min(...resized.map(element => Number(element.y)))
    return [Math.round(nextWidth), Math.round(nextHeight)]
  }).toEqual([Math.round(beforeWidth * 1.5), Math.round(beforeHeight * 1.5)])

  await toolbar.getByRole('button', { name: 'Duplicate' }).click()
  await expect.poll(async () => (await rows()).length).toBe(4)
  await expect(toolbar.locator('.selection-count')).toHaveText('2')

  const snap = toolbar.getByRole('button', { name: 'Snap' })
  await expect(snap).toHaveAttribute('aria-pressed', 'true')
  await snap.click()
  await expect(snap).toHaveAttribute('aria-pressed', 'false')
  await snap.click()
  await expect(snap).toHaveAttribute('aria-pressed', 'true')

  const grid = toolbar.getByRole('button', { name: 'Grid' })
  await expect(grid).toHaveAttribute('aria-pressed', 'false')
  await grid.click()
  await expect(grid).toHaveAttribute('aria-pressed', 'true')
  await grid.click()
  await expect(grid).toHaveAttribute('aria-pressed', 'false')

  await toolbar.getByRole('button', { name: 'Lock' }).click()
  await expect.poll(async () => (await rows()).filter(element => element.locked === true).length).toBe(2)

  const menu = page.getByRole('button', { name: 'Canvas menu and presence' })
  await menu.click()
  const settings = page.getByLabel('Canvas settings')
  const unlock = settings.getByRole('button', { name: 'Unlock all locked objects' })
  await expect(unlock).toBeEnabled()
  await unlock.click()
  await expect.poll(async () => (await rows()).some(element => element.locked === true)).toBe(false)

  await expect(toolbar).toBeVisible()
  await toolbar.getByText('More', { exact: true }).click()
  await toolbar.getByRole('button', { name: 'Type' }).click()
  await expect(toolbar.locator('.selection-count')).toHaveText('4')
})

test('alignment, distribution and z-order survive reload', async ({ page }) => {
  await page.goto('./')
  await expect(page.getByText('Live', { exact: true })).toBeVisible()

  await drawRectangle(page, [300, 140], [360, 190])
  await drawRectangle(page, [500, 250], [560, 300])
  await drawRectangle(page, [760, 390], [820, 440])
  await expect.poll(async () => (await rows()).length).toBe(3)

  await selectPoints(page, [[330, 165], [530, 275], [790, 415]])
  const toolbar = page.getByRole('toolbar', { name: 'Selection tools' })
  await toolbar.getByText('Align', { exact: true }).click()
  await toolbar.getByRole('button', { name: 'Left' }).click()
  await expect.poll(async () => new Set((await rows()).map(element => Math.round(Number(element.x)))).size).toBe(1)

  await toolbar.getByText('Align', { exact: true }).click()
  await toolbar.getByRole('button', { name: 'Distribute V' }).click()
  await expect.poll(async () => {
    const ys = (await rows()).map(element => Number(element.y)).sort((a, b) => a - b)
    return Math.round((ys[1] - ys[0]) * 10) === Math.round((ys[2] - ys[1]) * 10)
  }).toBe(true)

  const before = (await rows()).sort((a, b) => Number(a.y) - Number(b.y))
  const targetId = String(before[0].id)
  const alignedX = Number(before[0].x)

  await page.keyboard.press('Escape')
  const box = await canvasBox(page)
  await page.keyboard.press('v')
  await page.mouse.click(box.x + alignedX + 30, box.y + Number(before[0].y) + 25)
  await expect(toolbar.locator('.selection-count')).toHaveText('1')
  await toolbar.getByText('Arrange', { exact: true }).click()
  await toolbar.getByRole('button', { name: 'Front' }).click()

  await expect.poll(async () => {
    const scene = await readScene(page)
    return scene.at(-1)?.id
  }).toBe(targetId)

  await page.reload()
  await expect(page.getByText('Live', { exact: true })).toBeVisible()
  const restored = await readScene(page)
  expect(restored.at(-1)?.id).toBe(targetId)
})

test('native Shift constraint and Alt-drag duplication remain available', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Pointer modifier interaction contract needs one browser execution.')
  await page.goto('./')
  await expect(page.getByText('Live', { exact: true })).toBeVisible()

  await page.getByTitle(/^Rectangle\b/i).click()
  const box = await canvasBox(page)
  await page.keyboard.down('Shift')
  await page.mouse.move(box.x + 320, box.y + 180)
  await page.mouse.down()
  await page.mouse.move(box.x + 440, box.y + 250, { steps: 8 })
  await page.mouse.up()
  await page.keyboard.up('Shift')
  await expect.poll(async () => (await rows()).length).toBe(1)
  const [square] = await rows()
  expect(Math.abs(Number(square.width) - Number(square.height))).toBeLessThan(2)

  await selectPoints(page, [[Number(square.x) + Number(square.width) / 2, Number(square.y) + Number(square.height) / 2]])
  const beforeX = Number(square.x)
  const beforeY = Number(square.y)
  await page.keyboard.down('Alt')
  await page.mouse.move(box.x + beforeX + Number(square.width) / 2, box.y + beforeY + Number(square.height) / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + beforeX + Number(square.width) / 2 + 80, box.y + beforeY + Number(square.height) / 2 + 40, { steps: 8 })
  await page.mouse.up()
  await page.keyboard.up('Alt')

  await expect.poll(async () => (await rows()).length).toBe(2)
  const duplicates = await rows()
  expect(new Set(duplicates.map(element => String(element.id))).size).toBe(2)
})

test('native keyboard nudging remains precise with the Phase 2 overlay', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Keyboard interaction contract needs one browser execution.')
  await page.goto('./')
  await expect(page.getByText('Live', { exact: true })).toBeVisible()
  await drawRectangle(page, [340, 210], [410, 270])
  await expect.poll(async () => (await rows()).length).toBe(1)
  const [created] = await rows()
  const originalX = Number(created.x)
  const originalY = Number(created.y)

  await selectPoints(page, [[375, 240]])
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Shift+ArrowDown')

  await expect.poll(async () => {
    const [element] = await rows()
    return [Number(element.x) - originalX, Number(element.y) - originalY]
  }).toEqual([1, 10])
})
