# Phase 7 — Sync health and recovery UX

Phase 7 makes Canvas durability and recovery state explicit in the production shell. It does not change the Phase 3 durability boundary, Phase 4 preview protocol, Phase 5 anti-entropy semantics, or Phase 6 scene indexing. It changes what the client can truthfully tell the user about those systems.

## Why this phase exists

Before Phase 7, the header exposed only transport-oriented connection states such as `Live`, `Offline`, and `Reconnecting`. That was accurate for the Realtime channel but incomplete for durability:

- a client could be connected while a completed mutation was still being written;
- a failed write could be queued for retry while the header still looked `Live`;
- an accepted write whose authoritative readback failed could not safely be described as fully confirmed;
- connection recovery was automatic but did not expose an immediate retry action;
- the six-second notification toast was useful context, but it was not a durable representation of unresolved save state.

Phase 7 separates **transport health** from **save health**.

## State model

`app/canvas/sync-health.ts` derives one user-facing health state from five content-free inputs:

- connection state;
- number of durable elements waiting to save;
- whether a durable request is currently in flight;
- whether a local logical operation is still active;
- whether the last save needs retry or authoritative confirmation.

The possible primary labels are:

- `Connecting…`
- `Synchronizing…`
- `Saved`
- `Editing`
- `Saving…`
- `Waiting to save…`
- `Retrying save…`
- `Confirming save…`
- `Reconnecting…`
- `Offline`
- `Sync problem`

A secondary `Live` transport label remains visible whenever the Supabase collaboration channel is healthy. This is intentionally separate from the primary save-health label: `Retrying save… · Live` is a valid and useful state, whereas a single `Live` label would hide the durability problem.

## Exact `Saved` invariant

Canvas may display `Saved` only when all of the following are true:

1. the shared connection is `Live`;
2. no local logical operation is still active;
3. no durable mutation is queued;
4. no durable write request is in flight;
5. there is no unresolved retry or confirmation state.

Pointer/text operations mark local editing immediately. Discrete operations also enter the local-editing state as soon as a new local immutable element version enters the pending path, and the logical mutation commit clears that state while moving final versions into the durable queue.

This prevents a short false-`Saved` window during style/keyboard/discrete quiet-window batching.

## Save failure and confirmation behavior

### Failed write

The existing Phase 3 rule is unchanged: the exact attempted element versions are requeued before retry. Phase 7 additionally exposes that state persistently as `Retrying save…` after the failed request returns.

The persistent recovery banner states that completed changes are still held in the tab and provides **Retry now**. The automatic bounded retry continues to run; the manual action simply asks the same durability path to retry immediately.

### Successful write but failed readback

A successful Supabase upsert followed by a failed authoritative readback is shown as `Confirming save…`, not `Saved` and not `Retrying save…`.

Canvas then uses the existing authoritative reconciliation path to verify the latest shared state. Once anti-entropy or reconnect hydration completes successfully and no durable queue remains, the confirmation state clears.

### Authoritative supersession

If authoritative state later accepts or supersedes all queued work, the UI clears a stale retry state when the durable queue reaches zero. This keeps recovery messaging aligned with the same version-ordering rules that govern synchronization.

## Connection recovery

Non-Live states continue to pause editing. The recovery banner now uses the same derived health model and explains whether completed changes are waiting in the current tab.

When the browser is online and the channel is in `Error` or `Reconnecting`, the banner provides **Retry now**. This resets the reconnect backoff and starts a new connection attempt without requiring a page reload.

Offline state remains non-editable. Phase 7 does not introduce offline-authoritative editing.

## Accessibility

The compact header health indicator is one polite atomic live region:

- `role="status"`;
- `aria-live="polite"`;
- `aria-atomic="true"`;
- a complete accessible label containing the primary health state and its explanation.

Recovery/save banners themselves are persistent visual guidance rather than additional competing live regions. Existing transient notices retain their status role for one-off validation/errors.

The primary indicator also exposes `data-sync-health` and `data-connection-state` for deterministic production-path testing without requiring tests to infer internal state from color.

## Verification contract

### Unit

`tests/unit/sync-health.test.ts` verifies:

- `Saved` is reachable only from a completely idle Live state;
- active local work, queued work, and in-flight writes cannot claim Saved;
- failed saves expose retry state;
- accepted-but-unconfirmed writes expose confirmation state;
- connection loss outranks ordinary save activity;
- recovery banners are limited to connection/recovery states.

### Real browser + Supabase

`tests/live/sync-health.spec.ts` adds two production-path scenarios:

1. every live browser project must transition `Saved → Offline → ... → Saved` using the real application and browser offline mode, with editing-paused recovery guidance visible while disconnected;
2. Chromium injects a real REST transport failure for the CI Supabase table, creates a rectangle through Excalidraw, proves no row was durably stored, requires `Retrying save…` plus the persistent manual retry action, unblocks the transport, clicks **Retry now**, and requires the row to persist and health to return to `Saved`.

All existing operation, lifecycle, Broadcast preview, anti-entropy, conflict, reconnect, large-scene, E2E, and compiled-production suites remain mandatory.

## Non-goals

Phase 7 does not add accounts, offline editing, background sync, a service worker mutation queue, a new backend, a new durability cadence, or a second source of authority. Postgres remains authoritative; Broadcast remains ephemeral; the browser retains only the already-existing in-memory retry state for the life of the tab.
