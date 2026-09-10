# Phase 2 — Logical Canvas operation model

Phase 2 introduces a semantic boundary between **raw Excalidraw element updates** and **one human operation**. It intentionally does **not** change the durable Supabase write cadence, schema, Realtime transport, or conflict rules. That optimization belongs to Phase 3.

## Why this exists

The Phase 1 production benchmark measured one ordinary rectangle gesture as **5 durable Supabase write batches / 5 rows**. Before reducing those writes, Canvas needs an explicit answer to a more important question: which intermediate element versions belong to the same human action?

The Phase 2 model answers that without changing persistence.

## Model

`app/canvas/operation-model.ts` defines:

- `CanvasMutation` — one logical user operation;
- `CanvasElementChange` — final upsert or delete/tombstone for one affected object;
- operation source — `pointer`, `text`, or `discrete`;
- mutation kind — `create`, `update`, `delete`, or `mixed`;
- mutation ID, device ID, start/commit timestamps, duration, and final changed-object list.

The tracker keeps only the newest observed element state per ID within an operation. Intermediate geometry/version churn is deliberately discarded from the logical mutation.

### Boundaries

- **Pointer:** pointer-down on the interactive canvas opens an operation; pointer-up/cancel closes it after a short settle window so Excalidraw's final immutable element version stays in the same gesture.
- **Text:** `AppState.editingTextElement` opens a text operation and it remains open through typing pauses until editing actually ends.
- **Discrete:** keyboard/style/delete/duplicate/group-like changes outside a continuous pointer/text interaction share a short quiet boundary.
- **Remote state:** authoritative Supabase rows advance a separate observed-scene watermark but never create local mutations. A stale server echo cannot be mistaken for a later local action.

The existing `pendingRef` / 120 ms Supabase persistence path remains unchanged. Phase 2 observes operations alongside it; Phase 3 can safely replace intermediate durable scheduling with final `CanvasMutation.changes`.

## Verification

### Unit semantics

`tests/unit/operation-model.test.ts` verifies, among other cases:

- eight successive versions of one rectangle during a drag → **1 mutation / 1 final change**;
- twenty selected objects changing across twelve simulated drag frames → **1 mutation / 20 final changes**;
- a slow text edit with one-second pauses → **1 text mutation**;
- deletion → an explicit final tombstone change;
- an empty pointer interaction → no mutation;
- beginning a pointer operation cleanly closes a prior discrete operation.

### Real browser integration

`tests/live/operations.spec.ts` runs through the real Excalidraw + Supabase CI path in the normal live-browser matrix. It verifies that a long real rectangle gesture is one logical mutation even while the unchanged Phase 1 durability timer continues producing multiple writes, and that a slow real text-edit session remains one logical text mutation.

### Measured Phase 2 evidence

Pinned measurement source: `65a01cd4562c88588adee392a53ac86475fabee8`  
Workflow: `34462164398` (`Canvas performance evidence`)  
Artifact: `canvas-performance` / `10146030298`

| Metric | Phase 1 | Phase 2 measurement |
| --- | ---: | ---: |
| Durable write batches / rectangle gesture | **5** | **5** |
| Rows sent / rectangle gesture | **5** | **5** |
| Logical mutations / rectangle gesture | not modeled | **1** |
| Final logical changes / rectangle gesture | not modeled | **1** |
| Local gesture → peer visible | 746 ms | 779 ms |
| Offline → Live | 829 ms | 833 ms |
| 10k initial render | 909.6 ms | 920.9 ms |

The unchanged **5 durable writes** are expected and important: Phase 2 did not hide a Phase 3 optimization inside the semantic refactor. The new result is that Canvas can now prove those five transport-level writes belong to **one human operation**.

Absolute timing differences between the Phase 1 and Phase 2 GitHub-hosted runs are not attributed to this phase. Runner load, network geography, garbage collection, and Supabase latency vary. The standalone 10k fixture also does not instantiate the live operation tracker, making its run-to-run variation useful as a noise reminder rather than evidence of operation-model cost.

## Diagnostics

With `?debug=1`, the existing local-only overlay now also exposes aggregate operation information:

- logical mutation count;
- final changes per mutation;
- mutation duration;
- last mutation source and kind.

It does not retain element IDs, text, geometry, styles, or other document content.

## Phase 3 contract

Phase 3 should preserve this exact semantic model and change only how durable writes consume it:

1. keep local Excalidraw rendering immediate;
2. keep collecting intermediate states inside the active operation;
3. enqueue the final `CanvasMutation.changes` at the operation boundary;
4. retain safety checkpoints only where explicitly justified for unusually long operations;
5. rerun the same Phase 1 benchmark and require a typical rectangle drag to move from multiple durable batches toward one final durable commit without increasing lost-operation risk.

Phase 2 is successful when logical operation identity is reliable enough that Phase 3 no longer needs to guess persistence boundaries from a generic debounce timer.

## Phase 3 handoff status

Phase 3 consumes this boundary without changing the Phase 2 grouping semantics: intermediate editor versions remain local, committed `CanvasMutation.changes` become the normal durable-write input, and only explicit long-operation/lifecycle checkpoints can persist before an operation ends. See [phase3-durable-mutations.md](./phase3-durable-mutations.md).

