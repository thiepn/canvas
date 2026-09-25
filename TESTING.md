# Testing Canvas

Canvas has one active application architecture: Excalidraw in the browser, Supabase Postgres as element authority, Supabase Realtime for collaboration, Supabase Storage for immutable content-addressed images, and GitHub Pages for hosting. The historical tldraw/Cloudflare Worker regression harness is retired, so every retained browser release gate exercises the architecture users receive.

## Required local checks

```bash
npm ci
npm audit --audit-level=high
npm run audit:architecture
npm run lint
npm run typecheck
npm test
npm run build
npm run test:live
npm run test:production
```

`npm run check` runs the production-only quality sequence.

## Architecture audit

`npm run audit:architecture` fails if the retired `tldraw` / `@tldraw/*`, Wrangler/Miniflare dependency family or historical Worker runtime files return. This is a permanent release gate rather than a one-time migration check.

## Unit tests

`npm test` covers browser-independent production behavior, including identity/configuration, logical operations, preview protocol validation, paginated reconciliation, scene indexing, version ordering, sync-health state and wheel behavior.

Phase 7 unit coverage additionally validates content-addressed asset IDs, raster signatures, static-only SVG rules, portable scene parsing and PDF generation.

Phase 8 unit coverage validates visual-profile defaults/persistence, light/dark paper/accent resolution, scene-locked grid math and motion preference resolution.

Phase 9 unit coverage adds spatial indexing/culling, IndexedDB journal parsing/conflict rules, bounded task concurrency, geometry/point contracts and import denial-of-service limits. Passing unit tests are necessary but do not prove realtime browser behavior.

## Live Supabase matrix

`npm run test:live` uses `playwright.live.config.ts` and the production `SupabaseCanvasEditor` against the isolated `public.canvas_ci_elements` table. It runs sequentially in Chromium, Firefox and WebKit because all live tests share that CI table.

The matrix covers real Excalidraw interaction and Supabase behavior, including:

- two-client persistence, presence and deletion tombstones;
- equal-version conflict convergence and reconnect recovery;
- logical-operation durability and bounded long-operation checkpoints;
- Broadcast previews and abandoned-preview expiry;
- revision anti-entropy after deliberately dropped realtime events;
- large-scene hydration/indexing behavior;
- page lifecycle recovery;
- 320px mobile shell containment;
- explicit save health, offline/reconnect states and manual failed-write retry;
- image Storage upload/download, replacement, reload hydration and content-hash verification;
- cross-session image clipboard deduplication and portable Canvas/Excalidraw imports;
- JSON/PNG/SVG/PDF exports and standalone URL-card paste;
- saved-image database enforcement, unsupported-media rejection and wheel zoom behavior;
- Phase 8 device-local visual profile persistence without shared scene writes;
- Phase 9 IndexedDB recovery after interrupted writes and stale-journal conflict rejection;
- Phase 9 delayed-write, four-client convergence and large-overlay culling stress;
- Phase 9 database geometry rejection and browser malformed-content filtering;
- Phase 9 320px, short-landscape, 200% text-size, skip-link/focus and forced-colors resilience;
- light/dark appearance, accents, paper surfaces and grid background controls;
- scene-locked dot/line grid scaling and native square-grid compatibility;
- persistent vector stamps as normal shared custom-shape objects;
- reduced-motion and local delight behavior.


- Phase 9 crash-journal recovery after an interrupted write and stale-journal conflict rejection;
- delayed PostgREST convergence without duplicate rows;
- backend rejection of pathological geometry;
- 600+ custom-shape overlay culling;
- a bounded four-client collaboration burst;
- 320px layout containment, short-landscape popovers, keyboard skip navigation and forced-colors focus visibility.

The quality workflow and manual performance workflow share one non-cancelling concurrency group so their setup/cleanup cannot corrupt each other's Supabase fixtures.

## Compiled production matrix

`npm run test:production` builds the app with the repository `/canvas/` base path and the isolated CI table, serves only the compiled output, and exercises it in Chromium, Firefox and WebKit. It verifies the shipped `excalidraw-supabase` engine, hashed assets, connection, real persistence, reload behavior and absence of test-only bridges.

## Performance evidence

The manual `Canvas performance evidence` workflow measures the same production editor against the isolated CI table. Diagnostics remain opt-in and do not contain element content.


## Phase 9 performance budgets

`npm run performance:budget` validates the generated `artifacts/performance.json` evidence. The manual performance workflow also runs weekly and fails when broad release budgets are exceeded. The budgets target catastrophic regression detection rather than microbenchmark competition: the 10k-object fixture must stay within bounded render/pan/edit/serialization/heap limits, and collaboration must remain within bounded open/render/write/reconnect latency.

The performance job remains serialized with the ordinary Supabase CI writer because both use `canvas_ci_elements`.

## Supabase schema and recovery

Migration SQL is tracked in `supabase/migrations/`. Backend verification after schema changes should confirm RLS, Realtime publication, element/image validation, Storage bucket limits/policies, stale-write rejection, no anonymous physical DELETE on production elements, immutable production image assets, and private owner-only recovery.

Do not expose privileged recovery as a browser endpoint merely to automate it.

## Release criteria

A phase is not release-complete merely because a pull request is green. Required evidence is:

- exact PR-head quality job green;
- merged `main` quality job green;
- GitHub Pages deployment green;
- deployed-site verifier green against the published HTTPS bundle.

Playwright traces/screenshots are retained for browser failures. Inspect them before changing synchronization code so locator/actionability, browser/network noise and actual Supabase failures remain distinguishable.
