import { test, expect, resetWorld, world } from './helpers.ts'

test.beforeEach(async ({ request }) => {
  await resetWorld(request)
})

test('all required vector tools create persistent records and eraser removes a target', async ({ peer, request }) => {
  const { page } = await peer()
  const hint = page.getByRole('button', { name: 'Dismiss hint' })
  if (await hint.isVisible()) await hint.click()

  const toolbar = page.getByRole('toolbar', { name: 'Drawing tools' })

  async function dragTool(
    name: 'Rectangle' | 'Ellipse' | 'Diamond' | 'Line' | 'Arrow' | 'Frame' | 'Highlighter',
    start: [number, number],
    end: [number, number]
  ) {
    const before = await page.evaluate(() => window.__CANVAS_TEST__!.shapes().map(shape => shape.id))
    await toolbar.getByRole('button', { name, exact: true }).click()
    await page.mouse.move(start[0], start[1])
    await page.mouse.down()
    await page.mouse.move(end[0], end[1], { steps: 10 })
    await page.mouse.up()

    await expect.poll(() => page.evaluate(ids => {
      return window.__CANVAS_TEST__!.shapes().filter(shape => !ids.includes(shape.id)).length
    }, before)).toBe(1)

    const created = await page.evaluate(ids => {
      return window.__CANVAS_TEST__!.shapes().find(shape => !ids.includes(shape.id)) ?? null
    }, before)
    expect(created).not.toBeNull()
    return created!
  }

  const rectangle = await dragTool('Rectangle', [260, 190], [360, 260])
  expect(rectangle.type).toBe('geo')
  expect(rectangle.props.geo).toBe('rectangle')

  const ellipse = await dragTool('Ellipse', [420, 190], [520, 260])
  expect(ellipse.type).toBe('geo')
  expect(ellipse.props.geo).toBe('ellipse')

  const diamond = await dragTool('Diamond', [580, 190], [680, 270])
  expect(diamond.type).toBe('geo')
  expect(diamond.props.geo).toBe('diamond')

  const line = await dragTool('Line', [260, 340], [380, 400])
  expect(line.type).toBe('line')

  const arrow = await dragTool('Arrow', [450, 340], [570, 400])
  expect(arrow.type).toBe('arrow')

  const frame = await dragTool('Frame', [650, 320], [800, 430])
  expect(frame.type).toBe('frame')

  const highlighter = await dragTool('Highlighter', [260, 500], [440, 525])
  expect(highlighter.type).toBe('highlight')

  const requiredIds = [rectangle.id, ellipse.id, diamond.id, line.id, arrow.id, frame.id, highlighter.id]
  await expect.poll(async () => {
    const snapshot = await world(request)
    const ids = new Set(snapshot.snapshot.documents.map((item: { state: { id: string } }) => item.state.id))
    return requiredIds.every(id => ids.has(id))
  }).toBe(true)

  const eraserTarget = await dragTool('Rectangle', [930, 500], [1040, 575])
  await toolbar.getByRole('button', { name: 'Eraser', exact: true }).click()
  // tldraw's eraser intentionally treats hollow geo interiors as empty space. Sweep from
  // outside through the rectangle outline so this exercises the real eraser gesture.
  await page.mouse.move(880, 537)
  await page.mouse.down()
  await page.mouse.move(980, 537, { steps: 10 })
  await page.mouse.up()

  await expect.poll(() => page.evaluate(id => {
    return window.__CANVAS_TEST__!.shapes().some(shape => shape.id === id)
  }, eraserTarget.id)).toBe(false)
  await expect.poll(async () => {
    const snapshot = await world(request)
    return snapshot.snapshot.documents.some((item: { state: { id: string } }) => item.state.id === eraserTarget.id)
  }).toBe(false)
})
