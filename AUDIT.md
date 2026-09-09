# Canvas — final implementation and release audit

**Candidate:** `1.0.0-rc.1`  
**Assessment window:** 8–9 September 2026  
**Repository:** `thiepn/canvas`  
**Application release branch:** `main`  
**Historical hardening PR:** #1 (merged)

## Release assessment

The original uploaded source candidate was not releasable: its first GitHub Actions run could not install the declared tldraw 5.4.1 sync package, it had no genuine lockfile, several SDK boundaries were written against newer source than the npm-published package family, and runtime/browser behavior had not been certified.

Those blockers were treated as implementation defects rather than documentation caveats. PR #1 hardened and certified the application, then was squash-merged to `main` as commit `f429294102146b61107de0427b360fab4c1f9f89`.

### Certified source on `main`

The exact squash-merge commit `f429294102146b61107de0427b360fab4c1f9f89` passed the complete **Canvas checks and Pages / quality** workflow in GitHub Actions run `34298529147`.

The run passed every quality step:

- `npm ci`;
- full dependency audit capture;
- `npm audit --audit-level=high`;
- ESLint;
- strict TypeScript;
- 33 unit/storage tests;
- 5 Worker/Durable Object integration tests;
- Wrangler production dry-run;
- optimized Vite build and bundle audit;
- Chromium/Firefox/WebKit E2E;
- optimized `/canvas/` production-preview smoke.

The retained exact-`main` artifact reports **zero vulnerabilities at every severity level**, **62 expected E2E passes, 4 intentional project-specific skips, 0 unexpected failures, 0 flaky tests**, and **1/1 production-preview pass**. The four E2E skips are limited to running the ten-client stress case once in Chromium and using Chromium-only CDP multi-touch injection; normal collaboration, required-tool, and responsive coverage remains cross-browser.

The required-tool matrix explicitly drives the real toolbar/canvas in Chromium, Firefox, and WebKit to create and persist rectangle, ellipse, diamond, line, arrow, frame, and highlighter records, then erases a real target by crossing its outline. The first version of that regression revealed a test-assumption error—tldraw's hollow geo eraser correctly does not treat empty interior space as an erase hit—so the final test uses the natural outline-crossing gesture and passes in all three engines.

**Source certification is complete. Production deployment is separate.** The `deploy-pages` job on the certified `main` run was skipped because `CANVAS_DEPLOY_ENABLED` was not true; this is an intentional publication gate, not a failed quality check. Real Cloudflare hibernation wake, production license validation, production recovery routing, and physical stylus/palm behavior cannot be truthfully inferred from repository CI.

## Executed evidence

| Layer | Result |
| --- | --- |
| Dependency audit | **0 vulnerabilities** across info/low/moderate/high/critical on certified `main` run |
| Unit/storage suite | **33 passed, 0 failed** |
| Worker/Durable Object integration | **5 passed, 0 failed** |
| Strict TypeScript | **Passed** frontend/shared and Worker projects |
| Lint | **Passed** with zero warnings |
| Worker production dry run | **Passed** |
| Production Vite build | **Passed**; bundle audit executed; **601,531 bytes gzip JS** |
| Cross-browser collaboration/interaction/tools | **62 expected, 4 intentional project-specific skips, 0 unexpected, 0 flaky** |
| Required vector-tool matrix | **Passed in Chromium, Firefox, WebKit** |
| Optimized production preview | **1/1 passed** |
| Ten-client convergence | **Passed** in Chromium with ten isolated contexts |
| Close-all/reopen persistence | **Passed** |
| Collaborative undo isolation | **Passed** |
| Network reconnect without page refresh | **Passed** |
| Image/PDF/file rejection | **Passed** |
| Administrative backup/restore | **Passed** locally through the real Worker path |
| Large-scene benchmark | **Passed** at 100, 1k, 5k, and 10k persisted shapes |

## Performance findings

Dedicated GitHub-hosted Chromium measurements:

| Shapes | Generate + persist | Serialized size | Median frame | p95 frame | JS heap |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 2.18 s | 35.6 KB | 16.7 ms | 16.8 ms | 38 MiB |
| 1,000 | 5.78 s | 358 KB | 16.7 ms | 16.9 ms | 88 MiB |
| 5,000 | 26.9 s | 1.80 MB | 16.7 ms | 19.4 ms | 239 MiB |
| 10,000 | 58.9 s | 3.59 MB | 18.5 ms | 26.0 ms | 825 MiB |

Interpretation:

- 100–1,000 simple shapes are comfortably within the intended personal use case.
- 5,000 remains responsive in the synthetic benchmark but uses materially more memory.
- 10,000 is a stress ceiling, not a recommended everyday world size. Heap use near 825 MiB is the clearest measured scalability weakness.
- Serialized current-state growth remains below the 8 MiB product world budget at 10,000 simple synthetic shapes.
- Freehand geometry and rich text may be denser than this synthetic workload.

## Significant defects found and fixed

1. **Unpublished dependency target.** `@tldraw/sync@5.4.1` was not available from npm despite the GitHub v5.4.1 release. The interoperating tldraw family is exact-pinned to published 5.4.0.
2. **SDK API drift.** Obsolete editor asset props, external-text payload fields, context-menu typing, and Durable Object sync boundaries were updated to the installed 5.4.0 API instead of weakening TypeScript.
3. **Vite asset-loader incompatibility.** The Vite-specific tldraw asset import caused Vite 8/Rolldown dependency-optimizer failures. Canvas now uses the compatible metadata-URL asset loader.
4. **Second-build module-graph failure.** Build-path normalization was isolated inside Vite configuration instead of importing browser runtime configuration into the build config.
5. **Cross-browser plain-text paste.** Canvas owns ordinary external plain-text paste while preserving tldraw structured internal vector clipboard data.
6. **Reconnect transport model.** Reconnect tests isolate Canvas WebSocket failure from Vite dev-server/HMR transport behavior and still require automatic convergence without refresh.
7. **Presence-only anonymous identity.** Anonymous user data remains local/ephemeral; persistent user records are rejected by the server.
8. **Media bypasses.** Images/files are blocked in toolbar/content handlers, capture-phase paste/drop, asset storage, structured paste validation, and server authorization.
9. **Hibernation reconstruction.** Authoritative state remains SQLite; bounded socket attachments contain only resumable session state. Invalid/oversized resume state falls back to reconnect.
10. **Socket replacement race.** A stale closing WebSocket can no longer tear down a newer socket that reused the same tldraw session ID.
11. **Unbounded input.** Frame/message/record/text/world/coordinate/connection limits and rate/byte token buckets protect the sync boundary.
12. **World-budget efficiency.** Current-world bytes are tracked incrementally by record instead of reserializing the full world on every drag.
13. **Recovery correctness.** Rolling snapshots, pre-deletion capture, pre-restore snapshots, checksums, bounded decompression, transactional chunk storage, exact-clock restore, and zero-client restore are implemented and tested.
14. **Pages path mismatch.** The real repository is lowercase `thiepn/canvas`; build/test/deployment paths use `/canvas/`.
15. **Dependency advisory.** Wrangler/Miniflare previously resolved advisory-affected `sharp 0.35.2`; the lockfile pins the patched transitive version `0.35.4`. The final audit now reports zero vulnerabilities.
16. **License documentation drift.** Current tldraw license-key behavior is documented conservatively, including the requirement for a production key and hobby-watermark rules.
17. **Release evidence drift.** Documentation is aligned to exact workflow artifacts rather than an older test-count estimate.
18. **Required-tool evidence gap.** A dedicated real-editor cross-browser regression explicitly covers rectangle, ellipse, diamond, line, arrow, frame, highlighter, server persistence, and eraser deletion.
19. **Eraser test semantics.** The initial regression pressed only inside a hollow rectangle; tldraw correctly uses outline hit-testing for hollow geos. The test now performs a natural sweep through the outline and passes in all three engines.
20. **Post-merge status drift.** Release documentation previously still described PR #1 as pending after it had already merged. The release record now distinguishes certified source on `main` from the still-disabled production publication step.
21. **Pages enablement procedure.** Changing `CANVAS_DEPLOY_ENABLED` alone does not create a push event. The runbook now explicitly requires a manual workflow dispatch on `main` when no subsequent push occurs.

## Remaining limitations — not repository defects

### Production Cloudflare hibernation is not yet empirically observed

Canvas uses the current Cloudflare Hibernation WebSocket APIs, local Worker restart/reconnect behavior is tested, and no application heartbeat/interval is used to keep the Durable Object awake. Repository CI cannot force a production platform eviction. This is a deployment validation, not missing source functionality.

### Physical stylus/palm behavior is not certified

Responsive and touch/pinch behavior is automated, including the requested viewport matrix. Playwright cannot substitute for Apple Pencil/Android stylus hardware and browser palm rejection.

### Infinite-canvas accessibility has inherent limits

Application controls are named and keyboard-tested. A real screen-reader pass remains appropriate after deployment; spatial canvas content cannot be made equivalent to a semantically linear document solely through application chrome.

### 10,000-shape memory use is high

The hard shape ceiling prevents unbounded growth, but approximately 825 MiB JS heap at 10,000 synthetic shapes is significant. The intended workload is far smaller; do not increase the ceiling without profiling.

### Open access is intentional

Anyone who can use the permitted frontend can read/edit the world. Display names are not identities and origin checks are not authentication. This is the specified security model.

## Quality scores

| Dimension | Score / 10 | Basis |
| --- | ---: | --- |
| Architecture | **9.3** | One authoritative world, native record sync, one SQLite DO, hibernation, no unnecessary services |
| Correctness | **9.3** | Strict types plus unit/Worker/cross-browser/required-tool/production regression |
| Realtime collaboration | **9.3** | Two-way sync, concurrency, undo isolation, presence, reconnect, ten-client convergence tested |
| Persistence | **9.3** | Server authority, restart/close-all persistence, recovery snapshots and restore tested |
| Reliability | **9.0** | Reconnect/error/size/recovery safeguards; live platform hibernation drill remains operational |
| Performance | **8.2** | Strong through 5k synthetic shapes; 10k memory cost is material |
| Storage efficiency | **9.2** | Vector/text only, no binary storage, bounded records/world/backups |
| Mobile UX | **8.3** | Required viewport/touch automation; physical hardware still separate |
| Desktop UX | **9.0** | Native editor behavior retained with reduced product chrome and all required drawing tools exercised in three engines |
| Visual polish | **8.4** | Clean minimal canvas-first UI and optimized-build screenshot evidence |
| Accessibility | **7.9** | Named/keyboard controls; real screen-reader spatial-content audit remains manual |
| Security within open-access model | **9.0** | Layered input/media/admin limits, strict origin handling, secret isolation, zero-vulnerability audit |
| Maintainability | **9.1** | Strict TS, aligned engine versions, lockfile, recovery/deployment documentation |
| Test quality | **9.4** | Real SQLite/Worker, three browser engines, full tool matrix, concurrency, restart/recovery, production preview, performance evidence |
| Deployment readiness | **8.8** | Worker/Pages configs and source gates ready; external production configuration not supplied |
| Documentation | **9.3** | Architecture, research, testing, deployment, recovery, licensing, limitations and exact evidence aligned |

## Scope and simplicity audit

The release contains no:

- accounts/OAuth/passwords;
- workspace/board dashboard or room management;
- image/video/audio/PDF/file storage;
- R2/D1/Postgres/Supabase/Firebase/Redis;
- comments/chat/notifications/social feed;
- AI features;
- task/calendar/database product layer;
- analytics/tracking/advertising;
- paid realtime service.

The production concept remains:

```text
React/Vite/tldraw static frontend
            │
            ▼
Cloudflare Worker
            │
            ▼
one Durable Object: main
            │
            ▼
SQLite sync state + bounded recovery snapshots
```

## Publication decision

**The source release is certified on `main`.** Application release commit `f429294102146b61107de0427b360fab4c1f9f89` passed the complete post-merge quality gate in run `34298529147`. Future code/configuration changes must pass their own exact-SHA gate; documentation maintenance does not redefine the application release commit.

Actual publication still requires the owner's Cloudflare deployment, `ADMIN_TOKEN`, production Worker URL, valid tldraw production key, and explicit `CANVAS_DEPLOY_ENABLED=true`. Once those are configured, manually dispatch **Canvas checks and Pages** on `main` if no later push occurs. After Pages is live, execute the hibernation, recovery, and physical-device checks in [DEPLOYMENT.md](DEPLOYMENT.md) and [TESTING.md](TESTING.md).
