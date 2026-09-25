# Architecture

## System boundary

Canvas has one public document: `main`. The runtime is deliberately small:

```text
GitHub Pages
  └─ React / Vite application
       └─ Excalidraw editor
            ├─ PostgREST upserts/reads ──> public.canvas_elements (Postgres)
            ├─ Storage upload/download ──> canvas-assets / canvas-ci-assets
            └─ Supabase Realtime
                 ├─ postgres_changes
                 ├─ presence
                 ├─ cursor broadcast
                 └─ active-operation preview broadcast
```

There is no application backend, room service or account service. Supabase is the authoritative persistence/realtime service. The previous tldraw + Cloudflare Worker implementation has been removed, so the active source tree and dependency graph match this production boundary.

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

The production table permits only `rectangle`, `diamond`, `ellipse`, `line`, `arrow`, `freedraw`, `text`, `frame`, and `image`. Image rows are accepted only when `status='saved'`, `fileId` is a 64-character SHA-256 hex digest, and the Excalidraw image scale contract is present. Element IDs, updater strings, version ranges, JSON shape and serialized size are constrained in Postgres. `element.id`, `element.version`, `element.versionNonce`, and `element.isDeleted` must agree with their relational columns.

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

`Saved` is strict: the client must be Live with no active local operation, no durable-ready work, no request in flight, no active image upload/download and no unresolved retry/confirmation state. Failed writes preserve exact pending versions and expose manual retry. The editor is not left writable when persistence cannot be trusted. Canvas deliberately does not advertise offline collaborative editing.

## Presence and cursors

Presence is Supabase Realtime channel state, not Postgres data. It contains anonymous display name/color/device session metadata required by collaborator UI. Cursor movement and active-operation previews are ephemeral Broadcast traffic and are throttled/coalesced rather than persisted. Preview payloads are independently validated because they bypass Postgres row constraints.

Closing a client removes its presence according to Realtime channel lifecycle. No collaborator history table exists.

## Image asset architecture

Phase 7 adds images without turning Canvas into an attachment manager. Postgres still stores only the Excalidraw image element; the binary is stored separately under an immutable content-addressed key:

```text
fileId = SHA-256(image bytes)
Storage path = sha256/<fileId>
```

Production uses the public-read `canvas-assets` bucket and CI uses `canvas-ci-assets`. Both buckets enforce a 12 MB object ceiling and allow only PNG, JPEG, WebP, GIF and SVG MIME types. Anonymous clients may INSERT a hash-named object, but production clients have no UPDATE or DELETE policy, so an existing digest cannot be overwritten. CI additionally permits DELETE for deterministic fixture cleanup.

An image remains local with Excalidraw `status='pending'` until its binary upload succeeds. Pending/error image versions are excluded from the Postgres durability queue. A successful upload promotes the image to `saved`; only then may its element row persist. Remote saved images lazy-load from Storage and the client verifies the downloaded bytes against `fileId` before calling Excalidraw `addFiles()`.

Static SVG is supported. Safe SVG is first normalized to the pinned Excalidraw width/height/viewBox/XML namespace contract and that canonical byte representation defines the SHA-256 asset ID. Script/foreign-object content, inline event handlers, external HTTP references, entities/DOCTYPE, and JavaScript URLs are rejected before hashing/upload.

Production assets are intentionally retained after an element tombstone because the same digest may be referenced by another image, a portable backup, or recovery history. Content addressing deduplicates identical bytes. This retention policy is safer than anonymous immediate object deletion.

Arbitrary files, video, audio, PDF objects, iframes and embeddable remote media remain unsupported.


## Visual profile and background architecture

Phase 8 introduces a Canvas-owned visual profile that is intentionally **device-local**. Theme, accent, paper surface, background pattern, grid spacing/strength, motion preference, ambient glow, UI sounds and haptics live in browser storage and never create Postgres rows or Realtime canvas mutations.

Light, dark and system appearance are first-class. Canvas supplies the shell/paper/accent tokens while the pinned Excalidraw editor receives the resolved light/dark theme. The drawing surface itself is transparent so a Canvas backdrop can render paper and optional scene-locked backgrounds below the editor.

Background behavior has one compatibility rule:

- square grid uses Excalidraw's native grid so existing grid snapping remains exact;
- dot and line backgrounds are rendered by Canvas from the same scene scroll/zoom transform;
- the existing Grid control remains the visibility switch for every pattern.

Color choices for native/custom shapes, drawing and rich text use one shared curated palette while retaining custom color inputs.

Phase 8 stamps (heart, check, sparkle, pin, flag and bolt) are not a new persistence subsystem. They use the existing custom-shape metadata on ordinary rectangle elements, so selection, transforms, locking, undo, collaboration, export and Postgres durability remain unchanged.

Optional sound/haptic feedback is best-effort browser feedback only. It never gates an action and is disabled by default for sound. Reduced-motion mode suppresses Canvas-owned transitions and delight animation, including the small local sparkle Easter egg.

## Scale and local-recovery architecture

Phase 9 keeps Supabase as the only shared authority while adding two client-side acceleration/recovery layers.

### Spatial indexing and DOM-overlay culling

Excalidraw continues to own its canvas renderer. Canvas-owned rich-text and custom-shape DOM overlays maintain version-aware fixed-cell spatial indexes keyed by immutable element stamps. On pan/zoom they render only the viewport plus overscan, while selected/editing rich text remains pinned even when it moves outside the culling window.

This does not remove elements from Excalidraw or shared persistence. It only bounds Canvas-owned DOM work.

### Crash-recovery journal

Completed persistable local mutations are written to an IndexedDB recovery journal before a network durability attempt leaves the local queue. The journal is device/table scoped, schema-versioned, count/byte/age bounded and revalidated before replay.

Startup order is strict:

1. hydrate current Supabase authority;
2. validate the journal;
3. compare immutable `version/versionNonce/isDeleted` stamps;
4. restore only local versions that still outrank authority;
5. send recovered versions through the normal durable writer;
6. clear/supersede journal entries only after authority catches up.

The journal never becomes shared authority and cannot overwrite a newer collaborator version.

### Image-transfer pressure

Storage downloads use a keyed bounded task queue, deduplicating repeated asset requests and limiting simultaneous transfers. Image content remains SHA-256 verified before Excalidraw receives it.

### Untrusted-data limits

Browser and database independently constrain top-level scene geometry. Browser validation additionally bounds point arrays, text payloads, import bytes, imported element counts and file counts before content reaches the editor. Malformed shared rows/previews are rejected before rendering and recorded in diagnostics.

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
