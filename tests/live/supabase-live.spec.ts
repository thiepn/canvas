import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { DEFAULT_SUPABASE_PUBLISHABLE_KEY, DEFAULT_SUPABASE_URL } from '../../app/config/public-config.ts'

const TABLE = 'canvas_ci_elements'
const supabase = createClient(DEFAULT_SUPABASE_URL, DEFAULT_SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
})

async function cleanTestWorld() {
  const { error } = await supabase.from(TABLE).delete().neq('id', '')
  if (error) throw error
}

async function latestActiveId(): Promise<string> {
  const { data, error } = await supabase.from(TABLE).select('id,is_deleted,updated_at').eq('is_deleted', false).order('updated_at', { ascending: false }).limit(1)
  if (error) throw error
  return data?.[0]?.id ?? ''
}

async function isDeleted(id: string): Promise<boolean> {
  const { data, error } = await supabase.from(TABLE).select('is_deleted').eq('id', id).maybeSingle()
  if (error) throw error
  return data?.is_deleted === true
}

test.beforeEach(cleanTestWorld)
test.afterEach(cleanTestWorld)

test('two live clients persist and synchronize a real rectangle through Supabase', async ({ browser }) => {
  const contextA = await browser.newContext()
  const contextB = await browser.newContext()
  const pageA = await contextA.newPage()
  const pageB = await contextB.newPage()
  const pageErrors: string[] = []
  pageA.on('pageerror', error => pageErrors.push(`A: ${error.message}`))
  pageB.on('pageerror', error => pageErrors.push(`B: ${error.message}`))

  try {
    await test.step('connect both clients to the live Supabase canvas', async () => {
      await Promise.all([pageA.goto('./'), pageB.goto('./')])
      await expect(pageA.locator('[data-canvas-engine="excalidraw-supabase"]')).toBeVisible()
      await expect(pageB.locator('[data-canvas-engine="excalidraw-supabase"]')).toBeVisible()
      await expect(pageA.getByText('Live', { exact: true })).toBeVisible()
      await expect(pageB.getByText('Live', { exact: true })).toBeVisible()
      await expect(pageB.getByLabel('2 people connected')).toBeVisible()
    })

    let elementId = ''
    await test.step('client A creates and persists a rectangle', async () => {
      const surfaceA = pageA.locator('.live-excalidraw')
      const boxA = await surfaceA.boundingBox()
      if (!boxA) throw new Error('Live Excalidraw surface has no bounding box.')

      const rectangleTool = pageA.getByRole('radio', { name: /^Rectangle\b/i })
      await pageA.getByTitle(/^Rectangle\b/i).click()
      await expect(rectangleTool).toBeChecked()

      await pageA.mouse.move(boxA.x + 300, boxA.y + 250)
      await pageA.mouse.down()
      await pageA.mouse.move(boxA.x + 430, boxA.y + 330, { steps: 8 })
      await pageA.mouse.up()

      await expect.poll(async () => {
        elementId = await latestActiveId()
        return elementId
      }).not.toBe('')
    })

    await test.step('client B receives and deletes the rectangle', async () => {
      const surfaceB = pageB.locator('.live-excalidraw')
      const boxB = await surfaceB.boundingBox()
      if (!boxB) throw new Error('Peer Excalidraw surface has no bounding box.')

      const eraserTool = pageB.getByRole('radio', { name: /^Eraser\b/i })
      await pageB.getByTitle(/^Eraser\b/i).click()
      await expect(eraserTool).toBeChecked()

      await pageB.mouse.move(boxB.x + 280, boxB.y + 290)
      await pageB.mouse.down()
      await pageB.mouse.move(boxB.x + 450, boxB.y + 290, { steps: 12 })
      await pageB.mouse.up()

      await expect.poll(() => isDeleted(elementId)).toBe(true)
    })

    expect(pageErrors).toEqual([])
  } finally {
    await Promise.allSettled([contextA.close(), contextB.close()])
  }
})
