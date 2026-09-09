import { test, expect, resetWorld, create, waitShape, world, API } from './helpers.ts'
test.beforeEach(async ({ request }) => { await resetWorld(request) })
test('real pointer drawing, text typing, shape resize and reload', async ({ peer, request }) => {
  const { page } = await peer()
  await page.getByRole('button', { name: 'Dismiss hint' }).click()
  const toolbar = page.getByRole('toolbar', { name: 'Drawing tools' })
  await toolbar.getByRole('button', { name: 'Draw', exact: true }).click()
  await page.mouse.move(400, 300); await page.mouse.down(); await page.mouse.move(600, 340, { steps: 20 }); await page.mouse.move(510, 410, { steps: 10 }); await page.mouse.up()
  await expect.poll(() => page.evaluate(() => window.__CANVAS_TEST__!.shapes().some(shape => shape.type === 'draw'))).toBe(true)
  await toolbar.getByRole('button', { name: 'Text', exact: true }).click(); await page.mouse.click(500, 470)
  await page.keyboard.type('A real typed note'); await page.keyboard.press('Escape')
  await expect.poll(async () => JSON.stringify(await world(request))).toContain('A real typed note')
  const shape = await create(page, 'rectangle')
  await page.evaluate(id => window.__CANVAS_TEST__!.resize(id, 260, 120), shape)
  await expect.poll(async () => (await world(request)).snapshot.documents.find((item: { state: { id: string } }) => item.state.id === shape)?.state.props.w).toBe(260)
  await page.reload(); await page.waitForFunction(() => !!window.__CANVAS_TEST__); await waitShape(page, shape)
  expect(await page.evaluate(() => window.__CANVAS_TEST__!.shapes().some(shape => shape.type === 'draw'))).toBe(true)
})
test('plain-text paste works; image/file paste and drop never persist media', async ({ peer, request }) => {
  const { page } = await peer()
  await page.mouse.click(400, 300)
  await page.evaluate(() => {
    const target = document.querySelector('.tl-canvas') ?? document.querySelector('.canvas-workspace')!
    const data = new DataTransfer(); data.setData('text/plain', 'Pasted plain text')
    // Firefox does not reliably expose DataTransfer passed through a constructed ClipboardEvent.
    // Define clipboardData directly so the test exercises Canvas's real paste event boundary in
    // the same deterministic way across Chromium, Firefox, and WebKit.
    const event = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', { value: data })
    target.dispatchEvent(event)
  })
  await expect.poll(async () => JSON.stringify(await world(request))).toContain('Pasted plain text')
  await page.evaluate(() => {
    const target = document.querySelector('.tl-canvas') ?? document.querySelector('.canvas-workspace')!
    const dispatchPaste = (data: DataTransfer) => {
      const event = new Event('paste', { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'clipboardData', { value: data })
      target.dispatchEvent(event)
    }
    const dispatchDrop = (data: DataTransfer) => {
      const event = new Event('drop', { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'dataTransfer', { value: data })
      target.dispatchEvent(event)
    }
    const data = new DataTransfer(); data.items.add(new File(['not-an-upload'], 'image.png', { type: 'image/png' }))
    dispatchPaste(data); dispatchDrop(data)
    const pdf = new DataTransfer(); pdf.items.add(new File(['%PDF'], 'file.pdf', { type: 'application/pdf' }))
    dispatchDrop(pdf)
  })
  await expect(page.getByRole('status').filter({ hasText: /not supported/ })).toBeVisible()
  await expect(page.getByRole('toolbar', { name: 'Drawing tools' }).getByRole('button', { name: /image|upload|media/i })).toHaveCount(0)
  expect((await world(request)).snapshot.documents.some((item: { state: { typeName: string; type?: string } }) => item.state.typeName === 'asset' || ['image', 'video', 'embed'].includes(item.state.type || ''))).toBe(false)
})
test('binary and oversized socket messages close the offending socket, not the world', async ({ peer, request }) => {
  const { page } = await peer()
  for (const kind of ['binary', 'oversized']) {
    const code = await page.evaluate(({ url, kind }) => new Promise<number>((resolve, reject) => {
      const ws = new WebSocket(`${url.replace('http:', 'ws:')}/api/connect/main?sessionId=invalid-${crypto.randomUUID()}`)
      const timer = setTimeout(() => { ws.close(); reject(new Error('Socket did not close')) }, 10000)
      ws.onopen = () => ws.send(kind === 'binary' ? new ArrayBuffer(10) : '{' + 'a'.repeat(1048576))
      ws.onclose = event => { clearTimeout(timer); resolve(event.code) }
      ws.onerror = () => { /* close event contains the final transport result */ }
    }), { url: API, kind })
    expect([1008, 1009, 1006]).toContain(code)
    expect((await request.get(`${API}/health`)).ok()).toBe(true)
  }
  const good = await create(page, 'ellipse'); await expect.poll(async () => (await world(request)).snapshot.documents.some((item: { state: { id: string } }) => item.state.id === good)).toBe(true)
})
test('application buttons have accessible names and the menu is keyboard reachable', async ({ peer }) => {
  const { page } = await peer()
  const unnamed = await page.locator('button').evaluateAll(buttons => buttons.filter(button => {
    const rect = button.getBoundingClientRect()
    if (!rect.width || !rect.height || button.getAttribute('aria-hidden') === 'true') return false
    return !(button.getAttribute('aria-label') || button.getAttribute('aria-labelledby') || button.getAttribute('title') || button.textContent?.trim())
  }).map(button => button.outerHTML.slice(0, 250)))
  expect(unnamed).toEqual([])
  const menu = page.getByRole('button', { name: 'Canvas menu and presence' })
  await menu.focus(); await page.keyboard.press('Enter'); await expect(page.getByLabel('Display name', { exact: true })).toBeVisible()
  await page.keyboard.press('Escape'); await expect(menu).toBeFocused(); await expect(page.locator('#canvas-menu')).toHaveCount(0)
})
for (const [width, height] of [[320,568],[360,800],[390,844],[430,932],[768,1024],[1024,768],[1366,768],[1440,900],[1920,1080]]) {
  test(`viewport ${width}×${height}: controls reachable without document scrolling`, async ({ peer }) => {
    const { page } = await peer({ width: width!, height: height! }, width! <= 1024)
    const size = await page.evaluate(() => ({ scrollW: document.documentElement.scrollWidth, w: innerWidth, scrollH: document.documentElement.scrollHeight, h: innerHeight }))
    expect(size.scrollW).toBeLessThanOrEqual(size.w + 1); expect(size.scrollH).toBeLessThanOrEqual(size.h + 1)
    const tools = page.getByRole('toolbar', { name: 'Drawing tools' }).getByRole('button')
    await expect(tools).toHaveCount(12)
    for (const button of await tools.all()) {
      const box = await button.boundingBox(); expect(box).not.toBeNull()
      expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.y).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width).toBeLessThanOrEqual(width! + 1); expect(box!.y + box!.height).toBeLessThanOrEqual(height! + 1)
      expect(box!.width).toBeGreaterThanOrEqual(38); expect(box!.height).toBeGreaterThanOrEqual(40)
    }
    await page.getByRole('button', { name: 'Canvas menu and presence' }).click()
    const menu = await page.locator('#canvas-menu').boundingBox()
    expect(menu!.x).toBeGreaterThanOrEqual(0); expect(menu!.x + menu!.width).toBeLessThanOrEqual(width! + 1)
  })
}
test('touch text editing and two-finger gesture do not scroll the document', async ({ peer, browserName }) => {
  test.skip(browserName !== 'chromium', 'CDP multi-touch injection is Chromium-only; physical Safari/stylus testing remains separate.')
  const { page, context } = await peer({ width: 390, height: 844 }, true)
  await page.getByRole('toolbar', { name: 'Drawing tools' }).getByRole('button', { name: 'Text', exact: true }).tap()
  await page.touchscreen.tap(170, 360); await page.keyboard.type('Touch note'); await page.keyboard.press('Escape')
  await expect.poll(() => page.evaluate(() => window.__CANVAS_TEST__!.shapes().filter(shape => shape.type === 'text').length)).toBe(1)
  const before = await page.evaluate(() => window.__CANVAS_TEST__!.camera())
  const cdp = await context.newCDPSession(page)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 150, y: 450, id: 0 }, { x: 230, y: 450, id: 1 }] })
  for (let i = 0; i < 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 150 - i * 5, y: 450 + i * 3, id: 0 }, { x: 230 + i * 5, y: 450 + i * 3, id: 1 }] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect.poll(() => page.evaluate(() => window.__CANVAS_TEST__!.camera().z)).toBeGreaterThan(before.z * 1.05)
  expect(await page.evaluate(() => scrollY)).toBe(0)
  await expect(page.getByRole('toolbar', { name: 'Drawing tools' })).toBeVisible()
})

// Native navigation hides on phones; Canvas's own menu must keep these actions reachable.
test('phone menu exposes functional undo, redo, and zoom without keyboard shortcuts', async ({ peer }) => {
  const { page } = await peer({ width: 320, height: 568 }, true)
  const id = await create(page, 'rectangle')
  await page.getByRole('button', { name: 'Canvas menu and presence' }).click()
  const controls = page.locator('#canvas-menu')
  await controls.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect.poll(() => page.evaluate(id => window.__CANVAS_TEST__!.shapes().some(shape => shape.id === id), id)).toBe(false)
  await controls.getByRole('button', { name: 'Redo', exact: true }).click()
  await waitShape(page, id)
  const before = await page.evaluate(() => window.__CANVAS_TEST__!.camera().z)
  await controls.getByRole('button', { name: 'Zoom in', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.__CANVAS_TEST__!.camera().z)).toBeGreaterThan(before)
  await controls.getByRole('button', { name: 'Zoom out', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.__CANVAS_TEST__!.camera().z)).toBeCloseTo(before)
  expect(await page.evaluate(() => scrollY)).toBe(0)
})
