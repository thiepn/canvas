# Canvas — current architecture and release audit

**Current production architecture:** Excalidraw 0.18.1 + Supabase Postgres/Realtime + GitHub Pages  
**Repository:** `thiepn/canvas`  
**Phase 8 objective:** remove the historical tldraw/Cloudflare Worker runtime and make the repository describe exactly what production ships.

## Executive assessment

Canvas now has one active application architecture. The browser runs React/Vite with Excalidraw. Supabase Postgres is authoritative persistence. Supabase Realtime supplies database changes, presence and cursors; Broadcast supplies ephemeral active-operation previews. GitHub Pages serves the static application. There is no account system, room picker, application server, Cloudflare Worker or alternate editor runtime.

Phases 1–7 hardened the production path before the historical stack was removed: diagnostics/performance baselines, logical mutation boundaries, final-operation durability, Broadcast previews, revision anti-entropy, large-scene indexing/paginated hydration, and explicit save/recovery UX are all exercised against the shipped Excalidraw/Supabase editor.

Phase 8 removes the prior tldraw + Cloudflare Worker/Durable Object source, dedicated tests, Wrangler configuration and dependency family. Git history remains the historical record. No Supabase production data or schema is deleted or migrated by this cleanup.

## Persistence and collaboration

Production state is stored in `public.canvas_elements` as independently versioned Excalidraw elements. Rows carry stable IDs, Excalidraw version/version nonce, deletion tombstones, bounded validated JSON, updater metadata, a revision cursor and timestamps.

The client:

- groups high-frequency editor changes into logical operations;
- normally persists only the final operation state;
- emits bounded checkpoints for unusually long operations;
- serializes/retries durable writes without discarding newer local versions;
- renders low-latency Broadcast previews without treating them as authority;
- reconciles missed database events by monotonic revision;
- uses indexed scene state to avoid repeated full-scene validation work;
- reports `Saved` only when no active local or durable work remains.

Supabase/Postgres remains authoritative. Broadcast previews expire or are superseded by authoritative rows and never become durable state on their own.

## Security model

Canvas intentionally uses an open-link editing model: anyone with the public URL can read and edit the shared world. This is a product choice, not an authentication boundary.

Integrity controls include:

- vector-only server validation;
- bounded record/coordinate/text/link data;
- RLS on production and CI tables;
- deterministic stale-write rejection;
- no anonymous physical DELETE on production;
- no service-role or recovery credential in the browser;
- private owner-only destructive-edit recovery.

## Recovery

The private `canvas_admin` schema records prior production row state and provides privileged transaction restoration using newer element versions so connected clients converge on recovered authority. Browser roles cannot access this recovery layer.

## Production-only release gates

The permanent workflow now requires:

1. committed-lockfile install and vulnerability audit;
2. `npm run audit:architecture`, which fails if the retired tldraw/Wrangler/Worker surface returns;
3. zero-warning lint and strict TypeScript on compiled production/live/performance surfaces;
4. production-model unit tests;
5. optimized Vite build and bundle audit;
6. real Supabase/Excalidraw browser tests in Chromium, Firefox and WebKit;
7. compiled-production tests in Chromium, Firefox and WebKit;
8. after merge, a second green `main` run;
9. GitHub Pages deployment plus the published-site verifier over HTTPS.

The manual performance workflow uses the same production editor and the isolated `canvas_ci_elements` table.

## Phase 8 maintenance result

The Phase 7 CI install audited 599 packages. The validated Phase 8 graph installs 431 packages and audits 432 with zero known vulnerabilities, removing roughly 28% of installed packages. The guarded migration removed about 6.9k lines of legacy runtime/test/configuration code while leaving the production Excalidraw bundle behavior unchanged.

## Residual risk

The remaining material risks are production risks rather than dual-runtime maintenance debt:

- Supabase availability and quota remain external dependencies;
- simultaneous edits to the same element converge deterministically at element level rather than with a character-level text CRDT;
- Canvas intentionally does not support independent offline-authoritative editing followed by arbitrary merge;
- extreme Excalidraw scenes may still be constrained by browser memory/rendering limits;
- physical stylus/palm-rejection validation and a full manual screen-reader pass remain hardware/manual checks.

## Release completion rule

A Phase 8 release is complete only when the exact PR head is green, the exact merged `main` commit repeats the production-only matrix, Pages deploy succeeds, and the deployed-site verifier confirms the published application. A local build or a green historical commit is not sufficient evidence.
