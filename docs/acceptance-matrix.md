# Release acceptance matrix

**Assessment:** Canvas V1 source implementation is release-candidate complete and merged to `main`. Application release commit `f429294102146b61107de0427b360fab4c1f9f89` passed the complete post-merge quality workflow in GitHub Actions run `34298529147`, including the explicit required-tool matrix. The retained exact-`main` artifact records 62 expected E2E passes, 4 intentional project-specific skips, 0 unexpected failures, 0 flaky tests, 1/1 production-preview pass, and zero npm vulnerabilities. Production-only Cloudflare hibernation and physical stylus checks remain separate and are not falsely marked as CI passes. Pages publication is still disabled by owner-controlled configuration.

Legend:

- **PASS** — observed in automated execution or directly verified build/config behavior.
- **IMPLEMENTED** — feature exists, but the exact physical/platform behavior still needs manual verification.
- **OWNER ACTION** — cannot be completed without production account configuration or physical hardware.
- **INTENTIONAL** — explicitly outside V1 scope.

## Product acceptance

| Requirement | Evidence | State |
| --- | --- | --- |
| App called Canvas | Manifest, UI, package metadata | **PASS** |
| Repository `thiepn/canvas` | GitHub repository; hardening PR #1 merged to `main` | **PASS** |
| GitHub Pages compatible | Vite `/canvas/` base; optimized subpath test; official Pages Actions | **PASS** |
| Cloudflare backend deployable | Wrangler dry-run, Worker/DO integration, SQLite migration config | **PASS** |
| One persistent world | Fixed `main` Worker/DO route; no rooms UI | **PASS** |
| No accounts | No signup/login/OAuth/profile system | **PASS** |
| Anyone with permitted frontend can edit | Anonymous admission; open-access model documented | **PASS** |
| Anonymous local identity | UUID/name/color local persistence; presence only | **PASS** |
| Text | Native editor + pointer/text/browser persistence tests | **PASS** |
| Freehand drawing | Native vector draw tool; pointer drawing test | **PASS** |
| Highlighter | Real toolbar drag + server-persistence assertion in Chromium/Firefox/WebKit | **PASS** |
| Rectangle | Real toolbar drag + persistence; collaboration coverage | **PASS** |
| Ellipse | Real toolbar drag + persistence; reconnect follow-up edit | **PASS** |
| Diamond | Real toolbar drag + server persistence in all three engines | **PASS** |
| Line | Real toolbar drag + server persistence in all three engines | **PASS** |
| Arrow/connectors | Real toolbar drag + server persistence in all three engines; native bindings retained | **PASS** |
| Frame | Real toolbar drag + server persistence in all three engines | **PASS** |
| Eraser | Real editor eraser sweep crosses hollow-geo outline; client/server deletion asserted in all three engines | **PASS** |
| Selection/multi-select/move/resize/rotate | Native engine behavior; move/resize browser assertions | **PASS** for representative operations; native remainder retained |
| Group/ungroup/duplicate | Native actions retained in context menu | **IMPLEMENTED** |
| Copy/paste supported Canvas objects | tldraw structured clipboard deliberately preserved | **IMPLEMENTED**; plain-text cross-browser paste **PASS** |
| Undo/redo | Local collaborative undo/redo isolation test | **PASS** |
| Images disabled | Toolbar/handlers/assets/server policy + browser image paste | **PASS** |
| File uploads disabled | No upload store + file/PDF drop tests | **PASS** |
| Realtime sync | A↔B create/move/delete tests in Chromium/Firefox/WebKit | **PASS** |
| Live cursors/presence | Native presence + names + presence-count/rename/removal tests | **PASS** |
| Persistent backend state | SQLite sync storage + Worker restart + zero-client reopen | **PASS** locally |
| Refresh persistence | Multi-client reload checks | **PASS** |
| Close/reopen persistence | All clients closed, new context sees state | **PASS** |
| Automatic reconnect | Forced Canvas transport interruption, visible status, convergence, resumed editing | **PASS** |
| Connection-state UI | Live/offline/reconnecting behavior asserted | **PASS** |
| Hibernation-compatible architecture | Hibernation WebSocket APIs, bounded attachments, auto-response, no app heartbeat | **PASS** by code/runtime compatibility |
| Actual Cloudflare idle hibernation/wake | Requires production platform eviction | **OWNER ACTION** |
| Mobile responsive layout | Nine requested viewport sizes and touch simulation | **PASS** automated |
| Physical tablet/stylus/palm behavior | Requires real hardware | **OWNER ACTION** |
| Desktop Chrome/Firefox/Safari-engine coverage | Chromium/Firefox/WebKit E2E | **PASS** |
| Light/dark/system | Preference/state integration and UI implementation | **PASS** for config behavior; physical display differences remain manual |
| PWA | Manifest/icons/service worker + production manifest smoke | **PASS** |
| Backup/recovery | Real SQLite backups/checksums/rollback + owner restore browser/Worker scenario | **PASS** locally |
| Export | Portable JSON export path | **PASS** implementation/build; deployed download drill recommended |
| Input/rate/size limits | Unit policy tests + malformed/oversize WebSocket browser tests | **PASS** |
| Tests | 33 unit + 5 Worker + 62 E2E + production-preview gate; 4 deliberate project-specific skips | **PASS** on exact application release commit on `main` |
| CI | Exact `main` release commit passed full quality workflow; Pages job remains separately gated | **PASS** |
| Dependency security | Exact-`main` npm audit artifact | **PASS — 0 vulnerabilities** |
| Documentation | README/architecture/research/testing/deployment/security/license/audit | **PASS** |
| No required paid infrastructure | No paid database/realtime/asset service | **PASS**, subject to Cloudflare/tldraw eligibility/usage |
| No app analytics/tracking | None implemented | **PASS** |
| No console-breaking production errors | Production-preview browser assertions | **PASS** |
| Production frontend build | Vite build + bundle audit | **PASS** |

## Requested scenarios A–N

| Scenario | Automated evidence | Result |
| --- | --- | --- |
| A — Fresh browser | Immediate editor, no login, generated local identity | **PASS** |
| B — Draw + refresh | Real pointer stroke then persistence/reload coverage | **PASS** |
| C — Text + refresh | Text creation, cross-client observation, reload | **PASS** |
| D — Shapes/transforms + refresh | Required-tool matrix covers rectangle/ellipse/diamond/line/arrow/frame/highlighter + server persistence; separate move/resize/reload coverage | **PASS** |
| E — Two users | Independent contexts, realtime shapes/text/presence | **PASS** |
| F — Simultaneous edits | Concurrent creates/moves; local undo isolation | **PASS** |
| G — Zero clients | Close all contexts; new context sees state; Worker restart persistence | **PASS** |
| H — Network interruption | Forced Canvas WebSocket interruption, visible paused state, automatic reconnect/convergence | **PASS** |
| I — Image paste | Image clipboard rejected; no crash/persistence | **PASS** |
| J — File drag/drop | Image/PDF files rejected | **PASS** |
| K — Mobile | Nine viewport sizes + Chromium touch/pinch automation | **PASS automated**; real device/stylus remains manual |
| L — Ten users | Ten isolated Chromium contexts, shapes + presence convergence | **PASS** |
| M — Large canvas | 100 / 1k / 5k / 10k real persisted shapes with measured metrics | **PASS**, with 10k memory caveat |
| N — Backup/restore | Snapshot, destructive edit, stale-clock rejection, zero-client restore, restored state | **PASS locally**; repeat once against deployed Worker |

## Performance acceptance

Measured at 10,000 simple shapes:

- serialized scene: ~3.59 MB;
- serialization: ~17.7 ms;
- median frame: ~18.5 ms;
- p95 frame: ~26 ms;
- JS heap: ~825 MiB.

Therefore the hard 10,000-shape ceiling is accepted as a safety/stress boundary, **not** as the recommended working size. Memory is a known engine/workload limitation at that extreme rather than a release blocker for the intended 1–10-person, modest-scene use case.

## Intentional omissions verified

The release does not add:

- accounts, auth, roles, invitations;
- multiple boards/rooms/workspaces UI;
- images/files/PDF/media uploads;
- chat/comments/notifications;
- AI;
- tasks/calendars/databases/templates/marketplace;
- R2/D1/Postgres/Supabase/Firebase/Redis;
- third-party analytics or advertising.

## Final owner/platform acceptance

Source acceptance is complete. Before calling the **live deployment** fully certified:

1. deploy the Cloudflare Worker and set `ADMIN_TOKEN`;
2. configure the actual Worker URL and valid tldraw production key in GitHub;
3. set `VITE_BASE_PATH=/canvas/` and `CANVAS_DEPLOY_ENABLED=true`;
4. manually dispatch **Canvas checks and Pages** on `main` if no later `main` push occurs;
5. confirm the Pages deployment job succeeds;
6. repeat the two-client/close-reopen/reconnect/image-rejection smoke on the live URL;
7. observe a real Cloudflare hibernation/wake cycle;
8. test a real phone/tablet and stylus if stylus use matters;
9. run one noncritical production backup/restore drill.

These are operational/platform checks, not missing V1 application features.
