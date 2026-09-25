import assert from 'node:assert/strict'
import test from 'node:test'
import { BoundedTaskQueue } from '../../app/canvas/bounded-task-queue.ts'

test('bounded queue never exceeds configured concurrency', async () => {
  const queue = new BoundedTaskQueue(2)
  let active = 0
  let maximum = 0
  const releases: Array<() => void> = []
  const jobs = Array.from({ length: 5 }, (_, index) => queue.enqueue(String(index), async () => {
    active += 1
    maximum = Math.max(maximum, active)
    await new Promise<void>(resolve => releases.push(resolve))
    active -= 1
  }))

  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(queue.activeCount, 2)
  assert.equal(queue.queuedCount, 3)
  releases.shift()?.()
  releases.shift()?.()
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.ok(queue.activeCount <= 2)
  while (releases.length || queue.size) {
    while (releases.length) releases.shift()?.()
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  await Promise.all(jobs)
  assert.equal(maximum, 2)
})

test('same-key work is deduplicated while queued or active', async () => {
  const queue = new BoundedTaskQueue(1)
  let runs = 0
  let release!: () => void
  const first = queue.enqueue('asset-a', async () => {
    runs += 1
    await new Promise<void>(resolve => { release = resolve })
  })
  const second = queue.enqueue('asset-a', async () => { runs += 100 })
  assert.equal(first, second)
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(runs, 1)
  release()
  await first
  assert.equal(runs, 1)
})
