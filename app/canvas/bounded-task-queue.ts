export class BoundedTaskQueue {
  private readonly pending: Array<{
    key: string
    run: () => Promise<void>
    resolve: () => void
    reject: (error: unknown) => void
  }> = []
  private readonly promises = new Map<string, Promise<void>>()
  private readonly concurrency: number
  private active = 0

  constructor(concurrency: number) {
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32) {
      throw new Error('Bounded task queue concurrency must be between 1 and 32.')
    }
    this.concurrency = concurrency
  }

  enqueue(key: string, run: () => Promise<void>): Promise<void> {
    const existing = this.promises.get(key)
    if (existing) return existing
    let resolvePromise!: () => void
    let rejectPromise!: (error: unknown) => void
    const promise = new Promise<void>((resolve, reject) => {
      resolvePromise = resolve
      rejectPromise = reject
    })
    this.promises.set(key, promise)
    this.pending.push({ key, run, resolve: resolvePromise, reject: rejectPromise })
    this.pump()
    return promise
  }

  has(key: string): boolean {
    return this.promises.has(key)
  }

  private pump(): void {
    while (this.active < this.concurrency && this.pending.length) {
      const task = this.pending.shift()!
      this.active += 1
      void task.run().then(task.resolve, task.reject).finally(() => {
        this.active = Math.max(0, this.active - 1)
        this.promises.delete(task.key)
        this.pump()
      })
    }
  }

  get activeCount(): number {
    return this.active
  }

  get queuedCount(): number {
    return this.pending.length
  }

  get size(): number {
    return this.active + this.pending.length
  }
}
