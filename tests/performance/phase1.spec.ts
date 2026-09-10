import { mkdir, writeFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { DEFAULT_SUPABASE_PUBLISHABLE_KEY, DEFAULT_SUPABASE_URL } from '../../app/config/public-config.ts'
import type { DiagnosticsSnapshot } from '../../app/diagnostics/metrics.ts'
import { dragOnCanvas } from '../live/scene-helpers.ts'

const TABLE = 'canvas_ci_elements'
const FIXTURE_COUNTS = [100, 1000, 5000, 10000]
const supabase = createClient(DEFAULT_SUPABASE_URL, DEFAULT_SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
})

type FrameStats = { p50FrameMs: number; p95FrameMs: number; maxFrameMs: number }

type FixtureResult = {
  count: number
  generationMs: number
  initialRenderMs: number
  serializationMs: number
  serializedBytes: number
  pan: FrameStats
  moveOne: FrameStats
  moveTwenty: FrameStats
  selectTwentyMs: number
  jsHeapBytes?: number
}

function percentile(sorted: number[], quantile: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1))] ?? 0
}

async function cleanWorld() {
  const { error } = await supabase.from(TABLE).delete().neq('id', '')
  if (error) throw error
}

async function waitForFixtureBridge(page: Page) {
  await expect.poll(() => page.evaluate(() => Boolean(window.__CANVAS_PERF__ && window.__CANVAS_DIAGNOSTICS__))).toBe(true)
}

async function waitForDiagnostics(page: Page) {
  await expect.poll(() => page.evaluate(() => Boolean(window.__CANVAS_DIAGNOSTICS__))).toBe(true)
}

async function frameBenchmark(page: Page, action: 'pan' | 'moveOne' | 'moveTwenty', frames = 90): Promise<FrameStats> {
  const values = await page.evaluate(async ({ action, frames }) => {
    const bridge = window.__CANVAS_PERF__
    if (!bridge) throw new Error('Performance bridge is unavailable.')
    const durations: number[] = []
    let previous = performance.now()
    for (let index = 0; index < frames; index++) {
      await new Promise<void>(resolve => requestAnimationFrame(() => {
        const current = performance.now()
        if (index > 4) durations.push(current - previous)
        previous = current
        if (action === 'pan') bridge.panBy(index % 2 ? 8 : -8, index % 2 ? 4 : -4)
        else if (action === 'moveOne') bridge.moveFirst(1, index % 2 ? 2 : -2, 0)
        else bridge.moveFirst(20, index % 2 ? 2 : -2, 0)
        resolve()
      }))
    }
    return durations
  }, { action, frames })
  values.sort((a, b) => a - b)
  return { p50FrameMs: percentile(values, 0.5), p95FrameMs: percentile(values, 0.95), maxFrameMs: values.at(-1) ?? 0 }
}

async function selectBenchmark(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const bridge = window.__CANVAS_PERF__
    if (!bridge) throw new Error('Performance bridge is unavailable.')
    const started = performance.now()
    bridge.selectFirst(20)
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    return performance.now() - started
  })
}

async function diagnostics(page: Page): Promise<DiagnosticsSnapshot> {
  return page.evaluate(() => {
    if (!window.__CANVAS_DIAGNOSTICS__) throw new Error('Diagnostics API is unavailable.')
    return window.__CANVAS_DIAGNOSTICS__.snapshot()
  })
}

test('Phase 1 baseline measures production-engine scale and multiplayer latency', async ({ browser, browserName }) => {
  test.setTimeout(300_000)
  await cleanWorld()
  const fixtureResults: FixtureResult[] = []
  const fixtureContext = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const fixturePage = await fixtureContext.newPage()
  await fixturePage.goto('./?debug=1&fixture=1')
  await expect(fixturePage.locator('[data-canvas-engine="excalidraw-performance-fixture"]')).toBeVisible()
  await waitForFixtureBridge(fixturePage)

  try {
    for (const count of FIXTURE_COUNTS) {
      const loaded = await fixturePage.evaluate(async count => {
        if (!window.__CANVAS_PERF__) throw new Error('Performance bridge is unavailable.')
        return window.__CANVAS_PERF__.loadFixture(count)
      }, count)
      await expect.poll(() => fixturePage.evaluate(() => window.__CANVAS_PERF__?.state().elements ?? 0)).toBe(count)

      const serialization = await fixturePage.evaluate(() => window.__CANVAS_PERF__!.serialize())
      const pan = await frameBenchmark(fixturePage, 'pan')
      const moveOne = await frameBenchmark(fixturePage, 'moveOne', 60)
      const moveTwenty = await frameBenchmark(fixturePage, 'moveTwenty', 60)
      const selectTwentyMs = await selectBenchmark(fixturePage)

      let jsHeapBytes: number | undefined
      if (browserName === 'chromium') {
        const cdp = await fixtureContext.newCDPSession(fixturePage)
        await cdp.send('Performance.enable')
        jsHeapBytes = (await cdp.send('Performance.getMetrics')).metrics.find(metric => metric.name === 'JSHeapUsedSize')?.value
      }

      fixtureResults.push({
        count,
        generationMs: loaded.generationMs,
        initialRenderMs: loaded.renderMs,
        serializationMs: serialization.serializationMs,
        serializedBytes: serialization.bytes,
        pan,
        moveOne,
        moveTwenty,
        selectTwentyMs,
        jsHeapBytes,
      })
    }
  } finally {
    await fixtureContext.close()
  }

  await cleanWorld()
  const contextA = await browser.newContext({ viewport: { width: 1366, height: 768 } })
  const contextB = await browser.newContext({ viewport: { width: 1366, height: 768 } })
  const pageA = await contextA.newPage()
  const pageB = await contextB.newPage()
  try {
    const openedAt = Date.now()
    await Promise.all([pageA.goto('./?debug=1'), pageB.goto('./?debug=1')])
    await Promise.all([
      expect(pageA.getByText('Live', { exact: true })).toBeVisible(),
      expect(pageB.getByText('Live', { exact: true })).toBeVisible(),
    ])
    await Promise.all([waitForDiagnostics(pageA), waitForDiagnostics(pageB)])
    const readyAt = Date.now()

    const beforeA = await diagnostics(pageA)
    const beforePixels = await pageB.locator('canvas.excalidraw__canvas.interactive').evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())
    const operationStarted = Date.now()
    await pageA.getByTitle(/^Rectangle\b/i).click()
    await dragOnCanvas(pageA, [300, 250], [430, 330])
    await expect.poll(() => pageB.locator('canvas.excalidraw__canvas.interactive').evaluate((canvas: HTMLCanvasElement, baseline: string) => canvas.toDataURL() !== baseline, beforePixels), { message: 'Peer canvas pixels must change after the remote rectangle renders.' }).toBe(true)
    const remoteRenderMs = Date.now() - operationStarted
    await pageA.waitForTimeout(800)
    const afterWriteA = await diagnostics(pageA)

    await contextA.setOffline(true)
    await expect(pageA.getByText('Offline', { exact: true })).toBeVisible()
    const reconnectStarted = Date.now()
    await contextA.setOffline(false)
    await expect(pageA.getByText('Live', { exact: true })).toBeVisible({ timeout: 30_000 })
    const reconnectObservedMs = Date.now() - reconnectStarted
    const afterReconnectA = await diagnostics(pageA)

    const environment = await pageA.evaluate(() => ({
      userAgent: navigator.userAgent,
      devicePixelRatio: window.devicePixelRatio,
      viewport: { width: innerWidth, height: innerHeight },
    }))

    const report = {
      schemaVersion: 2,
      measuredAt: new Date().toISOString(),
      commit: process.env.GITHUB_SHA ?? null,
      engine: 'excalidraw-supabase',
      browser: browserName,
      environment,
      fixtures: fixtureResults,
      collaboration: {
        twoClientOpenToLiveMs: readyAt - openedAt,
        remoteCreateToRenderMs: remoteRenderMs,
        reconnectObservedMs,
        initialHydrationP95Ms: afterWriteA.samples.initialHydrationMs?.p95 ?? beforeA.samples.initialHydrationMs?.p95 ?? null,
        supabaseWriteP95Ms: afterWriteA.samples.supabaseWriteMs?.p95 ?? null,
        realtimeReceiveToFrameP95Ms: afterWriteA.samples.realtimeReceiveToFrameMs?.p95 ?? null,
        writesPerGestureP95: afterWriteA.samples.writesPerGesture?.p95 ?? null,
        dbWriteBatches: afterWriteA.counters.dbWriteBatches ?? 0,
        dbRowsWritten: afterWriteA.counters.dbRowsWritten ?? 0,
        logicalMutationsForGesture: (afterWriteA.counters.logicalMutations ?? 0) - (beforeA.counters.logicalMutations ?? 0),
        logicalMutationChangesForGesture: (afterWriteA.counters.logicalMutationChanges ?? 0) - (beforeA.counters.logicalMutationChanges ?? 0),
        changesPerMutationP95: afterWriteA.samples.changesPerMutation?.p95 ?? null,
        lastMutationKind: afterWriteA.gauges.lastMutationKind ?? null,
        lastMutationSource: afterWriteA.gauges.lastMutationSource ?? null,
        diagnosticsReconnectP95Ms: afterReconnectA.samples.reconnectMs?.p95 ?? null,
        pendingWritesAfterReconnect: afterReconnectA.gauges.pendingWrites ?? null,
      },
    }

    await mkdir('artifacts', { recursive: true })
    await writeFile('artifacts/performance.json', JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report, null, 2))
  } finally {
    await Promise.allSettled([contextA.close(), contextB.close()])
    await cleanWorld()
  }
})
