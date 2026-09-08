import { LIMITS } from '../../shared/limits.ts'
export type BackupKind = 'recent' | 'daily' | 'manual' | 'before-restore' | 'before-delete'
export interface BackupInfo { id: string; createdAt: number; kind: BackupKind; clock: number; bytes: number; checksum: string }
export function retainBackupIds(backups: BackupInfo[], budget: number = LIMITS.backupTotalBytes): Set<string> {
  const limits: Record<BackupKind, number> = { recent: 16, daily: 7, manual: 4, 'before-restore': 4, 'before-delete': 4 }
  const counts: Record<BackupKind, number> = { recent: 0, daily: 0, manual: 0, 'before-restore': 0, 'before-delete': 0 }
  const sorted = [...backups].sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))
  const keep = new Set<string>()
  let bytes = 0
  for (const item of sorted) {
    if (counts[item.kind] >= limits[item.kind]) continue
    if (keep.size && bytes + item.bytes > budget) continue
    keep.add(item.id)
    counts[item.kind]++
    bytes += item.bytes
  }
  return keep
}
