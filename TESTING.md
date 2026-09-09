# Verification strategy and evidence

Canvas uses layered verification because a collaborative editor can compile successfully while still failing persistence, browser interaction, or concurrency behavior.

## Automated evidence obtained

### Final exact-head quality run

The fully integrated release gate passed on commit `68f83d614a39388515cae2efe671832f07a65d00` in GitHub Actions run `34294256800`.

That run completed all of the following successfully:

- reproducible `npm ci` installation;
- full dependency audit capture;
- `npm audit --audit-level=high`;
- ESLint with zero warnings;
- strict frontend/shared/Worker TypeScript;
- unit/storage tests;
- Worker/Durable Object integration tests;
- Wrangler production dry-run;
- optimized Vite build and bundle audit;
- Chromium/Firefox/WebKit E2E;
- optimized production-preview smoke.

The recorded npm audit for that run contains **zero vulnerabilities at every severity level**.

### Unit and storage layer

The core suite contains **33 passing tests**. It covers local identity/configuration, URL/base parsing, bounded JSON, record/media policy, rate/chunk guards, world byte accounting, backup envelopes/retention/reconstruction, and real SQLite backup storage including close/reopen persistence, corruption detection, and transactional rollback.

### Worker integration

The local Wrangler suite contains **5 passing integration tests** against the actual Worker/Durable Object runtime rather than a hand-written HTTP mock. It covers admission/CORS, administration guards, invalid restore handling, persistence across Worker-process restart, and backend state behavior.

`npm run check:worker` additionally performs a Wrangler production dry-run bundle.

### Cross-browser E2E

The final exact-head Chromium/Firefox/WebKit run passed with:

- **59 passed**;
- **4 intentional project-specific skips**;
- **0 failures**;
- **0 flaky tests**.

The four skips are not untested core functionality:

- the ten-context load case is executed once in Chromium instead of three times; ordinary multiplayer/concurrency behavior still runs in Chromium, Firefox, and WebKit;
- CDP multi-touch injection is Chromium-only; responsive and non-CDP interaction coverage still runs cross-browser, while physical stylus/palm behavior remains a hardware check.

Critical automated scenarios include:

- A creates `Hello from A`; B receives it;
- B creates a rectangle; A receives it;
- A moves the rectangle; B receives the final position;
- B deletes A's text; A observes deletion;
- both clients refresh and converge;
- all clients close, a new client opens, and server state remains;
- simultaneous independent edits survive;
- local undo/redo does not remove an unrelated remote edit;
- independent concurrent moves converge;
- a client loses its Canvas transport, editing visibly pauses, the peer edits, transport returns, the client reconnects without page refresh, receives the missed edit, and can continue editing;
- collaborator presence/rename appears and disappears after disconnect;
- owner snapshot → destructive edit → administrative restore returns known state and stale restore clocks are rejected;
- ten isolated Chromium contexts connect and converge on ten shapes/presence;
- pointer-based drawing, text creation, shape resizing and persistence;
- plain-text paste in Chromium/Firefox/WebKit;
- pasted images and dropped image/PDF files are rejected;
- malformed/oversized WebSocket traffic is rejected;
- application controls have accessible names and keyboard behavior;
- required responsive viewports remain usable without body-scroll/tool overflow;
- Chromium touch/pinch simulation changes the canvas camera rather than scrolling the page;
- phone-native menu controls expose undo, redo, zoom, and fit behavior when desktop navigation is hidden.

Required viewports automated:

- 320×568
- 360×800
- 390×844
- 430×932
- 768×1024
- 1024×768
- 1366×768
- 1440×900
- 1920×1080

### Production-mode smoke

`npm run test:production` creates a separate optimized build in `.preview-dist`, starts it under the repository subpath `/canvas/`, connects it only to isolated local Worker storage, and verifies:

- optimized static assets load from the project Pages base;
- the test bridge is absent from the production bundle;
- a real text interaction persists through the Worker;
- manifest/PWA assets are reachable;
- reload reconnects;
- no page errors or failed frontend assets are observed;
- an actual editor screenshot is captured as CI evidence.

The final exact-head production-preview test passed. `scripts/audit-build.mjs` also rejects accidental test-bridge inclusion and records bundle measurements. The final production JavaScript payload measured approximately **602 KB gzip** across application chunks, dominated by the canvas engine.

### Performance evidence

The dedicated Chromium benchmark persisted real shared-state scenes through the Worker:

| Shapes | Generate + persist | Serialize | Serialized bytes | Median frame | p95 frame | JS heap |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 2.18 s | 0.4 ms | 35,625 | 16.7 ms | 16.8 ms | 38 MiB |
| 1,000 | 5.78 s | 2.0 ms | 358,041 | 16.7 ms | 16.9 ms | 88 MiB |
| 5,000 | 26.9 s | 9.1 ms | 1,795,001 | 16.7 ms | 19.4 ms | 239 MiB |
| 10,000 | 58.9 s | 17.7 ms | 3,592,101 | 18.5 ms | 26.0 ms | 825 MiB |

The benchmark intentionally reports measured behavior rather than inventing a pass threshold. The 10,000-shape case is the configured stress ceiling and shows substantial memory growth; it should not be interpreted as the preferred everyday scene size.

## Test commands

| Command | Scope |
| --- | --- |
| `npm run lint` | ESLint, zero warnings |
| `npm run typecheck` | Wrangler-generated Cloudflare types plus strict frontend/shared/Worker TypeScript |
| `npm test` | 33 unit/storage tests |
| `npm run test:worker` | Local Wrangler/DO integration and restart tests |
| `npm run check:worker` | Production Worker dry-run bundle |
| `npm run build` | Optimized Vite build plus bundle audit |
| `npm run test:e2e` | Chromium, Firefox and WebKit collaboration/interaction/responsive regression |
| `npm run test:production` | Optimized `/canvas/` preview smoke against isolated Worker state |
| `npm run test:performance` | Real persisted large-scene measurement |
| `npm run check` | Main quality sequence excluding the separately invoked large-scene benchmark |

CI additionally records `npm audit --json` and rejects high/critical dependency findings. The final recorded audit reported zero findings across all severities.

## Test isolation

The narrow `window.__CANVAS_TEST__` bridge is dynamically imported only in Vite `test` mode. Production bundle auditing refuses its marker.

E2E and production-preview tests use isolated local Durable Object persistence directories and known test-only admin tokens. They do not point at a deployed production world. Production API environment values from the developer shell are overridden during the preview smoke test.

The performance run also uses isolated local Worker storage.

## Remaining manual/platform release checks

Automation materially reduces risk but does not certify hardware/platform behavior that it does not execute.

### Real Cloudflare hibernation

After deployment:

1. connect one or more production clients;
2. leave them idle long enough for Cloudflare to hibernate the Durable Object when the platform chooses;
3. interact again without refreshing;
4. verify synchronization resumes;
5. inspect Cloudflare logs/analytics for errors and unexpected active duration.

Local Wrangler restart/reconnect tests validate the hibernation-compatible architecture but cannot prove a real Cloudflare platform eviction occurred.

### Physical phone/tablet/stylus

On actual hardware verify:

- portrait and landscape;
- soft keyboard behavior;
- one-finger object interaction;
- two-finger pan/pinch;
- text selection/editing;
- selection handles;
- safe-area positioning;
- browser overscroll/pull-to-refresh interference;
- stylus input and palm behavior.

Desktop WebKit/Playwright touch emulation is not Apple Pencil or physical iPad certification.

### Accessibility

The automated suite verifies accessible control names and keyboard interactions. Before calling accessibility complete, perform at least one real screen-reader pass and an automated scanner against the deployed build. Infinite-canvas content itself has inherent accessibility limitations even when application chrome is accessible.

### Production recovery drill

After deployment, use noncritical test state to run a real server snapshot/destructive edit/restore cycle with every client closed, then verify the restored state from a clean browser. CI already exercises the same logic locally; the deployment drill validates secrets/routing/operator procedure.

### Optional Lighthouse/web-quality check

The production build already checks console/static-asset/PWA basics. A Lighthouse run on the deployed Pages shell remains useful as a secondary web-quality measure. Do not optimize an infinite editor solely to maximize a static-page score.

## Release rule

The recorded branch head `68f83d614a39388515cae2efe671832f07a65d00` passed the complete quality workflow in run `34294256800`. Any later commit must pass the same gate again, and the final merge commit on `main` must also be green. Deployment-specific checks remain explicitly separate from repository CI rather than being inferred from source design.
