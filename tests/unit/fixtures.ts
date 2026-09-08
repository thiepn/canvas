import { wrapBackup } from '../../shared/backup.ts'
export const baseRecords = () => [
  { id: 'document:document', typeName: 'document', name: 'Canvas', meta: {} },
  { id: 'page:page', typeName: 'page', name: 'Canvas', index: 'a1', meta: {} },
]
export function shape(id = 'shape:one', type = 'geo') {
  return { id, typeName: 'shape', type, parentId: 'page:page', x: 0, y: 0, rotation: 0, meta: {}, props: type === 'geo' ? { geo: 'rectangle', w: 100, h: 60 } : {} }
}
export function fixtureBackup(clock = 1, extra: Record<string, unknown>[] = [shape()]) {
  return wrapBackup({ schema: { schemaVersion: 2, sequences: {} }, documentClock: clock, documents: [...baseRecords(), ...extra].map(state => ({ state, lastChangedClock: clock })) }, new Date('2026-09-08T12:00:00Z'))
}
