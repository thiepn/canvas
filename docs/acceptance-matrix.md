# Release acceptance matrix

This matrix describes the current Excalidraw + Supabase application after Phase 8. Historical tldraw/Cloudflare evidence is no longer part of the active release contract.

Legend:

- **PASS** — covered by current production-path automation or directly verified configuration.
- **MANUAL** — requires physical hardware or a subjective assistive-technology pass.
- **INTENTIONAL** — explicitly outside current product scope.

## Product and architecture

| Requirement | Current evidence | State |
| --- | --- | --- |
| One permanent shared world | Fixed production table/world; no room UI | **PASS** |
| No accounts/login | Anonymous browser-local identity only | **PASS** |
| Open-link editing model | RLS allows intended anonymous read/write capability | **PASS** |
| React/Vite static application | Production build + Pages deploy | **PASS** |
| Excalidraw production editor | Live and compiled-production engine marker | **PASS** |
| Supabase authoritative persistence | Real Postgres rows + reload tests | **PASS** |
| Supabase Realtime collaboration | Two-client live browser matrix | **PASS** |
| Single active runtime | Phase 8 removes tldraw/Worker/Wrangler; architecture audit enforces absence | **PASS** |
| GitHub Pages `/canvas/` | Compiled-production matrix + deployed-site verifier | **PASS** after each green `main` release |

## Editor behavior

| Requirement | Current evidence | State |
| --- | --- | --- |
| Rectangle/ellipse/diamond/line/arrow | Real Excalidraw interaction + Supabase persistence | **PASS** |
| Freehand drawing | Production editor/type allowlist | **PASS** |
| Text | Slow text-session durability coverage | **PASS** |
| Frames | Real browser tool matrix / production editor | **PASS** |
| Eraser/deletion | Tombstone convergence in real two-client path | **PASS** |
| Selection/move/resize/rotate/duplicate/undo | Native Excalidraw behavior; representative production browser coverage | **PASS** |
| Images/files/media excluded | Browser filtering + database type constraints | **PASS** |
| Wheel zoom | Cross-browser live coverage | **PASS** |
| 320px mobile containment | Live browser coverage | **PASS** |
| Physical stylus/palm rejection | Requires real hardware | **MANUAL** |

## Synchronization and durability

| Requirement | Current evidence | State |
| --- | --- | --- |
| Logical operation grouping | Unit + real pointer/text tests | **PASS** |
| One final durable write for normal gesture | Phase 3 real-browser assertions | **PASS** |
| Long-operation safety checkpoints | Real-browser coverage | **PASS** |
| Failed-write retry without data loss | Injected REST failure + `Retry now` test | **PASS** |
| Truthful `Saved` state | Pure state model + live recovery tests | **PASS** |
| Low-latency in-progress previews | Broadcast preview test before any DB write | **PASS** |
| Abandoned preview expiry | Real browser + protocol unit coverage | **PASS** |
| Same-element deterministic convergence | Version/versionNonce conflict tests | **PASS** |
| Missed-event repair | Revision anti-entropy browser test | **PASS** |
| Reconnect convergence | Repeated disconnect/reconnect browser coverage | **PASS** |
| Page lifecycle interrupted gesture recovery | `pagehide`/`pageshow` live test | **PASS** |
| Offline-authoritative editing/merge | Deliberately unsupported; editing pauses when trust is lost | **INTENTIONAL** |

## Scale and observability

| Requirement | Current evidence | State |
| --- | --- | --- |
| Paginated initial hydration | Unit + large-scene browser coverage | **PASS** |
| Indexed unchanged-element skipping | Unit + live diagnostics coverage | **PASS** |
| 100/1k/5k/10k performance fixtures | Manual performance workflow | **PASS** as evidence, not an SLA |
| Opt-in content-free diagnostics | Unit/live diagnostics tests | **PASS** |
| Production connection/save-health metrics | Explicit data attributes + diagnostics runtime | **PASS** |

## Security and recovery

| Requirement | Current evidence | State |
| --- | --- | --- |
| Vector-only server validation | Supabase constraints + live forbidden-record test | **PASS** |
| Bounded element size/shape | Client validation + database constraints | **PASS** |
| Stale-write rejection | Database trigger + conflict tests | **PASS** |
| No anonymous physical DELETE in production | Migration/RLS contract | **PASS** |
| No service-role key in browser | Public config/build contract | **PASS** |
| Owner-only destructive recovery | Private `canvas_admin` schema/function | **PASS** |
| CI world isolated from production | `canvas_ci_elements` override + serialized jobs | **PASS** |
| Auth/private workspace permissions | Not part of the open-link product | **INTENTIONAL** |

## Release engineering

| Requirement | Current evidence | State |
| --- | --- | --- |
| Reproducible lockfile install | `npm ci` gate | **PASS** |
| No high-severity npm vulnerabilities | `npm audit --audit-level=high` | **PASS** |
| Retired runtime cannot silently return | `npm run audit:architecture` | **PASS** |
| ESLint zero-warning gate | CI | **PASS** |
| Strict TypeScript on compiled surfaces | CI | **PASS** |
| Production-model unit suite | CI | **PASS** |
| Chromium/Firefox/WebKit live matrix | CI | **PASS** |
| Chromium/Firefox/WebKit compiled-production matrix | CI | **PASS** |
| Exact PR head certification | Required before merge | **PASS only when exact head is green** |
| Merged `main` recertification | Required after merge | **PASS only when exact main SHA is green** |
| Pages deployment | Gated on green `main` quality | **PASS only after deployment job succeeds** |
| Published-site verifier | Runs against returned Pages HTTPS URL | **PASS only after verifier succeeds** |

## Phase 8 cleanup result

The Phase 7 dependency install audited 599 packages. The validated Phase 8 graph installs 431 packages and audits 432 with zero vulnerabilities, removing roughly 28% of the installed package count. The guarded cleanup removes about 6.9k lines of historical Worker/tldraw source, tests and configuration while retaining the production browser, persistence, recovery and performance evidence added in Phases 1–7.

## Remaining manual/platform checks

- physical Apple Pencil/S Pen/stylus and palm-rejection behavior;
- a full manual screen-reader/navigation pass over application chrome and realistic spatial content;
- Supabase quota/availability monitoring for any substantially larger public audience.

Those are not evidence gaps that justify retaining a second application runtime.
