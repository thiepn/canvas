# Release acceptance matrix

**Assessment:** Canvas V1 source implementation is release-candidate complete. Repository acceptance requires a green quality check on the exact merge SHA. Production-only Cloudflare hibernation and physical stylus checks remain separate and are not falsely marked as CI passes.

Legend:

- **PASS** — observed in automated execution or directly verified build/config behavior.
- **IMPLEMENTED** — feature exists, but the exact physical/platform behavior still needs manual verification.
- **OWNER ACTION** — cannot be completed without the owner's Cloudflare/tldraw production configuration.
- **INTENTIONAL** — explicitly outside V1 scope.

## Product acceptance

| Requirement | Evidence | State |
| --- | --- | --- |
| App called Canvas | Manifest, UI, package metadata | **PASS** |
| Repository `thiepn/canvas` | GitHub repository and PR #1 | **PASS** |
| GitHub Pages compatible | Vite `/canvas/` base; optimized subpath tests; official Pages Actions | **PASS** |
| Cloudflare backend deployable | Wrangler dry-run, Worker/DO integration, SQLite migration config | **PASS** |
| One persistent world | Fixed `main` Worker/DO route; no rooms UI | **PASS** |
| No accounts | No signup/login/OAuth/profile system | **PASS** |
| Anyone with permitted frontend can edit | Anonymous admission; open-access model documented | **PASS** |
| Anonymous local identity | UUID/name/color local persistence; presence only | **PASS** |
| Text | Native editor + pointer/text/browser persistence tests | **PASS** |
| Freehand drawing | Native vector draw tool; pointer drawing test | **PASS** |
| Highlighter | Native vector highlighter exposed and server-allowed | **IMPLEMENTED**; physical stylus review recommended |
| Rectangle | Native reduced toolset + browser collaboration | **PASS** |
| Ellipse | Native reduced toolset + reconnect follow-up edit | **PASS** |
| Diamond | Native reduced geo tool + server allowlist | **IMPLEMENTED**; engine behavior retained |
| Line | Native line tool + server allowlist | **IMPLEMENTED** |
| Arrow/connectors | Native arrow/binding support retained | **IMPLEMENTED** |
| Frame | Native frame tool, one page | **IMPLEMENTED** |
| Eraser | Native eraser retained in toolbar | **IMPLEMENTED** |
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
| Automatic reconnect | Forced network interruption, visible status, automatic convergence, resumed editing | **PASS** |
| Connection-state UI | Live/offline/reconnecting behavior asserted | **PASS** |
| Hibernation-compatible architecture | Hibernation WebSocket APIs, attachments, auto-response, no app heartbeat | **PASS** by code/runtime compatibility |
| Actual Cloudflare idle hibernation/wake | Requires production platform eviction | **OWNER ACTION** |
| Mobile responsive layout | Nine requested viewport sizes and touch simulation | **PASS** automated |
| Physical tablet/stylus/palm behavior | Requires real hardware | **OWNER ACTION** |
| Desktop Chrome/Firefox/Safari-engine coverage | Chromium/Firefox/WebKit E2E | **PASS** |
| Light/dark/system | Preference/state integration and UI implementation | **PASS** for config behavior; visual hardware differences remain manual |
| PWA | Manifest/icons/service worker + production manifest smoke | **PASS** |
| Backup/recovery | Real SQLite backups/checksums/rollback + owner restore browser/Worker scenario | **PASS** locally |
| Export | Portable JSON export path | **PASS** implementation/build; production download drill recommended |
| Input/rate/size limits | Unit policy tests + malformed/oversize WebSocket browser tests | **PASS** |
| Tests | Unit + Worker + three-browser + production + performance suites | **PASS** evidence obtained; exact-head CI is authoritative |
| CI | Read-only quality workflow and gated Pages deployment | **PASS** configuration; exact merge SHA must be green |
| Documentation | README/architecture/research/testing/deployment/security/license/audit | **PASS** |
| No required paid infrastructure | No paid database/realtime/asset service | **PASS**, subject to Cloudflare/tldraw eligibility/usage |
| No app analytics/tracking | None implemented | **PASS** |
| No console-breaking production errors | Production-preview browser assertions | **PASS** during hardening |
| Production frontend build | Vite build + bundle audit | **PASS** during hardening |

## Requested scenarios A–N

| Scenario | Automated evidence | Result |
| --- | --- | --- |
| A — Fresh browser | Immediate editor, no login, generated local identity | **PASS** |
| B — Draw + refresh | Real pointer stroke then persistence/reload coverage | **PASS** |
| C — Text + refresh | Text creation, cross-client observation, reload | **PASS** |
| D — Shapes/transforms + refresh | Rectangle/ellipse create, move/resize and persistence; other native tools retained | **PASS** representative; all-tool manual sweep recommended |
| E — Two users | Independent contexts, realtime shapes/text/presence | **PASS** |
| F — Simultaneous edits | Concurrent creates/moves; local undo isolation | **PASS** |
| G — Zero clients | Close all contexts; new context sees state; Worker restart persistence | **PASS** |
| H — Network interruption | Forced offline/socket close, visible paused state, automatic reconnect/convergence | **PASS** |
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

Therefore the hard 10,000-shape ceiling is accepted as a safety/stress boundary, **not** as the recommended working size. Memory is a known weakness at that extreme.

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

## Final owner-only acceptance

Before calling the live deployment fully certified, complete:

1. deploy Worker and set `ADMIN_TOKEN`;
2. configure the actual Worker URL and valid tldraw production key in GitHub;
3. merge only with an exact-head green quality check;
4. enable Pages deployment;
5. repeat the two-client/close-reopen/reconnect/image-rejection smoke on the live URL;
6. observe a real Cloudflare hibernation/wake cycle;
7. test a real phone/tablet and stylus if stylus use matters;
8. run one noncritical production backup/restore drill.

These are operational/platform checks, not missing V1 application features.
