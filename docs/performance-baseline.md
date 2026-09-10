# Canvas performance baseline

Measured: **2026-09-09T23:13:43.160Z**

Engine: **Excalidraw + Supabase**  
Browser: **Chromium**  
Measured source SHA: `1dc7847c74f527fe416040f0fa319e1b7272da69`  
Workflow run: `34415856062` (`Canvas performance evidence`)  
Artifact: `canvas-performance` / `10129064595`

> These are measurements, not release thresholds. GitHub-hosted CI performance varies with runner load and geography. Future phases should compare equivalent benchmark runs rather than treating this machine as universal hardware.

## Headline findings

1. **The current durable-sync path writes too often during one gesture.** The measured rectangle drag produced **5 durable Supabase write batches / 5 rows**, giving Phase 2–3 a concrete baseline to improve.
2. **Peer visibility is much slower than local rendering.** Local rectangle gesture → visible change on the second client measured **746 ms**, while incoming Realtime message → next animation frame measured **20.1 ms p95**. This strongly suggests transport/persistence cadence is the dominant collaboration delay rather than final browser paint.
3. **Durable database acknowledgement is material.** Supabase write latency measured **534 ms p95** in this run.
4. **Panning scales substantially better than element mutation.** At 10,000 local fixture elements, pan frame p95 was **19.6 ms**, while moving one element was **78.8 ms p95** and moving twenty was **83.3 ms p95**.
5. **Large-scene startup has a visible cost.** The synthetic 10,000-element scene took **909.6 ms** for the measured initial render and used about **155.4 MiB** of JS heap in Chromium.
6. **Reconnect currently performs reasonably on this small CI world.** Offline → visible Live measured **829 ms**, with the internal reconnect interval measured at **531.6 ms p95** and zero in-flight writes afterward.

These results support the existing roadmap: operation boundaries and durable-write reduction first, then an ephemeral Broadcast preview lane. They do **not** justify adding more visible Canvas features.

## Scene-scale measurements

The 100 / 1,000 / 5,000 / 10,000-element fixtures run entirely inside a standalone Excalidraw performance harness. Synthetic fixture elements are never written to Supabase.

| Elements | Fixture generation | Initial render | Pan p50 / p95 | Move 1 p50 / p95 | Move 20 p50 / p95 | Select 20 | Serialize | JSON size | JS heap |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 3.0 ms | 43.0 ms | 16.7 / 16.8 ms | 16.7 / 16.8 ms | 16.6 / 19.2 ms | 28.6 ms | 0.4 ms | 42.3 KiB | 26.4 MiB |
| 1,000 | 6.4 ms | 54.0 ms | 16.7 / 16.8 ms | 21.6 / 29.7 ms | 21.8 / 28.8 ms | 3.0 ms | 2.9 ms | 426.1 KiB | 19.6 MiB |
| 5,000 | 18.8 ms | 214.2 ms | 16.6 / 20.8 ms | 43.2 / 59.4 ms | 48.3 / 60.3 ms | 21.0 ms | 14.1 ms | 2,138.6 KiB | 49.5 MiB |
| 10,000 | 27.9 ms | 909.6 ms | 16.7 / 19.6 ms | 68.8 / 78.8 ms | 72.3 / 83.3 ms | 21.5 ms | 20.2 ms | 4,284.1 KiB | 155.4 MiB |

The unusually lower heap reading at 1,000 elements than at 100 elements is retained exactly as observed. Heap measurements are snapshots affected by garbage collection; use repeated equivalent runs for trend analysis rather than expecting monotonic values from a single sample.

## Realtime and durability measurements

The multiplayer section used two real browser contexts, the production `SupabaseCanvasEditor`, and only the isolated `canvas_ci_elements` table.

| Metric | Baseline |
| --- | ---: |
| Two clients open → both Live | 2,650 ms |
| Local rectangle gesture → rendered on peer | 746 ms |
| Supabase durable write p95 | 534.0 ms |
| Realtime message receipt → next rendered frame p95 | 20.1 ms |
| Initial hydration p95 | 1,892.5 ms |
| Offline → Live observed | 829 ms |
| Internal reconnect p95 | 531.6 ms |
| Durable write batches for measured gesture | 5 |
| Rows sent in durable writes | 5 |
| Writes per pointer gesture p95 | 5.0 |
| In-flight writes after reconnect | 0 |

### Measurement semantics

- `Supabase durable write` observes Canvas REST write requests from the browser. It does not expose secret credentials or element payloads.
- `Realtime message receipt → next rendered frame` measures arrival of a Supabase `postgres_changes` WebSocket message to the next `requestAnimationFrame`. It is a useful browser-side receive/paint boundary, **not** a precise measurement of the internal Excalidraw reconciliation callback.
- `Writes per pointer gesture` counts durable REST write batches seen from pointer-down through a short post-pointer-up quiet period.
- The displayed pending value currently means **in-flight durable HTTP writes**, not the editor's private unsent `pendingRef` map. Exact operation-queue depth becomes more meaningful once Phase 2 introduces explicit operations.
- `Local gesture → peer rendered` uses a real drawing gesture on client A and waits until client B's Excalidraw canvas pixels change; it therefore includes local persistence cadence, network/database work, Realtime delivery, reconciliation, and paint.

## Phase 1 instrumentation now available

Open a normal Canvas URL with `?debug=1` to enable local diagnostics. No metrics are sent to an analytics service and no element contents are recorded.

The overlay and `window.__CANVAS_DIAGNOSTICS__.snapshot()` expose:

- runtime FPS and frame duration;
- frames over 50 ms;
- authoritative Canvas rows observed and active-element count;
- in-flight durable writes;
- Supabase REST write latency, batch count, row count, and failures;
- hydration-query latency;
- initial synchronization and reconnect duration;
- incoming Postgres Realtime messages to the next animation frame;
- durable writes generated by pointer gestures;
- JS heap where the browser exposes it.

`window.__CANVAS_DIAGNOSTICS__.reset()` resets only local counters and samples.

## Reproduction

```bash
npm run test:performance
npm run performance:report
```

The manual **Canvas performance evidence** workflow executes the benchmark in a version-pinned Playwright Chromium container and retains:

- `artifacts/performance.json` — machine-readable raw measurements;
- `artifacts/performance-baseline.md` — generated report;
- `artifacts/performance-run.json` — Playwright evidence;
- traces/screenshots on failure.

## Phase 2 comparison contract

When Phase 2 is implemented, rerun the same benchmark and compare at least:

- durable writes per gesture;
- local gesture → peer-render latency;
- durable write p95;
- reconnect duration;
- 1k / 5k / 10k move-one and move-20 frame p95;
- initial render and heap at large scene sizes.

Do not redefine the baseline or change thresholds after seeing Phase 2 results. If the benchmark methodology itself changes, record both the old and new methodology explicitly.