# Canvas

A small, persistent, realtime infinite canvas for trusted friends. Open the same URL and draw or write together—no accounts, room codes, invitations, or setup screens.

**Public app:** `https://thiepn.github.io/canvas/`

## What Canvas is

Canvas is intentionally one shared world named `main`. Identity is anonymous and local to each browser (`Guest ####`, a stable device ID, and a deterministic color). Anyone who can open the public URL can read and edit the canvas; the URL is the access boundary.

Supported content is deliberately vector-only:

- selection, move, resize, rotate, duplicate, copy/paste, undo/redo;
- freehand drawing;
- rectangle, ellipse, diamond, line and arrow;
- text;
- frames;
- eraser;
- realtime collaborator presence and cursors.

Images, screenshots, uploaded files, video, audio, PDFs and remote media are not part of the product. Client input is filtered and the database independently rejects unsupported element types and oversized records.

## Production architecture

The public application uses:

- **React + TypeScript + Vite** for the static application;
- **Excalidraw 0.18.1** for the canvas/editor interaction model;
- **Supabase Postgres** as the authoritative persistent store;
- **Supabase Realtime** for Postgres changes, presence, cursors and ephemeral in-progress element previews;
- **GitHub Pages** for static hosting.

There is no application server in the normal production path and no login system. The older tldraw/Cloudflare Worker implementation remains only as an isolated regression harness while its historical tests are retained; normal production builds do not select it.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the data/sync model and [DEPLOYMENT.md](./DEPLOYMENT.md) for release and recovery operations.

## Local development

Requirements: Node.js 22+ and npm.

```bash
npm ci
npm run dev
```

The checked-in public configuration points at the existing Supabase project. To use another project, copy `.env.example` to `.env.local` and replace the public URL/key after applying the migrations under `supabase/migrations/`.

`VITE_*` values are public browser configuration. **Never put a Supabase service-role key in a Vite variable.**

## Data model

Production elements live in `public.canvas_elements`. Each row is one Excalidraw element and carries:

- stable `id`;
- monotonic `version` and `version_nonce` conflict tuple;
- `is_deleted` tombstone state;
- validated `element` JSON;
- anonymous `updated_by` device identifier;
- server `updated_at` timestamp.

Postgres constraints allow only the product's vector types and cap each serialized element at 256 KiB. RLS grants anonymous clients only the operations the open-canvas model needs. Physical DELETE is not granted in production; normal deletion is a versioned tombstone so peers converge.

`public.canvas_ci_elements` mirrors the production contract but additionally permits DELETE so automated tests can clean their isolated world deterministically.

## Realtime behavior

The browser loads the authoritative table before becoming editable and subscribes to Supabase Realtime. Excalidraw still renders every local intermediate frame immediately, but those frames stay in memory for conflict protection rather than being written on a generic timer. Phase 3 persists the final element state(s) from each completed logical `CanvasMutation`; unusually long continuous pointer/text operations receive bounded safety checkpoints. Durable writes are serialized and reconciled with authoritative rows after completion. Postgres still rejects stale update tuples, so delayed requests cannot overwrite a newer element version.

Presence, cursors and active-operation previews are ephemeral Realtime channel state. Pointer/text previews are throttled Broadcast messages that let peers render in-progress geometry before the Phase 3 durability boundary; they never enter Postgres, expire automatically, and are replaced by authoritative rows when durability catches up.

If the connection is not `Live`, editing is disabled rather than pretending an unsafe offline edit has been saved.

## Recovery

Production updates are protected by a private `canvas_admin` history schema. Before an element is updated or physically deleted, its previous row is recorded with the Postgres transaction ID. History is capped to the latest 20 prior states per element.

The public browser roles have no access to this schema or restore function. An owner can inspect and restore a destructive transaction from the Supabase SQL editor or an equivalent privileged SQL session:

```sql
select *
from canvas_admin.recovery_transactions
order by finished_at desc
limit 20;

select canvas_admin.restore_transaction(<source_txid>);
```

Restore bumps element versions above the current state, so Realtime clients accept the recovered records as new authoritative updates. The restore itself is also captured by history, providing a recovery trail.

## Testing

Primary commands:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run test:live
npm run test:production
```

`test:live` runs real browser clients against the isolated Supabase CI table. `test:production` builds the same Excalidraw/Supabase architecture used on GitHub Pages and then tests the compiled `/canvas/` bundle against that isolated table.

The historical Worker/tldraw suite is retained as regression coverage but is not treated as proof of the public architecture. See [TESTING.md](./TESTING.md).

## Security model

Canvas is intentionally open-write. There are no passwords, accounts or permissions to bypass. Anyone with the URL can read and edit. The security goal is therefore containment and integrity, not private authorization:

- allowlisted vector types only;
- per-record size/shape checks in Postgres;
- stale-write rejection;
- no production physical DELETE privilege for public clients;
- private recovery schema and restore function;
- no service-role credential in the frontend;
- no file/media storage path.

Do not use the public canvas for secrets or sensitive personal information. See [SECURITY.md](./SECURITY.md).

## Deployment

GitHub Actions runs quality gates first. A `main` build deploys to GitHub Pages only after the quality job succeeds. The Pages base path is `/canvas/`; use `/` for a custom-domain root.

Backend schema is versioned in `supabase/migrations/`. Apply those migrations in timestamp order when provisioning another Supabase project.

## License and third-party software

Repository licensing is in [LICENSE](./LICENSE). Excalidraw and other dependencies retain their respective licenses; see [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
