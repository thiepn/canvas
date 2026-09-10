# Phase 4 — Ephemeral Broadcast previews

Phase 4 adds a low-latency collaboration lane without weakening the Phase 3 durability contract. Continuous pointer and text operations can now be rendered by peers while they are still in progress. PostgreSQL remains the only authoritative document state.

## Goal

Phase 3 intentionally waits for the logical operation boundary before the normal durable write. That cuts ordinary write volume from five database batches to one, but a peer normally sees an active drag/drawing/text edit only after the final upsert has crossed REST, Postgres and Postgres Changes.

Phase 4 separates *what peers may preview now* from *what the document has durably committed*:

1. Excalidraw renders every local frame immediately.
2. The existing operation tracker retains the newest changed element per active pointer/text operation.
3. A coalesced snapshot is Broadcast at most once per 45 ms while the operation is active.
4. Operation commit sends the final preview state immediately and independently queues the same final state for Phase 3 durability.
5. The durable writer still performs one normal serialized Postgres upsert for the completed operation.
6. The authoritative Postgres row retires the preview when it catches up.

Discrete style/keyboard bursts are not previewed. They already commit after a short quiet boundary and do not justify a second transport path.

## Preview protocol

`app/canvas/preview-lane.ts` defines version 1 of the ephemeral envelope:

- protocol version;
- anonymous device ID;
- random tab-session ID;
- monotonic sequence number within that session;
- send timestamp for diagnostics/context only;
- source (`pointer` or `text`);
- one to 64 latest Excalidraw elements.

The serialized envelope is capped at 512 KiB. Element IDs/version fields must be bounded and well formed. Before an element enters Excalidraw, the browser additionally checks allowed Canvas types, finite geometry, bounded point arrays/text/link values and runs it through Excalidraw restoration in a guarded path. Invalid messages increment aggregate diagnostics and are discarded.

A random session ID is important: a browser reload may restart sequence numbering at 1 without being mistaken for a replay from the prior tab process.

## Non-authoritative state

Remote previews live in their own in-memory map. They never:

- update `shadowRef`, the authoritative version watermark;
- enter `pendingRef`, the local conflict-protection queue;
- enter `durablePendingRef`, the database writer queue;
- create history/recovery records;
- survive a channel lifecycle/reconnect.

A preview can render only if its `(version, versionNonce)` advances the current authoritative row and there is no local pending edit for that element. Active local work always wins visually until the real durability conflict resolves.

When a newer/equal authoritative row arrives, the matching preview is discarded. If no authoritative row arrives, the preview expires 1.4 seconds after receipt. Expiry restores the last known authoritative element, or removes an uncommitted newly-created preview. The restore only occurs if the currently visible element still exactly matches that preview, so newer local or authoritative work cannot be rolled back by an expiry timer.

`pagehide`, offline transitions and channel teardown clear previews before interrupted local state is captured. This prevents another user's ephemeral frame from ever being mistaken for crash-recovery work owned by the local client.

## Diagnostics

The existing opt-in `?debug=1` diagnostics add aggregate, content-free measurements:

- preview broadcasts/elements sent;
- preview broadcasts/elements received;
- rejected/stale/skipped preview counts;
- send failures;
- active remote preview count;
- expiry count;
- preview receipt to next animation frame.

No preview element content is copied into diagnostics.

## CI isolation fix

The live quality suite and the manual performance workflow both mutate the single `canvas_ci_elements` table. Workflow-level concurrency previously isolated only runs of the *same workflow/ref*, so a performance workflow could delete rows while a quality workflow was executing.

Both mutating jobs now share the job-level concurrency group `canvas-shared-supabase-ci` with cancellation disabled. This preserves deterministic cleanup without serializing the Pages deployment job, which does not mutate the CI table.

## Verification contract

### Unit

`tests/unit/preview-lane.test.ts` proves:

- pointer/text envelopes round-trip;
- malformed, empty, discrete and oversized messages fail closed;
- session sequence replay/spoofing is rejected while a new tab session may restart at sequence 1;
- previews never render over active local pending work and must advance authoritative ordering.

### Real Excalidraw + Supabase

`tests/live/previews.spec.ts` proves in each supported browser engine:

- a rectangle held mid-drag appears on a peer through Broadcast before the first database row/write exists;
- the test's preview wait is shorter than the 1.5-second Phase 3 checkpoint, preventing durability from making a broken preview test pass accidentally;
- pointer release still produces one normal durable write and zero long-operation checkpoints;
- a valid abandoned preview changes the peer temporarily but never changes Postgres, then expires back to the exact authoritative geometry.

Existing operation, conflict, reconnect, deletion, mobile, wheel, compiled-production and deployment gates remain intact.

## Non-goals

Phase 4 does not change the Supabase schema, RLS, recovery history, conflict ordering, one-world access model, offline-editing policy, product tool set or Phase 3 durability boundary. Broadcast is an acceleration hint only. A client that misses every preview still converges from authoritative Postgres state.
