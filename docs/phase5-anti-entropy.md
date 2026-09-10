# Phase 5 — Revision-cursor anti-entropy

Phase 5 makes the production Excalidraw + Supabase client self-healing when an authoritative Realtime event is missed. Supabase Postgres remains the only durable document authority; Realtime and Phase 4 Broadcast remain acceleration paths.

## Goal

A healthy WebSocket subscription is not a proof that every database change was observed by a particular browser. Before Phase 5, Canvas repaired missed changes on reconnect because every successful channel join performed an authoritative reload, but a client that stayed connected could remain stale indefinitely if a Postgres Changes event was lost.

Phase 5 adds a lightweight anti-entropy lane with an explicit server revision cursor. It also removes the assumption that initial hydration fits in one Supabase REST response.

## Server revision

Migration `20260910215302_add_canvas_anti_entropy_revisions.sql` adds a server-owned `revision bigint` to both `canvas_elements` and `canvas_ci_elements`.

- every accepted INSERT or UPDATE receives a fresh monotonically increasing revision from its table-specific PostgreSQL sequence;
- revisions are unique within a table;
- gaps are valid and have no semantic meaning;
- stale element writes are still rejected by the existing `(version, version_nonce)` conflict rule before they can replace authority;
- the existing equal-version lower-nonce-wins Excalidraw ordering is unchanged;
- IDs remain immutable;
- no revision value is accepted as client authority: the trigger overwrites it on every accepted write.

The migration uses a temporary sequence-backed column default only to populate existing rows atomically, then removes that default. Future revision assignment is owned by the existing keep-newest trigger.

## Paginated hydration

Initial synchronization reads rows in ascending revision order in pages of 500. The client follows `revision > cursor` until a short/empty page is observed.

This avoids relying on a single REST response containing the complete world. If an element is updated while hydration is already in progress, its new server revision moves it forward in the stream so the later revision is still observed.

An empty first page is significant: it clears any stale editor scene during an authoritative initial synchronization.

## Anti-entropy cursor

The client maintains a private reconciliation cursor representing the highest server revision covered by a completed authoritative scan.

The critical rule is that **Realtime events do not advance this cursor**. A later Realtime event may arrive before an earlier one, or one event may be missed entirely. Advancing the cursor from WebSocket delivery could therefore skip an unseen revision.

Only a completed revision scan advances the cursor. If the scan fails, is cancelled by lifecycle change, or loses its Live/online precondition, the previous successful cursor remains the retry point.

## Reconciliation triggers

While Canvas is Live and online, a reconciliation pass may run:

- every 15 seconds;
- when the window regains focus;
- when the document becomes visible again.

Only one pass can be in flight. A pass does not start during an active pointer/text operation, so background repair cannot interfere with a user's continuous local edit.

A failed background reconciliation is recorded in diagnostics but does not turn a healthy Realtime connection into an Error state. The next pass retries from the previous successful cursor. Existing reconnect synchronization remains unchanged and continues to gate editing until the authoritative load completes.

## Interaction with Phase 3 and Phase 4

Phase 5 does not weaken either earlier contract:

- Phase 3 still persists one normal final mutation batch and keeps its 1.5-second exceptional long-operation checkpoints;
- the post-write authoritative ACK readback is revision-aware;
- Phase 4 previews remain ephemeral and never advance durable authority or the anti-entropy cursor;
- preview-origin quarantine still prevents remote preview frames from entering the local mutation/durability pipeline;
- normal Realtime Postgres Changes remain the fast authoritative delivery path.

## Diagnostics

`?debug=1` exposes aggregate, content-free Phase 5 signals:

- reconciliation cursor;
- anti-entropy run/success/failure counts;
- rows read by reconciliation;
- anti-entropy duration p95.

For the real browser recovery test only, `?debug=1&dropRealtime=1` deliberately ignores incoming Postgres Changes in that browser and counts them as `realtimeChangesDroppedForDiagnostics`. Broadcast previews and REST authority remain functional. This fault injection is gated behind diagnostics and exists only to prove that anti-entropy repairs a client without reconnecting or reloading.

## Verification contract

### Unit

`tests/unit/revision-sync.test.ts` proves:

- multi-page scans return the final revision cursor;
- cancellation never publishes a partial cursor;
- unordered/non-advancing revision pages fail closed;
- an empty first page is delivered so initial hydration can clear stale state.

### Database

The applied migration was verified directly against the isolated CI table:

- a new row received revision 1;
- an accepted newer element version received revision 2;
- a deliberately stale update affected zero rows and left version, nonce, revision and updater unchanged;
- the probe row was then physically removed from the CI table.

Existing production rows were backfilled with non-null unique revisions. The migration does not modify application authentication, RLS policy semantics, recovery visibility or the open-link product model.

### Real Excalidraw + Supabase

`tests/live/anti-entropy.spec.ts` deliberately drops an authoritative Postgres Changes event on client B while client A creates a real rectangle. It requires:

1. the database to contain the final rectangle;
2. B to record that the Realtime event was intentionally dropped;
3. the Phase 4 preview on B to expire without becoming durable authority;
4. B to remain connected;
5. a focus-triggered revision scan to recover and render the missing durable rectangle without reload/reconnect;
6. anti-entropy diagnostics to prove a successful authoritative read occurred.

All existing operation, preview, conflict, reconnect, page-lifecycle, cross-browser E2E, compiled-production and Pages-deployment gates remain mandatory.

## Non-goals

Phase 5 does not add offline editing, a CRDT, character-level text merging, accounts, rooms, a second database, a new server process, user-visible sync controls, or a replacement for Supabase Realtime. It is a bounded convergence safety net around the existing architecture.
