# Security Model

## Deliberately open access

Canvas has no authentication. Anyone who can reach the public URL can read and edit the single shared world. Display names and device IDs are attribution/presence metadata, not verified identities.

This means Canvas must not be used for secrets, private documents or sensitive personal information. There is no user-level authorization boundary to protect such data.

The security objective is **containment, data integrity and recoverability under an intentionally open-write model**.

## Public browser capabilities

The browser uses a Supabase publishable key. This is expected to be visible in JavaScript and network requests.

For `public.canvas_elements`, RLS/table grants permit anonymous/authenticated clients to:

- SELECT rows;
- INSERT valid supported elements;
- UPDATE valid supported elements.

They cannot physically DELETE, TRUNCATE, alter triggers or access the private recovery schema. Canvas deletion is represented by a newer `is_deleted=true` element version.

The service-role key is never embedded in the frontend.

## Database integrity controls

Postgres independently validates each production row:

- ID length 1–128;
- bounded version/version nonce;
- updater attribution <=128 characters;
- JSON must be an object;
- serialized element JSON <=256 KiB;
- element type must be one of the explicit canvas allowlist;
- image rows require a saved state, SHA-256 `fileId` and valid scale metadata;
- JSON ID must match the row ID;
- JSON version/nonce/deletion state must agree with relational columns through RLS checks;
- stale/non-increasing update tuples are rejected by the version-order trigger.

The application also filters input client-side, but database constraints are the authoritative boundary.

## Image asset containment

Canvas supports bounded image assets but not arbitrary file storage. Supported stored element types are:

`rectangle`, `diamond`, `ellipse`, `line`, `arrow`, `freedraw`, `text`, `frame`, `image`.

Image binaries use public-read Supabase Storage buckets because the canvas itself is intentionally public-read. Uploads are constrained independently of the client:

- 12 MB bucket file-size limit;
- PNG/JPEG/WebP/GIF/SVG MIME allowlist;
- object path must be `sha256/<64 lowercase hex>`;
- the client verifies SHA-256 before upload and after download;
- production has INSERT but no public UPDATE/DELETE policy, making digest objects immutable;
- CI has hash-scoped SELECT + DELETE only for deterministic fixture cleanup;
- active/external SVG constructs are rejected client-side before upload;
- persisted links are limited to HTTP(S), internal `#` anchors, or empty/null values, and imports/remote rows are validated against the same rule.

Postgres accepts an image element only after the asset lane marks it `saved` with a valid SHA-256 file ID. Pending/error images cannot become authoritative rows. Video, audio, PDF objects, arbitrary attachments, iframes and embeddables remain rejected.

## Abuse limitations

No-auth open-write collaboration cannot prevent a determined visitor with the URL from drawing unwanted content or modifying existing content. The current deployment is intended for a small trusted group, not an adversarial public board.

Existing controls reduce blast radius:

- per-record size limits;
- vector-only type allowlist;
- no public physical DELETE;
- per-element conflict ordering instead of whole-document overwrite;
- private history/recovery;
- content-addressed immutable image storage instead of arbitrary file storage;
- editing disabled when the client cannot establish a trustworthy live connection.

If the URL becomes broadly distributed or adversarial traffic becomes a real problem, the appropriate next step is an access-control layer—not hiding the publishable key or relying on obscurity inside JavaScript.

## Recovery security

`canvas_admin` is private. Privileges are revoked from `public`, `anon`, and `authenticated` for its schema/table/view/functions.

Before production UPDATE/DELETE, the previous row is recorded in `canvas_admin.element_history`, grouped by Postgres transaction ID. `canvas_admin.restore_transaction(bigint)` is owner-only and must be invoked through a privileged SQL session.

Do **not** grant that function to `anon`/`authenticated` and do not expose it as an unauthenticated RPC endpoint.

## CI isolation

Automated browser tests use `public.canvas_ci_elements`, never the production world. That table intentionally permits DELETE for deterministic cleanup and therefore has broader policies than production. It must not be selected by the public deployment.

The frontend defaults to `canvas_elements`; test configurations explicitly override `VITE_CANVAS_TABLE=canvas_ci_elements`. CI and the manual performance workflow serialize access to the shared CI table so their cleanup cannot destroy each other's fixtures.

## Client-side identity

Anonymous identity is stored in local browser storage. Names are bounded/sanitized for UI use. A visitor can change local storage or impersonate another display name; this is expected because identity is not authentication.

Do not make security decisions based on `deviceId`, display name, color or presence metadata.

## Dependencies and CI

The workflow records an npm audit and fails on high-severity dependency findings. It also runs `npm run audit:architecture`, which prevents the retired tldraw/Wrangler/Worker runtime and package family from silently returning.

Lint, strict TypeScript, production-model unit tests, real Supabase browser tests, compiled-production tests, build audit, merged-main repeat, Pages deployment and the published-site verifier form the release chain.

## Reporting

For a vulnerability that would expose credentials, bypass intended database constraints, grant access to the private recovery schema, or corrupt other applications sharing the Supabase project, avoid demonstrating it destructively against the live world. Provide a minimal reproduction against the isolated CI table or a fresh project where possible.


## Phase 9 data-hardening boundaries

Phase 9 adds defense in depth around malformed or resource-exhausting scene data:

- Postgres rejects primary element geometry outside `|x/y| <= 1e9`, `|width/height| <= 1e8`, and `|angle| <= 1000`;
- the browser applies the same primary geometry contract before authoritative rows, imports or recovery data reach Excalidraw;
- line/arrow/freehand point arrays are limited to 10,000 finite bounded points;
- imported text remains bounded and import packages are capped at 80 MB / 20,000 elements / 500 files;
- rejected shared rows increment content-free diagnostics counters only; element content is not logged;
- image transfers remain MIME/signature/content-hash validated and now have bounded concurrency.

The IndexedDB recovery journal contains unsaved scene element data and therefore inherits the sensitivity of the canvas itself. It never leaves the device through a new endpoint, is keyed to the current anonymous device/table, expires after seven days, has strict size/geometry validation and is removed as soon as Supabase authority confirms or supersedes its entries.

The recovery journal is not trusted over shared authority: stale local versions cannot overwrite newer collaborator/server versions.
