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
- element type must be one of the explicit vector allowlist;
- JSON ID must match the row ID;
- JSON version/nonce/deletion state must agree with relational columns through RLS checks;
- stale/non-increasing update tuples are rejected by the version-order trigger.

The application also filters input client-side, but database constraints are the authoritative boundary.

## Media/file rejection

The product has no upload/storage pipeline. File/image paste and drop are blocked in the browser, and media element types are rejected by Postgres. Supported stored types are limited to:

`rectangle`, `diamond`, `ellipse`, `line`, `arrow`, `freedraw`, `text`, `frame`.

Remote media previews are not an authorization mechanism and should not be added without a separate threat review.

## Abuse limitations

No-auth open-write collaboration cannot prevent a determined visitor with the URL from drawing unwanted content or modifying existing content. The current deployment is intended for a small trusted group, not an adversarial public board.

Existing controls reduce blast radius:

- per-record size limits;
- vector-only type allowlist;
- no public physical DELETE;
- per-element conflict ordering instead of whole-document overwrite;
- private history/recovery;
- no file storage;
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
