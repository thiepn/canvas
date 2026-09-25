import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('package and lockfile release metadata stay synchronized', async () => {
  const pkg = JSON.parse(await readFile('package.json', 'utf8'))
  const lock = JSON.parse(await readFile('package-lock.json', 'utf8'))
  assert.equal(lock.version, pkg.version)
  assert.equal(lock.packages?.['']?.version, pkg.version)
  assert.equal(lock.packages?.['']?.name, pkg.name)
})
