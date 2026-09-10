export type CanvasOperationSource = 'pointer' | 'text' | 'discrete'
export type CanvasMutationKind = 'create' | 'update' | 'delete' | 'mixed'

export type CanvasOperationElement = {
  id: string
  version: number
  versionNonce: number
  isDeleted: boolean
}

export type CanvasUpsertChange<T extends CanvasOperationElement = CanvasOperationElement> = {
  type: 'upsert'
  element: T
  existedBefore: boolean
}

export type CanvasDeleteChange<T extends CanvasOperationElement = CanvasOperationElement> = {
  type: 'delete'
  elementId: string
  version: number
  versionNonce: number
  tombstone: T
  existedBefore: boolean
}

export type CanvasElementChange<T extends CanvasOperationElement = CanvasOperationElement> =
  | CanvasUpsertChange<T>
  | CanvasDeleteChange<T>

export type CanvasMutation<T extends CanvasOperationElement = CanvasOperationElement> = {
  mutationId: string
  deviceId: string
  source: CanvasOperationSource
  kind: CanvasMutationKind
  startedAt: number
  committedAt: number
  durationMs: number
  changes: CanvasElementChange<T>[]
}

export type CanvasOperationSnapshot<T extends CanvasOperationElement = CanvasOperationElement> = {
  source: CanvasOperationSource
  startedAt: number
  capturedAt: number
  durationMs: number
  changes: CanvasElementChange<T>[]
}

type TrackedChange<T extends CanvasOperationElement> = {
  element: T
  existedBefore: boolean
}

type ActiveOperation<T extends CanvasOperationElement> = {
  source: CanvasOperationSource
  startedAt: number
  changes: Map<string, TrackedChange<T>>
}

export type CanvasOperationTrackerOptions<T extends CanvasOperationElement> = {
  deviceId: () => string
  onCommit: (mutation: CanvasMutation<T>) => void
  now?: () => number
  createMutationId?: () => string
  pointerSettleMs?: number
  discreteQuietMs?: number
}

function defaultNow(): number {
  return globalThis.performance?.now?.() ?? Date.now()
}

function defaultMutationId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `mutation-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function mutationKind<T extends CanvasOperationElement>(changes: TrackedChange<T>[]): CanvasMutationKind {
  if (changes.every(change => change.element.isDeleted)) return 'delete'
  if (changes.every(change => !change.existedBefore && !change.element.isDeleted)) return 'create'
  if (changes.every(change => change.existedBefore && !change.element.isDeleted)) return 'update'
  return 'mixed'
}

/**
 * Phase 2 semantic operation boundary.
 *
 * This class deliberately does not persist anything. It observes local element
 * changes and groups them into one logical mutation. Phase 3 consumes committed
 * mutations as durability boundaries while `snapshotActive()` exposes a
 * non-committing view for bounded long-operation safety checkpoints.
 */
export class CanvasOperationTracker<T extends CanvasOperationElement> {
  private operation: ActiveOperation<T> | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly now: () => number
  private readonly createMutationId: () => string
  private readonly pointerSettleMs: number
  private readonly discreteQuietMs: number
  private readonly options: CanvasOperationTrackerOptions<T>

  constructor(options: CanvasOperationTrackerOptions<T>) {
    this.options = options
    this.now = options.now ?? defaultNow
    this.createMutationId = options.createMutationId ?? defaultMutationId
    this.pointerSettleMs = options.pointerSettleMs ?? 50
    this.discreteQuietMs = options.discreteQuietMs ?? 180
  }

  beginPointer(): void {
    this.beginContinuous('pointer')
  }

  beginText(): void {
    if (this.operation?.source === 'text') return
    this.beginContinuous('text')
  }

  private beginContinuous(source: 'pointer' | 'text'): void {
    this.clearTimer()
    if (this.operation) this.commit()
    this.operation = { source, startedAt: this.now(), changes: new Map() }
  }

  record(element: T, existedBefore: boolean): void {
    if (!this.operation) this.operation = { source: 'discrete', startedAt: this.now(), changes: new Map() }

    const previous = this.operation.changes.get(element.id)
    this.operation.changes.set(element.id, {
      element,
      // Preserve whether the element existed when this logical operation first
      // touched it. A newly-created element can be observed many times before
      // pointer-up as its geometry/version changes.
      existedBefore: previous?.existedBefore ?? existedBefore,
    })

    if (this.operation.source === 'discrete') this.scheduleCommit(this.discreteQuietMs)
  }

  endPointer(): void {
    if (this.operation?.source !== 'pointer') return
    // Excalidraw can publish its final onChange immediately after pointer-up.
    // A short settle window includes that final immutable element version in
    // the same human gesture rather than creating a second mutation.
    this.scheduleCommit(this.pointerSettleMs)
  }

  endText(): void {
    if (this.operation?.source !== 'text') return
    this.clearTimer()
    this.commit()
  }

  snapshotActive(): CanvasOperationSnapshot<T> | null {
    const operation = this.operation
    if (!operation || operation.changes.size === 0) return null
    const capturedAt = this.now()
    return {
      source: operation.source,
      startedAt: operation.startedAt,
      capturedAt,
      durationMs: Math.max(0, capturedAt - operation.startedAt),
      changes: this.toChanges([...operation.changes.values()]),
    }
  }

  flush(): CanvasMutation<T> | null {
    this.clearTimer()
    return this.commit()
  }

  dispose(): void {
    this.clearTimer()
    this.operation = null
  }

  private scheduleCommit(delay: number): void {
    this.clearTimer()
    this.timer = setTimeout(() => {
      this.timer = null
      this.commit()
    }, delay)
  }

  private clearTimer(): void {
    if (!this.timer) return
    clearTimeout(this.timer)
    this.timer = null
  }

  private toChanges(tracked: TrackedChange<T>[]): CanvasElementChange<T>[] {
    return tracked.map(({ element, existedBefore }) => element.isDeleted
      ? {
          type: 'delete',
          elementId: element.id,
          version: element.version,
          versionNonce: element.versionNonce,
          tombstone: element,
          existedBefore,
        }
      : { type: 'upsert', element, existedBefore })
  }

  private commit(): CanvasMutation<T> | null {
    const operation = this.operation
    this.operation = null
    if (!operation || operation.changes.size === 0) return null

    const committedAt = this.now()
    const tracked = [...operation.changes.values()]
    const changes = this.toChanges(tracked)

    const mutation: CanvasMutation<T> = {
      mutationId: this.createMutationId(),
      deviceId: this.options.deviceId(),
      source: operation.source,
      kind: mutationKind(tracked),
      startedAt: operation.startedAt,
      committedAt,
      durationMs: Math.max(0, committedAt - operation.startedAt),
      changes,
    }
    this.options.onCommit(mutation)
    return mutation
  }
}
