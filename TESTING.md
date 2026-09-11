# Testing Canvas

Canvas now has one active application architecture: Excalidraw in the browser, Supabase Postgres as authority, Supabase Realtime for collaboration, and GitHub Pages for hosting. Phase 8 removed the historical tldraw/Cloudflare Worker regression harness, so every retained browser release gate exercises the architecture users receive.

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

Passing unit tests are necessary but do not prove realtime browser behavior.

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
- vector-only database enforcement and wheel zoom behavior.

The quality workflow and manual performance workflow share one non-cancelling concurrency group so their setup/cleanup cannot corrupt each other's Supabase fixtures.

## Compiled production matrix

`npm run test:production` builds the app with the repository `/canvas/` base path and the isolated CI table, serves only the compiled output, and exercises it in Chromium, Firefox and WebKit. It verifies the shipped `excalidraw-supabase` engine, hashed assets, connection, real persistence, reload behavior and absence of test-only bridges.

## Performance evidence

The manual `Canvas performance evidence` workflow measures the same production editor against the isolated CI table. Diagnostics remain opt-in and do not contain element content.

## Supabase schema and recovery

Migration SQL is tracked in `supabase/migrations/`. Backend verification after schema changes should confirm RLS, Realtime publication, vector-only validation, stale-write rejection, no anonymous physical DELETE on production, and private owner-only recovery.

Do not expose privileged recovery as a browser endpoint merely to automate it.

## Release criteria

A phase is not release-complete merely because a pull request is green. Required evidence is:

- exact PR-head quality job green;
- merged `main` quality job green;
- GitHub Pages deployment green;
- deployed-site verifier green against the published HTTPS bundle.

Playwright traces/screenshots are retained for browser failures. Inspect them before changing synchronization code so locator/actionability, browser/network noise and actual Supabase failures remain distinguishable.
