# Canvas — final implementation and release audit

**Candidate:** `1.0.0-rc.1`  
**Assessment window:** 8–9 September 2026  
**Repository:** `thiepn/canvas`  
**Release branch:** `release/canvas-v1-hardening`  
**PR:** #1

## Release assessment

The original uploaded source candidate was **not** releasable: its first GitHub Actions run could not install the declared tldraw 5.4.1 sync package, it had no genuine lockfile, several SDK boundaries were written against newer source than the available npm packages, and browser/runtime behavior was unverified.

Those blockers were treated as implementation defects rather than documentation caveats. The hardening branch now has a real lockfile, an installable aligned tldraw 5.4.0 stack, strict frontend/Worker type compatibility, executable Worker/Durable Object integration, cross-browser multiplayer evidence, optimized-build evidence, and measured large-scene performance.

**Source-release rule:** PR #1 is mergeable only when `Canvas checks and Pages / quality` is green on its **exact final head SHA**. An older green run does not certify later dependency/config/documentation changes. The GitHub check is therefore the final machine-enforced repository acceptance signal.

**Production deployment is intentionally separate.** No claim is made that the Cloudflare Worker or GitHub Pages site has already been deployed. Real Cloudflare hibernation wake, real production license validation, and physical stylus hardware remain post-deployment/manual checks.

## Executed evidence

| Layer | Result |
| --- | --- |
| Unit/storage suite | **33 passed, 0 failed** |
| Worker/Durable Object integration | **5 passed, 0 failed** |
| Strict TypeScript | Frontend/shared and Worker projects passed during hardening |
| Lint | Passed with zero warnings during hardening |
| Worker production dry run | Passed during hardening |
| Production Vite build | Passed during hardening; bundle audit executed |
| Cross-browser collaboration/interaction | **61 passed, 4 intentional skips, 0 failed** across Chromium, Firefox, WebKit |
| Ten-client convergence | Passed in Chromium with ten isolated contexts |
| Close-all/reopen persistence | Passed |
| Collaborative undo isolation | Passed |
| Network reconnect without page refresh | Passed |
| Image/PDF/file rejection | Passed across browser suite |
| Administrative backup/restore | Passed locally through real Worker path |
| Optimized `/canvas/` preview | Implemented as release gate; production build excludes test bridge |
| Large-scene benchmark | Passed at 100, 1k, 5k, and 10k persisted shapes |

The final exact-head CI reruns these checks after the current dependency/documentation hardening. The table records behavior already observed during the hardening sequence, not a substitute for that exact-head gate.

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
- 10,000 is a **stress ceiling**, not a recommended everyday world size. Heap use near 825 MiB is the clearest measured scalability weakness.
- Serialized current-state growth is approximately 359 bytes/simple synthetic shape in this workload and remains below the 8 MiB product world budget at 10,000 shapes.

No claim is made that every real scene has the same cost; freehand geometry and rich text can be denser than simple synthetic shapes.

## Significant defects found and fixed

1. **Unpublished dependency target.** `@tldraw/sync@5.4.1` was not available from npm despite the GitHub v5.4.1 release. The entire interoperating tldraw family is now exact-pinned to 5.4.0.
2. **SDK API drift.** Obsolete editor asset props, external-text payload fields, context-menu typing, and Durable Object sync hook boundaries were updated to the actual installed 5.4.0 API instead of weakening TypeScript.
3. **Vite asset-loader incompatibility.** The Vite-specific tldraw asset import caused Vite 8/Rolldown dependency-optimizer failures. Canvas now uses tldraw's documented `getAssetUrlsByMetaUrl()` loader, which works in both dev/E2E and production builds.
4. **Second-build module-graph failure.** `vite.config.ts` imported a browser runtime config module, which caused a later optimized build to see an invalid export graph. Build-path normalization is now isolated inside Vite config.
5. **Cross-browser plain-text paste.** Firefox synthetic paste did not follow the same library path as Chromium/WebKit. Canvas now owns ordinary external plain-text paste while preserving tldraw's structured internal vector clipboard.
6. **Reconnect timing model.** The reconnect test now models a user returning to a visible tab before network recovery and allows the sync client's legitimate backoff window. It still requires automatic reconnection and resumed bidirectional editing without refresh.
7. **Presence-only identity.** Canvas avoids persistent attribution/user records and rejects `user` records on the server; anonymous identity remains local + ephemeral presence.
8. **Media bypasses.** Images/files are blocked in toolbar/content handlers, capture-phase paste/drop, asset storage, structured paste validation, and server authorization.
9. **Hibernation reconstruction.** Authoritative state remains SQLite. Socket attachments hold bounded resumable session state; incomplete/oversized resume state causes a safe reconnect instead of corrupting or trusting partial state.
10. **Socket replacement race.** A closing old WebSocket cannot tear down a newer socket using the same session ID.
11. **Unbounded input.** Frame/message/record/text/world/coordinate/connection limits and rate/byte token buckets protect the sync boundary without adding a complex abuse service.
12. **World-budget efficiency.** Current-world bytes are tracked incrementally by record rather than serializing the entire world on every drag.
13. **Recovery correctness.** Rolling snapshots, pre-deletion capture, pre-restore snapshots, checksums, bounded decompression, transactional chunk storage, exact-clock restore, and zero-client restore are implemented and tested.
14. **Pages path mismatch.** The actual repository is lowercase `thiepn/canvas`; all build/test/deployment paths now use `/canvas/`, not `/Canvas/`.
15. **Dependency advisory.** Current Wrangler 4.130.0 resolves Miniflare with advisory-affected `sharp 0.35.2`. The lockfile uses an explicit transitive override to patched `sharp 0.35.4`; the high-severity npm-audit gate and Worker suite validate that exact graph before merge.
16. **License documentation drift.** tldraw's current license-key documentation reports hobby/trial production telemetry that an older general license page does not. Third-party notices now use the conservative current license-key description.

## Remaining limitations — not release-blocking for V1 source

### 1. Production Cloudflare hibernation is not yet empirically observed

The code uses Cloudflare's hibernation APIs, local Worker restart/reconnect behavior is tested, and no application heartbeat/interval prevents hibernation. Repository CI cannot force or prove a real Cloudflare platform idle eviction. Verify this on the deployed Worker.

### 2. Physical stylus/palm behavior is not certified

Responsive and touch/pinch behavior is automated, including the requested viewport matrix, but Playwright cannot substitute for Apple Pencil/Android stylus hardware and browser palm rejection.

### 3. Accessibility is partial by nature

Application controls are named and keyboard-tested. A real screen-reader pass and deployed accessibility scan remain useful. Infinite spatial canvas content is not equivalent to a semantically linear document.

### 4. 10,000-shape memory use is high

The hard shape ceiling protects against unbounded growth, but ~825 MiB JS heap at 10,000 synthetic shapes is significant. Do not increase the ceiling without profiling and architectural justification.

### 5. Open access is intentional

Anyone who can use the permitted frontend can read/edit the world. Display names are not identities. Origin checks are not authentication. This is a product requirement, not a security claim.

## Quality scores

These scores reflect the implemented/tested release candidate and explicitly penalize unperformed production/hardware checks.

| Dimension | Score / 10 | Basis |
| --- | ---: | --- |
| Architecture | **9.2** | One authoritative world, native record sync, one SQLite DO, hibernation, no unnecessary services |
| Correctness | **9.0** | Strict types plus unit/Worker/cross-browser regression; production platform still separate |
| Realtime collaboration | **9.1** | Two-way sync, concurrency, undo isolation, presence, reconnect, ten-client convergence tested |
| Persistence | **9.2** | Server authority, restart/close-all persistence, recovery snapshots and restore tested |
| Reliability | **8.8** | Reconnect/error/size/recovery safeguards; live Cloudflare hibernation drill outstanding |
| Performance | **8.2** | Strong through 5k synthetic shapes; 10k memory/p95 frame cost is material |
| Storage efficiency | **9.1** | Vector/text only, no binary storage, bounded records/world/backups, ~3.6 MB simple 10k scene |
| Mobile UX | **8.2** | Required viewport/touch automation; real device/stylus audit pending |
| Desktop UX | **8.8** | Native editor behavior retained with reduced product chrome and cross-browser interaction tests |
| Visual polish | **8.3** | Clean minimal canvas-first UI and production screenshot evidence; not a dedicated design-system project |
| Accessibility | **7.8** | Named/keyboard controls and contrast/focus work; screen-reader/manual spatial-content limits remain |
| Security within open-access model | **8.8** | Layered input/media/admin limits, strict origin handling, secret isolation, dependency audit gate |
| Maintainability | **9.0** | Strict TS, clear boundaries, aligned engine versions, real lockfile, upgrade/recovery documentation |
| Test quality | **9.2** | Real SQLite/Worker, three browsers, concurrency, restart/recovery, production preview, performance evidence |
| Deployment readiness | **8.4** | Worker/Pages configs and gated Actions ready; owner secrets/license/live deployment not performed |
| Documentation | **9.0** | Architecture, research, testing, deployment, recovery, licensing, limitations, audit kept explicit |

No dimension is given a cosmetic 10/10. The main remaining uncertainty is outside repository automation: real production infrastructure and physical stylus hardware.

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

That simplicity is preserved deliberately.

## Publication decision

**Repository code is suitable for release once the exact-head quality check is green.** After merge, actual publication still requires the owner's Cloudflare deployment, `ADMIN_TOKEN`, production Worker URL, valid tldraw production key, and explicit `CANVAS_DEPLOY_ENABLED=true`.

After live deployment, execute the hibernation, recovery, and physical-device checks in [DEPLOYMENT.md](DEPLOYMENT.md) / [TESTING.md](TESTING.md). Do not claim those checks from CI evidence.
