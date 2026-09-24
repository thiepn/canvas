import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { DEFAULT_SUPABASE_PUBLISHABLE_KEY, DEFAULT_SUPABASE_URL } from '../../app/config/public-config.ts'
import { dragOnCanvas, exportElement } from './scene-helpers.ts'
import { retryTransientSupabaseTestOperation } from './supabase-test-helpers.ts'

const TABLE = 'canvas_ci_elements'
const supabase = createClient(DEFAULT_SUPABASE_URL, DEFAULT_SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
})

async function clean() {
  const { error } = await retryTransientSupabaseTestOperation(() => supabase.from(TABLE).delete().neq('id', ''))
  if (error) throw error
}

test.beforeEach(clean)
test.afterEach(clean)

test('focus anti-entropy repairs a deliberately dropped Postgres change without reconnect', async ({ browser }) => {
  const contextA = await browser.newContext()
  const contextB = await browser.newContext()
  const pageA = await contextA.newPage()
  const pageB = await contextB.newPage()
  try {
    await Promise.all([pageA.goto('./'), pageB.goto('./?debug=1&dropRealtime=1')])
    await Promise.all([
      expect(pageA.getByText('Live', { exact: true })).toBeVisible(),
      expect(pageB.getByText('Live', { exact: true })).toBeVisible(),
    ])

    await pageA.getByTitle(/^Rectangle\b/i).click()
    await dragOnCanvas(pageA, [300, 250], [430, 330])

    let id = ''
    let revision = 0
    await expect.poll(async () => {
      const { data, error } = await retryTransientSupabaseTestOperation(() => supabase.from(TABLE).select('id,element,is_deleted,revision').eq('is_deleted', false).limit(1))
      if (error) throw error
      const row = data?.[0]
      if (row?.element?.type === 'rectangle' && row.element.width === 130) {
        id = row.id
        revision = Number(row.revision)
      }
      return id
    }).not.toBe('')

    // Establish B on the durable creation first. The actual dropped change is
    // injected only after B is foregrounded, eliminating background-tab
    // scheduling from the diagnostic precondition this test is meant to prove.
    await pageB.bringToFront()
    await pageB.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect.poll(async () => Boolean(await exportElement(pageB, id))).toBe(true)

    const beforeDrop = await pageB.evaluate(() => window.__CANVAS_DIAGNOSTICS__?.snapshot())
    const droppedBaseline = Number(beforeDrop?.counters.realtimeChangesDroppedForDiagnostics ?? 0)

    const { data: currentRow, error: currentError } = await retryTransientSupabaseTestOperation(() =>
      supabase.from(TABLE)
        .select('id,version,version_nonce,element,revision')
        .eq('id', id)
        .single(),
    )
    if (currentError) throw currentError
    const updatedX = Number(currentRow.element.x) + 90
    const updatedVersion = Number(currentRow.version) + 1
    const updatedNonce = Number(currentRow.version_nonce) + 1
    const updatedElement = {
      ...currentRow.element,
      x: updatedX,
      version: updatedVersion,
      versionNonce: updatedNonce,
    }
    const { data: updatedRow, error: updateError } = await retryTransientSupabaseTestOperation(() =>
      supabase.from(TABLE)
        .update({
          version: updatedVersion,
          version_nonce: updatedNonce,
          element: updatedElement,
          updated_by: 'anti-entropy-dropped-update',
        })
        .eq('id', id)
        .select('revision')
        .single(),
    )
    if (updateError) throw updateError
    revision = Number(updatedRow.revision)

    await expect.poll(async () => {
      const snapshot = await pageB.evaluate(() => window.__CANVAS_DIAGNOSTICS__?.snapshot())
      return Number(snapshot?.counters.realtimeChangesDroppedForDiagnostics ?? 0)
    }).toBeGreaterThan(droppedBaseline)

    // The deliberately dropped update must leave B behind the authoritative
    // revision until focus reconciliation runs.
    const before = await pageB.evaluate(() => window.__CANVAS_DIAGNOSTICS__?.snapshot())
    expect(Number(before?.gauges.reconciliationCursor ?? 0)).toBeLessThan(revision)

    await pageB.evaluate(() => window.dispatchEvent(new Event('focus')))

    await expect.poll(async () => {
      const snapshot = await pageB.evaluate(() => window.__CANVAS_DIAGNOSTICS__?.snapshot())
      return Number(snapshot?.gauges.reconciliationCursor ?? 0)
    }).toBeGreaterThanOrEqual(revision)
    await expect.poll(async () => Number((await exportElement(pageB, id))?.x)).toBe(updatedX)
    await expect(pageB.getByText('Live', { exact: true })).toBeVisible()

    const snapshot = await pageB.evaluate(() => window.__CANVAS_DIAGNOSTICS__?.snapshot())
    expect(snapshot?.counters.antiEntropyRuns ?? 0).toBeGreaterThan(0)
    expect(snapshot?.counters.antiEntropySuccesses ?? 0).toBeGreaterThan(0)
    expect(snapshot?.counters.antiEntropyRowsRead ?? 0).toBeGreaterThan(0)
  } finally {
    await Promise.allSettled([contextA.close(), contextB.close()])
  }
})
