import { LIMITS } from '../../shared/limits.ts'
import { byteLength } from '../../shared/json.ts'
/** Per-record accounting avoids serializing the whole world on every drag. */
export class WorldBudget {
  private sizes = new Map<string, number>()
  private pending = new Map<string, number>()
  private total = 0
  private delta = 0
  initialize(records: Array<{ id: string }>): void { this.sizes.clear(); this.total = 0; for (const record of records) { const size = byteLength(JSON.stringify(record)); this.sizes.set(record.id, size); this.total += size }; this.begin() }
  begin(): void { this.pending.clear(); this.delta = 0 }
  propose(id: string, record: unknown | null): boolean {
    const size = record === null ? 0 : byteLength(JSON.stringify(record))
    const previous = this.pending.get(id) ?? this.sizes.get(id) ?? 0
    const increment = size - previous
    if (increment > 0 && this.total + this.delta + increment > LIMITS.worldBytes) return false
    this.pending.set(id, size); this.delta += increment; return true
  }
  commit(puts: Array<{ id: string }>, deleted: string[]): void {
    for (const id of deleted) { this.total -= this.sizes.get(id) ?? 0; this.sizes.delete(id) }
    for (const record of puts) { const size = byteLength(JSON.stringify(record)); this.total += size - (this.sizes.get(record.id) ?? 0); this.sizes.set(record.id, size) }
    this.begin()
  }
  get bytes(): number { return this.total }
}
