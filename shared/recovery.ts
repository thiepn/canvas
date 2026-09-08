import type { BackupEnvelope } from './backup.ts'
/** Reconstruct the immediately preceding record state from a committed diff and captured prev records. */
export function beforeChangeSnapshot(
  current: BackupEnvelope['snapshot'],
  changedIds: Iterable<string>,
  previous: ReadonlyMap<string, Record<string, unknown>>,
): BackupEnvelope['snapshot'] {
  const clock = Math.max(0, (current.documentClock ?? current.clock ?? 1) - 1)
  const documents = new Map(current.documents.map(item => [String(item.state.id), item]))
  for (const id of changedIds) {
    const before = previous.get(id)
    if (before) documents.set(id, { state: before, lastChangedClock: clock })
    else documents.delete(id)
  }
  return { schema: current.schema, clock, documentClock: clock, documents: [...documents.values()] }
}
