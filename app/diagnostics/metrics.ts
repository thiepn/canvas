export type MetricSummary = {
  count: number
  last: number
  min: number
  max: number
  average: number
  p50: number
  p95: number
}

export type DiagnosticsSnapshot = {
  enabled: boolean
  capturedAt: string
  uptimeMs: number
  gauges: Record<string, number | string>
  counters: Record<string, number>
  samples: Record<string, MetricSummary>
}

const MAX_SAMPLES = 360

function now(): number {
  return globalThis.performance?.now?.() ?? Date.now()
}

function percentile(sorted: number[], quantile: number): number {
  if (!sorted.length) return 0
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1))
  return sorted[index]
}

function summarize(values: number[]): MetricSummary {
  const sorted = [...values].sort((a, b) => a - b)
  const total = values.reduce((sum, value) => sum + value, 0)
  return {
    count: values.length,
    last: values.at(-1) ?? 0,
    min: sorted[0] ?? 0,
    max: sorted.at(-1) ?? 0,
    average: values.length ? total / values.length : 0,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
  }
}

export class CanvasDiagnostics {
  private active = false
  private startedAt = now()
  private readonly sampleMap = new Map<string, number[]>()
  private readonly gaugeMap = new Map<string, number | string>()
  private readonly counterMap = new Map<string, number>()

  enable(): void {
    if (this.active) return
    this.active = true
    this.startedAt = now()
  }

  get enabled(): boolean {
    return this.active
  }

  sample(name: string, value: number): void {
    if (!this.active || !Number.isFinite(value)) return
    const values = this.sampleMap.get(name) ?? []
    values.push(value)
    if (values.length > MAX_SAMPLES) values.splice(0, values.length - MAX_SAMPLES)
    this.sampleMap.set(name, values)
  }

  gauge(name: string, value: number | string): void {
    if (!this.active || (typeof value === 'number' && !Number.isFinite(value))) return
    this.gaugeMap.set(name, value)
  }

  increment(name: string, amount = 1): void {
    if (!this.active || !Number.isFinite(amount)) return
    this.counterMap.set(name, (this.counterMap.get(name) ?? 0) + amount)
  }

  counter(name: string): number {
    return this.counterMap.get(name) ?? 0
  }

  reset(): void {
    this.sampleMap.clear()
    this.gaugeMap.clear()
    this.counterMap.clear()
    this.startedAt = now()
  }

  snapshot(): DiagnosticsSnapshot {
    const samples: Record<string, MetricSummary> = {}
    for (const [name, values] of this.sampleMap) samples[name] = summarize(values)
    return {
      enabled: this.active,
      capturedAt: new Date().toISOString(),
      uptimeMs: Math.max(0, now() - this.startedAt),
      gauges: Object.fromEntries(this.gaugeMap),
      counters: Object.fromEntries(this.counterMap),
      samples,
    }
  }
}

export const canvasDiagnostics = new CanvasDiagnostics()

export function diagnosticsRequested(search: string, mode: string): boolean {
  if (mode === 'performance') return true
  return new URLSearchParams(search).get('debug') === '1'
}

export function exposeDiagnostics(): void {
  if (!canvasDiagnostics.enabled || typeof window === 'undefined') return
  window.__CANVAS_DIAGNOSTICS__ = {
    snapshot: () => canvasDiagnostics.snapshot(),
    reset: () => canvasDiagnostics.reset(),
  }
}

declare global {
  interface Window {
    __CANVAS_DIAGNOSTICS__?: {
      snapshot: () => DiagnosticsSnapshot
      reset: () => void
    }
  }
}
