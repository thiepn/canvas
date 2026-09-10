# Architecture

## System boundary

Canvas has one public document: `main`. The production runtime is deliberately small:

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

There is no application backend in the normal data path, no room service and no account service. Supabase is the authoritative persistence/realtime service. The previous tldraw + Cloudflare Worker code is retained only for historical regression tests and is compile-time excluded from normal production selection.

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

`public.canvas_elements` stores one row per supported Excalidraw element. This is intentional: realtime updates modify only the elements that changed instead of repeatedly replacing a whole document blob.

Important columns:

| Column | Purpose |
| --- | --- |
| `id` | stable Excalidraw element ID / primary key |
| `version` | primary monotonic conflict version |
| `version_nonce` | deterministic tiebreaker for equal versions |
| `is_deleted` | collaborative tombstone |
| `element` | bounded JSON representation |
| `updated_by` | anonymous device attribution |
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
3. load authoritative rows from Postgres;
4. hydrate Excalidraw with allowed elements only;
5. subscribe to Postgres Changes, Presence, cursor Broadcast and active-operation preview Broadcast;
6. only mark the editor `Live` after subscription and authoritative reconciliation complete.

Local editor changes have two separate paths. Every accepted Excalidraw element version is kept immediately in a local unsynchronized map so authoritative echoes cannot overwrite newer local work. Separately, the Phase 2 operation tracker groups those intermediate versions into pointer, text or discrete `CanvasMutation` objects and retains only each affected element's final version. Only a committed mutation's final changes enter the durable-ready queue.

The durable writer is serialized: one Supabase upsert batch runs at a time, and a newer committed mutation remains queued while an older request is in flight. Completed writes are reconciled with an authoritative read to account for database conflict rejection and concurrent updates. Failed or rejected requests requeue the exact attempted versions before bounded retry.

Phase 4 adds a separate ephemeral preview lane for continuous pointer/text operations. At most one coalesced operation snapshot is sent roughly every 45 ms over Supabase Broadcast, plus the final operation state at commit. Preview messages have a bounded protocol envelope, random tab-session sequence numbers and a 512 KiB payload ceiling. They never advance the authoritative watermark or enter either local durability queue. A remote preview is rendered only when it advances the current authoritative version and the local client has no pending edit for that element. Authoritative rows immediately retire equal/older previews; abandoned previews expire after 1.4 seconds and restore the last authoritative element.

Continuous pointer/text operations that remain active for at least 1.5 seconds expose a non-committing snapshot to the durability layer. That snapshot may be persisted as a safety checkpoint while the same logical operation continues collecting newer versions. Pointer-up/text-end still produces the final mutation and final durable state. `pagehide`/offline capture performs the same safety role for an interrupted active editor without starting a new unloading-page request.

Remote Postgres changes are merged into the Excalidraw scene. Tombstones remove elements from the visible scene. Echoes from the same device are harmless because ordering is idempotent. A server echo may prune an equal/losing local or durable-ready version, but never a newer one.

## Connection safety

The UI surfaces Connecting, Synchronizing, Live, Reconnecting, Offline and Error states. The editor is not left writable when persistence cannot be trusted. Canvas deliberately does not advertise offline collaborative editing: cached application assets may load, but unsafe edits are not queued as though they were authoritative.

## Presence and cursors

Presence is Supabase Realtime channel state, not Postgres data. It contains the anonymous display name/color/device session metadata required by collaborator UI. Cursor movement and active-operation previews are ephemeral Broadcast traffic and are throttled/coalesced rather than persisted. Preview payloads are independently validated because they bypass Postgres row constraints.

Closing a client removes its presence according to Realtime channel lifecycle. No collaborator history table exists.

## Media exclusion

Media exclusion is enforced at two layers:

1. browser paste/drop handlers block files and image payloads and filter unsupported Excalidraw elements;
2. Postgres `CHECK` constraints reject every element type outside the vector allowlist and cap JSON size.

There is no object-storage bucket or upload API in this product.

## Recovery architecture

`canvas_admin` is a private schema with no grants to `public`, `anon`, or `authenticated`.

A `BEFORE UPDATE OR DELETE` trigger on `canvas_elements` records the previous row in `canvas_admin.element_history` together with `txid_current()`. This has two useful properties:

- a large destructive operation affecting many elements naturally groups under one database transaction ID;
- recovery is incremental and does not require a wake-up timer, scheduler, or full-document copy after every pointer movement.

History is capped at 20 previous records per element. `canvas_admin.recovery_transactions` summarizes recoverable transactions. `canvas_admin.restore_transaction(txid)` restores the latest captured prior row for each affected element while assigning a version greater than current state. Restores therefore propagate normally over Realtime.

The restore function is revoked from public browser roles. Recovery is an owner SQL operation, not a public HTTP endpoint.

## Hosting and base path

Vite defaults to `/canvas/` for repository GitHub Pages. A custom-domain root can build with `VITE_BASE_PATH=/`. GitHub Actions uploads the generated `dist` artifact only after quality gates pass.

## PWA behavior

The application includes a manifest, icons and a small service worker for application-shell caching. This improves repeat loading/installability; it does not turn realtime data into an offline-first database. Live editing still requires Supabase connectivity.

## Test architecture

There are three categories:

- pure/unit and historical Worker regression tests;
- `test:live`, which launches real browser clients against `canvas_ci_elements` using the production editor;
- `test:production`, which first builds the compiled `/canvas/` bundle, serves it with `vite preview`, and then persists a real vector through `canvas_ci_elements`.

The isolated CI table exists specifically so integration tests never mutate the shared production canvas.

## Future seams

The current schema deliberately leaves simple seams for future `world_id` and authenticated `user_id` fields, but those concepts are not implemented today. Adding them must not weaken the current one-world behavior until there is a real product requirement.
