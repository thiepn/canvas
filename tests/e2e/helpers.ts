import { test as base, expect, type BrowserContext, type Page, type APIRequestContext } from '@playwright/test'
export const API = 'http://127.0.0.1:8787'
export const ORIGIN = 'http://127.0.0.1:5173'
export const ADMIN = 'local-test-only-not-a-production-secret-0123456789'
export interface Peer { context: BrowserContext; page: Page }
export type PeerFactory = (viewport?: { width: number; height: number }, touch?: boolean) => Promise<Peer>
declare global { interface Window { __TEST_SOCKETS__?: Set<WebSocket> } }
export const test = base.extend<{ peer: PeerFactory }>({
  peer: async ({ browser, browserName }, use) => {
    const contexts: BrowserContext[] = []
    await use(async (viewport = { width: 1366, height: 768 }, touch = false) => {
      const context = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch && browserName !== 'firefox' })
      contexts.push(context)
      await context.addInitScript(() => {
        // Test-only fault injection. It is not compiled into Canvas.
        const NativeSocket = window.WebSocket
        window.__TEST_SOCKETS__ = new Set()
        window.WebSocket = class extends NativeSocket {
          constructor(url: string | URL, protocols?: string | string[]) {
            super(url, protocols); window.__TEST_SOCKETS__!.add(this)
            this.addEventListener('close', () => window.__TEST_SOCKETS__!.delete(this))
          }
        }
      })
      const page = await context.newPage()
      await page.goto(`${ORIGIN}/Canvas/`)
      await expect(page.getByRole('status').filter({ hasText: /^Live$/ })).toBeVisible()
      await page.waitForFunction(() => !!window.__CANVAS_TEST__)
      return { page, context }
    })
    for (const context of contexts.reverse()) await context.close()
  },
})
export { expect }
export async function world(request: APIRequestContext) {
  const response = await request.get(`${API}/api/snapshot`, { headers: { Origin: ORIGIN } })
  expect(response.ok()).toBeTruthy(); return response.json()
}
export async function resetWorld(request: APIRequestContext) {
  await expect(async () => {
    const snapshot = await world(request)
    snapshot.snapshot.documents = snapshot.snapshot.documents.filter((item: { state: { typeName: string } }) => ['page', 'document'].includes(item.state.typeName))
    const info = await request.get(`${API}/api/admin/snapshots`, { headers: { Authorization: `Bearer ${ADMIN}` } })
    const response = await request.post(`${API}/api/admin/restore`, { headers: { Authorization: `Bearer ${ADMIN}`, 'If-Match': String((await info.json()).clock) }, data: snapshot })
    expect(response.status()).toBe(200)
  }).toPass({ timeout: 25000, intervals: [250, 500, 1000] })
}
export async function create(page: Page, type: string, text = 'Hello', x = 0, y = 0) { return page.evaluate(args => window.__CANVAS_TEST__!.create(...args), [type, text, x, y] as const) }
export async function hasShape(page: Page, id: string) { return page.evaluate(id => window.__CANVAS_TEST__!.shapes().some(shape => shape.id === id), id) }
export async function waitShape(page: Page, id: string, exists = true) { await expect.poll(() => hasShape(page, id)).toBe(exists) }
