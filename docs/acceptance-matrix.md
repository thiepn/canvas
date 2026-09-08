# Release acceptance matrix

**Date:** 2026-09-08. **Overall result: not certified.**

“Implemented” means the source contains the behavior. It is not synonymous with an observed runtime pass. “Core pass” covers only the dependency-independent tests named in the audit. Full application/runtime verification remains blocked by dependency installation.

| Requirement | Implementation / evidence | Release state |
| --- | --- | --- |
| App and repository called Canvas | Source directory, package title, manifest and UI | Source verified |
| GitHub Pages / repository subpath | Vite base `/Canvas/`, optimized-preview test, modern Pages workflow | Build/live check pending |
| Cloudflare backend | Worker, SQLite Durable Object migration and deploy scripts | Packaging/deployment pending |
| Exactly one persistent world | Fixed `main` route; page/document policy | Core policy passed; runtime pending |
| No accounts; anyone with link edits | No account routes/UI; open editor admission | Source verified; runtime pending |
| Local anonymous identity | UUID, curated color, editable name, local storage; no persistent user records | Identity core passed; presence integration pending |
| Text and lightweight formatting | Native editor text/rich-text controls | Browser verification pending |
| Freehand and highlighter | Native vector tools; bounded records | Browser/stroke-density verification pending |
| Rectangle, ellipse, diamond | Reduced native geo tools and server allowlist | Policy core passed; browser pending |
| Line, arrow and connectors | Native line/arrow/binding support | Browser verification pending |
| Frame/zone | Native frames, one page | Browser/nesting verification pending |
| Eraser | Native tool in reduced toolbar | Browser verification pending |
| Selection, multi-select, move, resize, rotation | Native engine behavior retained | Browser verification pending |
| Group/ungroup, duplicate, copy/paste | Native supported actions/structured copy path | Browser verification pending |
| Undo/redo | Native history; accessible Canvas-menu buttons; collaborative isolation test | Test not executed |
| Images, files and media excluded | UI, clipboard/external handlers, no-asset store, server allowlist | Policy core passed; browser/Worker pending |
| Realtime document synchronization | Official `useSync` / `TLSocketRoom` deltas | Multiplayer tests not executed |
| Cursors, selection presence, names and online list | Native presence plus local identity; deduplicated menu list | Multiplayer tests not executed |
| Backend persistence with zero clients | SQLite native sync store | Full application scenario not executed |
| Refresh and close/reopen persistence | Browser and Worker restart tests written | Not executed |
| Automatic reconnect / truthful connection state | Official reconnect plus live/offline UI and temporary read-only behavior | Browser test not executed |
| Hibernation and wake recovery | Auto-response, attached session snapshots, safe reconnect fallback | Real Cloudflare verification pending |
| Efficient presence/document separation | Native sync presence lane; no app cursor-persistence loop | Source verified; traffic measurement pending |
| Home, zoom and fit | Native camera methods; mobile menu controls | Browser verification pending |
| Mobile/tablet/desktop | Responsive CSS, nine viewport tests and Chromium touch test | Tests and physical-device checks pending |
| Light/dark/system | Local preference and native editor theme | Preference core passed; visual verification pending |
| PWA | Manifest, original icons, scoped static service worker | Build/installability check pending |
| Backup/recovery | Checksummed gzip SQLite chunks, bounded rotation, secret/clock/zero-client guarded restore | Storage core passed; whole-world restore pending |
| Export | Server-authoritative JSON or explicitly unconfirmed local recovery copy | Schema core passed; browser download pending |
| Input/rate limits | Bounded JSON/frames/chunks, token buckets, record/world budgets | Core passed; real Worker/browser pending |
| Tests and CI | Core, Worker, three browsers, optimized preview and performance workflow | Core passed; CI not run |
| No required paid infrastructure | Cloudflare free-tier target, no external paid service | Conditional on usage and hobby-license eligibility |
| No console-breaking errors | Browser error assertions included | Not verified |
| Production build | Vite/Worker configuration and scripts present | Blocked; no build output |
| Documentation | README, architecture, deployment, security, testing, research, notices and audit | Source reviewed |

## Requested manual scenarios A–N

| Scenario | Corresponding implementation/test | Actual result |
| --- | --- | --- |
| A — Fresh browser, immediate anonymous entry | Identity unit tests; peer browser fixture and production preview | Identity unit portion passed; browser scenario not run |
| B — Draw and refresh | `interaction.spec.ts` real pointer strokes and reload | Not run |
| C — Text and refresh | Interaction, multiplayer and production-preview tests | Not run |
| D — Shapes, transforms and refresh | Native toolset; precise create/resize/move tests | Not run; manual every-tool review also required |
| E — Two users, shared cursors and edits | `collaboration.spec.ts`, independent isolated browser contexts | Not run |
| F — Simultaneous independent edits | Concurrent create/update and local-undo isolation tests | Not run |
| G — Persistence after all clients close | Multiplayer close/new-context and Worker restart tests | Not run for the world; backup SQL close/reopen core passed |
| H — Network interruption and recovery | Offline toggle and WebSocket-close/reconnect test | Not run |
| I — Image paste rejection | Clipboard/policy unit tests plus real browser paste test | Policy core passed; browser not run |
| J — File drag/drop rejection | Image/PDF drop browser test | Not run |
| K — Mobile toolbar and gestures | Nine sizes, touch text, CDP pinch and menu controls | Not run; physical hardware still needed |
| L — Ten simultaneous clients | Ten isolated browser contexts with live edits/presence | Not run |
| M — Thousands of elements | 100/1,000/5,000/10,000-object benchmark with actual metrics output | Not run; no performance numbers supplied |
| N — Backup, destructive edit and owner restore | Real SQL backup/core reconstruction plus browser/CLI restore scenario | Core portion passed; complete restore scenario not run |

No scenario is silently promoted from “test written” to “passed.” Complete these checks and retain real logs before changing the release decision.
