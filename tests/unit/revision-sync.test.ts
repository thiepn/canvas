import assert from 'node:assert/strict'
import test from 'node:test'
import { readRevisionPages } from '../../app/canvas/revision-sync.ts'

test('reads multiple strictly increasing pages and returns the final cursor', async () => {
  const rows = Array.from({ length: 520 }, (_, index) => ({ revision: index + 1, id: `row-${index + 1}` }))
  const seen: number[] = []
  const result = await readRevisionPages({
    startAfter: 0,
    pageSize: 500,
    fetchPage: async (after, limit) => rows.filter(row => row.revision > after).slice(0, limit),
    onPage: page => { seen.push(...page.map(row => row.revision)) },
  })

  assert.equal(result.completed, true)
  assert.equal(result.cursor, 520)
  assert.equal(result.pages, 2)
  assert.equal(result.rows, 520)
  assert.deepEqual(seen, rows.map(row => row.revision))
})

test('does not publish a partial cursor when reconciliation is cancelled', async () => {
  let current = true
  let fetches = 0
  const result = await readRevisionPages({
    startAfter: 40,
    pageSize: 2,
    fetchPage: async after => {
      fetches += 1
      if (fetches === 1) return [{ revision: after + 1 }, { revision: after + 2 }]
      current = false
      return [{ revision: after + 1 }]
    },
    onPage: () => {},
    isCurrent: () => current,
  })

  assert.equal(result.completed, false)
  assert.equal(result.cursor, 40)
})

test('fails closed when a page is unordered or does not advance', async () => {
  await assert.rejects(() => readRevisionPages({
    startAfter: 10,
    pageSize: 10,
    fetchPage: async () => [{ revision: 12 }, { revision: 11 }],
    onPage: () => {},
  }), /strictly increasing/)

  await assert.rejects(() => readRevisionPages({
    startAfter: 10,
    pageSize: 10,
    fetchPage: async () => [{ revision: 10 }],
    onPage: () => {},
  }), /strictly increasing/)
})

test('delivers an empty first page so initial hydration can clear a stale scene', async () => {
  const pages: Array<{ first: boolean; size: number }> = []
  const result = await readRevisionPages({
    startAfter: 0,
    pageSize: 500,
    fetchPage: async () => [],
    onPage: (rows, first) => pages.push({ first, size: rows.length }),
  })

  assert.equal(result.completed, true)
  assert.equal(result.cursor, 0)
  assert.deepEqual(pages, [{ first: true, size: 0 }])
})
