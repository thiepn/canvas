# Testing

Canvas distinguishes **production-path certification** from the retained historical Worker regression harness.

## Required local checks

```bash
npm ci
npm audit --audit-level=high
npm run lint
npm run typecheck
npm test
npm run build
npm run test:live
npm run test:production
```

CI runs these gates and retains diagnostics on failure.

## Unit tests

`npm test` covers pure application/security/data helpers, including:

- anonymous identity persistence and sanitization;
- configuration validation and Pages base paths;
- vector allowlist and media rejection;
- size/coordinate/link bounds;
- backup/recovery helper behavior retained from the legacy implementation;
- origin/frame/rate/security utilities.

Passing unit tests are necessary but do not prove realtime browser behavior.

## Live Supabase test

`npm run test:live` uses `playwright.live.config.ts` and the production `SupabaseCanvasEditor` against:

```text
public.canvas_ci_elements
```

The CI table mirrors production validation/realtime behavior but additionally permits DELETE so each test can start and finish with a clean isolated world.

The core two-browser scenario must establish:

1. two independent browser contexts both reach `Live`;
2. presence reports two connected people;
3. client A selects the real Excalidraw rectangle tool and draws via pointer input;
4. the rectangle is persisted to Supabase;
5. client B receives the live world and erases the rectangle via the real Excalidraw eraser;
6. Supabase contains the resulting deletion tombstone;
7. neither page emits an uncaught exception.

Phase 3 adds operation-aware durability assertions on the same production editor path:

- an ordinary frame-paced rectangle drag is **1 logical mutation / 1 durable batch / 1 row**, and the one persisted row contains the final geometry rather than an intermediate drag frame;
- a slow text-edit session with pauses remains **1 logical mutation / 1 durable batch** and persists the final complete text;
- a deliberately long pointer gesture receives at least one bounded safety checkpoint, then the final mutation supersedes that checkpoint with the completed geometry.

Tool selection must interact with Excalidraw's visible accessible labels; the underlying radio inputs are visually overlaid by their icons and should not be clicked directly in Playwright.

### Phase 4 preview-lane coverage

The live suite additionally proves the fast and durable lanes remain separate:

- a held rectangle drag becomes visible on a second real client through Supabase Broadcast while `canvas_ci_elements` is still empty and the originating client has made zero durable writes;
- releasing that same gesture still produces exactly one normal Phase 3 database write and no long-operation checkpoint;
- a synthetically abandoned but structurally valid remote preview renders temporarily, never changes the database row, and expires back to the authoritative element;
- unit tests reject malformed/oversized/discrete preview envelopes, replayed sequence numbers and previews that would overwrite active local work.

CI and the manual performance workflow both mutate `canvas_ci_elements`; their jobs therefore share one non-cancelling GitHub Actions concurrency group so their cleanup/setup cannot corrupt each other's live fixtures.

## Compiled production smoke

`npm run test:production` performs a separate build into `.preview-dist` with:

```text
VITE_CANVAS_TABLE=canvas_ci_elements
VITE_BASE_PATH=/canvas/
```

It then serves only that compiled directory with `vite preview`. It does **not** start Wrangler and does **not** force the legacy tldraw backend.

The smoke verifies:

- `/canvas/` and its hashed assets load without HTTP errors;
- the shipped engine is `excalidraw-supabase`;
- connection reaches `Live`;
- no `__CANVAS_TEST__` bridge is present in the compiled app;
- a real pointer-created rectangle reaches Postgres;
- manifest metadata loads at the repository base path;
- reload reconnects to the same persisted CI row;
- no uncaught page errors occur.

## Historical regression suite

`npm run test:e2e` currently retains broad tests for the previous tldraw + Cloudflare Worker architecture, including multiple browsers, viewport coverage, tool matrices and Worker persistence/security cases.

These tests remain useful for detecting regressions in shared utilities and for preserving previous guarantees while migration work is audited. They are **not evidence that the public Excalidraw/Supabase architecture works**. Production release decisions must include `test:live` and `test:production`.

The legacy harness is selected only in Vite test mode / explicit legacy-test configuration. Normal production builds compile-time exclude its editor path.

## Supabase schema verification

Migration SQL is tracked in `supabase/migrations/`. Backend validation after schema changes should include:

- RLS policies for both Canvas tables;
- both tables present in `supabase_realtime`;
- production has no anonymous physical DELETE privilege;
- CI cleanup DELETE remains limited to `canvas_ci_elements`;
- unsupported/media element INSERT is rejected;
- lower or equal conflict tuple cannot overwrite a newer row;
- recovery schema/function remains inaccessible to browser roles.

## Recovery test

Recovery is tested with privileged SQL inside a transaction:

1. begin transaction;
2. create a temporary supported element;
3. update it to a deletion tombstone;
4. verify `canvas_admin.element_history` captured the previous active row and source transaction ID;
5. call `canvas_admin.restore_transaction(txid)`;
6. verify the element is active again with a version higher than the destructive version and matching JSON fields;
7. rollback;
8. confirm no temporary production/history row remains.

Do not turn recovery into a public browser E2E endpoint merely to automate it.

## Release criteria

A release is not complete merely because a pull request is green. Required evidence is:

- exact PR head quality job green;
- merged `main` quality job green;
- `main` Pages deployment job green;
- public `https://thiepn.github.io/canvas/` serves the new commit;
- public page loads with no missing repository-path assets;
- production reaches `Live` against `canvas_elements`.

If any of those conditions fails, the release remains incomplete even if older regression suites pass.

## Failure diagnostics

Playwright retains traces/screenshots for failing live and production tests. When a test times out, inspect the trace before changing sync code: distinguish locator/actionability failures from database/realtime failures. A browser test that never reaches pointer input is not evidence of a Supabase bug.
