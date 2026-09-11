# Architecture

## System boundary

Canvas has one public document: `main`. The runtime is deliberately small:

```text
GitHub Pages
  └─ React / Vite application
       └─ Excalidraw editor
            ├─ PostgREST upserts/reads ──> public.canvas_elements (Postgres)
            └─ Supabase Realtime
                 ├─ postgres_changes
                 ├─ presence
                 ├─ cursor broadcast
                 └─ active-operation preview broadcast
```

There is no application backend, room service or account service. Supabase is the authoritative persistence/realtime service. Phase 8 removed the previous tldraw + Cloudflare Worker implementation so the active source tree and dependency graph now match this production boundary.

## Identity

Each browser owns an anonymous local identity:

```ts
{
  deviceId: crypto.randomUUID(),
  displayName: "Guest ####",
  color: "<deterministic curated color>"
}
```

It is stored locally in the browser. `deviceId` is used as change attribution and Realtime presence metadata; it is not authentication. Renaming changes presence metadata, not an account record.

## Element persistence

`public.canvas_elements` stores one row per supported Excalidraw element. Realtime updates therefore modify only the elements that changed instead of repeatedly replacing a whole document blob.

Important columns:

| Column | Purpose |
| --- | --- |
| `id` | stable Excalidraw element ID / primary key |
| `version` | primary monotonic conflict version |
| `version_nonce` | deterministic tiebreaker for equal versions |
| `is_deleted` | collaborative tombstone |
| `element` | bounded JSON representation |
| `updated_by` | anonymous device attribution |
| `revision` | monotonic anti-entropy cursor |
| `updated_at` | authoritative server timestamp |

The production table permits only `rectangle`, `diamond`, `ellipse`, `line`, `arrow`, `freedraw`, `text`, and `frame`. Element IDs, updater strings, version ranges, JSON shape and serialized size are constrained in Postgres. `element.id`, `element.version`, `element.versionNonce`, and `element.isDeleted` must agree with their relational columns.

Public clients can SELECT/INSERT/UPDATE. They cannot physically DELETE production rows; deleting on the canvas is a normal versioned update with `is_deleted=true`.

`public.canvas_ci_elements` mirrors this contract and additionally permits DELETE only so automated tests can reset their isolated world.

## Conflict ordering

For a given element, `(version, version_nonce)` defines write order. The database trigger ignores an UPDATE whose tuple is not strictly newer than the stored tuple. This protects against delayed requests and reconnect races without whole-document last-write-wins behavior.

This is not a general CRDT implementation. It relies on Excalidraw's element version model and performs convergence at element granularity. Independent elements therefore do not conflict; concurrent writes to the same element resolve by the tuple above.

## Client synchronization

Startup sequence:

1. construct the local anonymous identity;
2. create the Supabase client and Realtime channel;
3. page through authoritative rows from Postgres;
4. hydrate Excalidraw with allowed elements only;
5. subscribe to Postgres Changes, Presence, cursor Broadcast and active-operation preview Broadcast;
6. reconcile the revision cursor;
7. only mark the editor `Live` after subscription and authoritative reconciliation complete.

Local editor changes have two separate paths. Every accepted Excalidraw element version is kept immediately in a local unsynchronized map so authoritative echoes cannot overwrite newer local work. Separately, the operation tracker groups intermediate versions into pointer, text or discrete `CanvasMutation` objects and retains only each affected element's final version. Only a committed mutation's final changes normally enter the durable-ready queue.

The durable writer is serialized: one Supabase upsert batch runs at a time, and a newer committed mutation remains queued while an older request is in flight. Completed writes are reconciled with authoritative rows to account for database conflict rejection and concurrent updates. Failed or rejected requests requeue the exact attempted versions before bounded retry.

Continuous pointer/text operations that remain active for at least 1.5 seconds expose a non-committing snapshot to the durability layer. That snapshot may be persisted as a safety checkpoint while the same logical operation continues collecting newer versions. Pointer-up/text-end still produces the final mutation and final durable state. `pagehide`/offline capture provides the same safety role for an interrupted active editor without starting a new unloading-page request.

## Ephemeral preview lane

Active pointer/text operations send coalesced operation snapshots over Supabase Broadcast before the durable boundary. Preview messages have a bounded protocol envelope, random tab-session sequence numbers, strict validation and a payload ceiling. They never advance the authoritative watermark or enter durability queues.

A remote preview renders only when it advances current authority and the local client has no conflicting pending edit for that element. Authoritative rows immediately retire equal/older previews; abandoned previews expire and restore the last authoritative element.

## Anti-entropy and large scenes

Realtime delivery is the fast durable-notification path, not the only correctness path. Every accepted production/CI row also receives a monotonic `revision`. On initial load, reconnect and focus reconciliation, the client asks for rows newer than its completed cursor in bounded pages. The cursor advances only after a complete ordered reconciliation, so a cancelled/failed page sequence cannot falsely claim convergence.

Scene application keeps direct ID lookup and immutable element stamps. Unchanged elements can therefore skip repeated network sanitization/validation work, while actual version/nonce/tombstone changes remain observable. Paginated hydration builds the authoritative state incrementally and commits the visible scene at a controlled boundary instead of depending on one unbounded table response.

## Save health and connection safety

Transport and durability are separate concepts. The UI can report Connecting, Synchronizing, Saved, Editing, Saving, Waiting to save, Retrying save, Confirming save, Reconnecting, Offline or Sync problem while separately exposing whether Realtime transport is `Live`.

`Saved` is strict: the client must be Live with no active local operation, no durable-ready work, no request in flight and no unresolved retry/confirmation state. Failed writes preserve exact pending versions and expose manual retry. The editor is not left writable when persistence cannot be trusted. Canvas deliberately does not advertise offline collaborative editing.

## Presence and cursors

Presence is Supabase Realtime channel state, not Postgres data. It contains anonymous display name/color/device session metadata required by collaborator UI. Cursor movement and active-operation previews are ephemeral Broadcast traffic and are throttled/coalesced rather than persisted. Preview payloads are independently validated because they bypass Postgres row constraints.

Closing a client removes its presence according to Realtime channel lifecycle. No collaborator history table exists.

## Media exclusion

Media exclusion is enforced at two layers:

1. browser paste/drop handlers block files and image payloads and filter unsupported Excalidraw elements;
2. Postgres `CHECK` constraints reject every element type outside the vector allowlist and cap JSON size.

There is no object-storage bucket or upload API in this product.

## Recovery architecture

`canvas_admin` is a private schema with no grants to `public`, `anon`, or `authenticated`.

A `BEFORE UPDATE OR DELETE` trigger on `canvas_elements` records the previous row in `canvas_admin.element_history` together with `txid_current()`. History is capped at 20 previous records per element. `canvas_admin.recovery_transactions` summarizes recoverable transactions. `canvas_admin.restore_transaction(txid)` restores the latest captured prior row for each affected element while assigning a version greater than current state, so restores propagate normally over Realtime.

The restore function is revoked from public browser roles. Recovery is an owner SQL operation, not a public HTTP endpoint.

## Hosting and base path

Vite defaults to `/canvas/` for repository GitHub Pages. A custom-domain root can build with `VITE_BASE_PATH=/`. GitHub Actions uploads the generated `dist` artifact only after quality gates pass and then verifies the deployed HTTPS application.

## PWA behavior

The application includes a manifest, icons and a small service worker for application-shell caching. This improves repeat loading/installability; it does not turn realtime data into an offline-first database. Live editing still requires Supabase connectivity.

## Test architecture

There are four active evidence layers:

- production-model unit tests for browser-independent synchronization/configuration behavior;
- `test:live`, which launches real Excalidraw clients against `canvas_ci_elements` in Chromium, Firefox and WebKit;
- `test:production`, which builds the compiled `/canvas/` bundle, serves it with `vite preview`, and exercises the shipped path in all three engines;
- the manual performance workflow, which measures the same production editor against the isolated CI table.

`npm run audit:architecture` additionally fails if the retired tldraw/Wrangler/Worker stack returns. The isolated CI table exists specifically so integration tests never mutate the shared production canvas.

## Future seams

The current schema deliberately leaves simple seams for future `world_id` and authenticated `user_id` fields, but those concepts are not implemented today. Adding them must not weaken the current one-world behavior until there is a real product requirement.
