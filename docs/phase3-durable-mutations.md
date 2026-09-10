# Phase 3 — Mutation-boundary durability

Phase 3 turns the Phase 2 logical operation model into the normal Supabase durability boundary. The user-visible editor remains immediate: Excalidraw can emit many immutable versions while a pointer or text interaction is active, but a normal completed operation now sends only its final changed element state(s) to durable storage.

## Goal

Phase 1 measured an ordinary rectangle drag as **5 durable batches / 5 rows**. Phase 2 proved those writes represented **1 logical mutation / 1 final change** but deliberately retained the old 120 ms persistence timer. Phase 3 removes that timer from normal local editing and makes the proven logical mutation the persistence boundary.

The optimization must not weaken convergence or recovery. The Supabase tables, Realtime transport, version/nonce ordering, RLS, validation constraints, tombstones and private recovery history remain unchanged.

## Two-queue model

`SupabaseCanvasEditor` now separates two concepts that previously shared `pendingRef`:

1. **local unsynchronized state** — the newest local element version observed by the editor. It exists immediately and protects active work from stale authoritative echoes;
2. **durable-ready state** — only final changes from a committed `CanvasMutation`, plus explicitly justified safety checkpoints.

A network writer consumes only the durable-ready queue. This separation is important when one write is in flight and the next gesture has already started: the older write can never accidentally scoop up an intermediate version from the newer operation.

For every element ID, both queues retain only the newest version according to the existing Excalidraw-compatible `(version, versionNonce)` ordering.

## Normal durability boundary

The sequence for an ordinary pointer/text/discrete operation is:

1. Excalidraw renders local changes immediately;
2. each newer local element version updates the in-memory unsynchronized watermark and the active Phase 2 operation;
3. no generic 120 ms save fires while the operation is active;
4. pointer-up/text-end/discrete quiet completion commits one `CanvasMutation`;
5. its final `changes` are copied into the durable-ready queue;
6. a serialized Supabase upsert writes those final versions;
7. the client reads the authoritative versions back and reconciles them into the scene.

Multiple changed elements from one operation remain one mutation and can be written in one Supabase batch. Deletes remain versioned Excalidraw tombstones; no production physical DELETE path is introduced.

## Serialized writer and retry safety

Only one durable upsert may be in flight at once. If another mutation commits during that request, its final versions remain in the durable-ready queue and are drained after the current request settles.

A failed Supabase response or a rejected transport request requeues the exact attempted versions before retry. Authoritative readback can remove a queued version only when the server row is equal/newer under the existing conflict ordering. A newer local mutation therefore survives an older request or echo.

## Long-operation checkpoints

Waiting indefinitely for an operation boundary would make a very long drag/drawing/text session unnecessarily vulnerable to a crash or abrupt process loss. Phase 3 therefore permits an explicit safety checkpoint after **1.5 seconds** of a continuously active pointer/text operation.

The operation tracker exposes `snapshotActive()` for this purpose. A snapshot:

- contains the latest changed state per element at that moment;
- does **not** commit, split or reset the logical operation;
- may enter the durable-ready queue as a checkpoint;
- is superseded by later checkpoints/final versions using normal version ordering.

If the operation continues, checkpoints are bounded to the same 1.5-second cadence. Ordinary gestures finish before the first checkpoint and therefore persist only once.

`pagehide` and offline transitions also capture the editor's newest allowed state into memory before editing is locked. They do not start an unloading-page network request. On a successful reconnect/pageshow, the durable-ready state is retried normally.

## Diagnostics

The opt-in `?debug=1` overlay adds aggregate Phase 3 metrics without recording document content:

- durable-ready queue size;
- mutation-boundary flush count;
- long-operation checkpoint count/source;
- existing database write batch/row counts;
- existing logical mutation/change metrics.

These counters make the distinction between *one human operation*, *one normal durability boundary*, and *an exceptional checkpoint* observable in the same run.

## Verification contract

### Pure operation semantics

`tests/unit/operation-model.test.ts` retains all Phase 2 grouping tests and additionally proves that `snapshotActive()` returns the newest checkpoint state without committing the operation. Later versions still belong to the same final mutation.

### Real Excalidraw + Supabase path

`tests/live/operations.spec.ts` verifies against `canvas_ci_elements` that:

- a normal frame-paced rectangle drag becomes **1 logical mutation / 1 durable batch / 1 row** and the persisted row contains final geometry;
- a slow text-edit session becomes **1 logical mutation / 1 durable batch** and stores the complete final text;
- an unusually long pointer operation receives bounded checkpoint writes and still ends with the final geometry persisted.

The existing reconnect, teardown, deletion, cross-browser and compiled-production suites remain release gates.

## Performance evidence

The Phase 1/2 Chromium performance workflow is reused rather than replaced. Its report schema now calculates durable batches/rows as a delta for the measured gesture and records mutation-boundary flush/checkpoint counts as well as logical-operation metrics.

Final Phase 3 measurements must be pinned here from an exact branch commit and GitHub Actions artifact before merge. No timing or write-reduction result is claimed from local reasoning alone.

## Non-goals

Phase 3 does not change:

- database schema, RLS or validation;
- Supabase Realtime transport;
- the Excalidraw version conflict rule;
- presence/cursor behavior;
- product tools or UI semantics;
- offline collaborative editing policy;
- recovery-history schema or restore functions.

The phase is complete only when the exact final PR head passes the full quality suite and measured evidence demonstrates the intended normal-operation write reduction without breaking the existing collaboration/reconnect guarantees.
