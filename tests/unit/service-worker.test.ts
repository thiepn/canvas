import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('service worker uses build-scoped shell caches and never auto-activates mid-session', async () => {
  const source = await readFile('public/sw.js', 'utf8')
  assert.ok(source.includes("canvas-shell-__BUILD_ID__"))
  assert.ok(source.includes("CANVAS_ACTIVATE_UPDATE"))
  const install = source.slice(source.indexOf("addEventListener('install'"), source.indexOf("addEventListener('message'"))
  assert.equal(install.includes('skipWaiting('), false)
})

test('service worker limits caching to its own static application scope', async () => {
  const source = await readFile('public/sw.js', 'utf8')
  assert.ok(source.includes('url.origin !== scope.origin'))
  assert.ok(source.includes('url.pathname.startsWith(scope.pathname)'))
  assert.ok(source.includes("['script', 'style', 'font', 'image']"))
  assert.equal(source.includes('supabase.co'), false)
})
