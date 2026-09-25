import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('service worker uses build-scoped shell caches and never auto-activates mid-session', async () => {
  const source = await readFile('public/sw.js', 'utf8')
  assert.match(source, /canvas-shell-__BUILD_ID__/)
  assert.match(source, /CANVAS_ACTIVATE_UPDATE/)
  const install = source.slice(source.indexOf("addEventListener('install'"), source.indexOf("addEventListener('message'"))
  assert.doesNotMatch(install, /skipWaitings*(/)
})

test('service worker limits caching to its own static application scope', async () => {
  const source = await readFile('public/sw.js', 'utf8')
  assert.match(source, /url.origin !== scope.origin/)
  assert.match(source, /url.pathname.startsWith(scope.pathname)/)
  assert.match(source, /['script', 'style', 'font', 'image']/)
  assert.doesNotMatch(source, /supabase.co/)
})
