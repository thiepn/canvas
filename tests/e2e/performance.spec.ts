import { test, expect, resetWorld, world } from './helpers.ts'
import { mkdir, writeFile } from 'node:fs/promises'
test('measure 100, 1,000, 5,000 and 10,000 objects without fabricated thresholds', async ({ peer, request }) => {
  const report = []
  for (const count of [100, 1000, 5000, 10000]) {
    await resetWorld(request)
    const { page, context } = await peer({ width: 1440, height: 900 })
    const started = Date.now()
    for (let offset = 0; offset < count; offset += 100) {
      await page.evaluate(offset => window.__CANVAS_TEST__!.seed(100, offset), offset)
      await page.waitForTimeout(350) // Respect the real backend byte budget, rather than bypassing it for a synthetic test.
    }
    await expect.poll(async () => (await world(request)).snapshot.documents.filter((item: { state: { typeName: string } }) => item.state.typeName === 'shape').length, { timeout: 60000 }).toBe(count)
    const metrics = await page.evaluate(async () => {
      const before = performance.now(), json = JSON.stringify(window.__CANVAS_TEST__!.shapes()), serializationMs = performance.now() - before
      const frameTimes: number[] = []; let last = performance.now()
      for (let i = 0; i < 90; i++) {
        await new Promise<void>(resolve => requestAnimationFrame(() => { const now = performance.now(); frameTimes.push(now - last); last = now; window.__CANVAS_TEST__!.pan(-i * 50, -i * 20); resolve() }))
      }
      frameTimes.sort((a, b) => a - b)
      return { serializationMs, bytes: new TextEncoder().encode(json).length, medianFrameMs: frameTimes[45], p95FrameMs: frameTimes[85] }
    })
    const cdp = await context.newCDPSession(page)
    await cdp.send('Performance.enable')
    const heap = (await cdp.send('Performance.getMetrics')).metrics.find(item => item.name === 'JSHeapUsedSize')?.value
    report.push({ count, generationAndPersistenceMs: Date.now() - started, ...metrics, jsHeapBytes: heap })
    await context.close()
  }
  await mkdir('artifacts', { recursive: true }); await writeFile('artifacts/performance.json', JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
})
