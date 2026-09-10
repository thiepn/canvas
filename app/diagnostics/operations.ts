import type { CanvasMutation, CanvasOperationElement } from '../canvas/operation-model.ts'
import { canvasDiagnostics } from './metrics.ts'

/** Record only operation metadata. Element IDs, text, geometry and styles are never retained. */
export function recordMutationDiagnostics<T extends CanvasOperationElement>(mutation: CanvasMutation<T>): void {
  if (!canvasDiagnostics.enabled) return
  const deletes = mutation.changes.filter(change => change.type === 'delete').length
  canvasDiagnostics.increment('logicalMutations')
  canvasDiagnostics.increment('logicalMutationChanges', mutation.changes.length)
  canvasDiagnostics.increment('logicalMutationDeletes', deletes)
  canvasDiagnostics.sample('changesPerMutation', mutation.changes.length)
  canvasDiagnostics.sample('mutationDurationMs', mutation.durationMs)
  canvasDiagnostics.gauge('lastMutationKind', mutation.kind)
  canvasDiagnostics.gauge('lastMutationSource', mutation.source)
  canvasDiagnostics.gauge('lastMutationChanges', mutation.changes.length)
}
