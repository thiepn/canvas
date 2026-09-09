# Canvas — final implementation and release audit

**Candidate:** `1.0.0-rc.2`  
**Assessment window:** 8–9 September 2026  
**Repository:** `thiepn/canvas`  
**Production architecture:** Excalidraw + Supabase Postgres/Realtime  
**Release-hardening change set:** PR #4

## Executive assessment

Canvas now ships the architecture actually intended for the public application: a static React/Vite frontend using **Excalidraw 0.18.1** and **Supabase Postgres + Realtime** for the one permanent shared canvas. Anonymous identity is local to the browser; there is no account, login, role, room picker, media upload, analytics layer, or application server required for normal production use.

The earlier tldraw + Cloudflare Worker/Durable Object implementation remains in the repository only as historical regression infrastructure. Its mature unit, protocol, persistence, recovery and cross-browser suites are still useful for detecting regressions in shared policies and legacy code, but they are **not** presented as proof of the shipped Supabase/Excalidraw runtime.

The release-hardening work corrected that evidence boundary. The live gate now drives real Excalidraw controls and persists through the isolated Supabase `canvas_ci_elements` table. The compiled-production gate builds the same Excalidraw/Supabase path deployed by GitHub Pages and verifies the built `/canvas/` application rather than forcing the legacy Worker harness.

A predecessor head of PR #4, commit `5ca7f14a523ed52664aa4d60652dcbd00ec9724e`, passed the complete quality workflow in Actions run `34324866947`: dependency install/audit, lint, strict TypeScript, unit tests, Worker regression tests, Worker dry-run, production build, the retained Playwright matrix, the real live Supabase gate, and the compiled-production Supabase smoke. The final release candidate additionally expands both real production-path Playwright gates to Chromium, Firefox and WebKit. **The PR must not be merged unless the exact final head passes those expanded gates.** The Actions workflow on the exact commit is the authoritative release record.

## What is actually shipped

### Frontend

- React 19 + TypeScript + Vite.
- Excalidraw 0.18.1 is the production infinite-canvas engine.
- GitHub Pages repository base path `/canvas/` is supported explicitly.
- The legacy tldraw editor import is compile-time guarded so normal production builds do not intentionally select or require the legacy runtime.
- The app exposes only the vector/document interactions appropriate to Canvas; image/file media paths are not part of the persistence model.
- Anonymous display identity is generated and retained locally in the browser rather than stored as an account.

### Persistence and realtime

Production state is row-based in `public.canvas_elements`. Each Excalidraw element is stored independently with:

- immutable row ID;
- version and version nonce;
- tombstone state;
- validated JSON element body;
- bounded updater identifier;
- database update timestamp.

Supabase Realtime publishes row changes to connected clients. The client reconciles snapshots and Realtime events by element version rather than replacing a stale whole-document blob. This is the central concurrency property of the production architecture.

### Database protection

The production schema enforces server-side constraints for:

- element ID length and ID/body agreement;
- version and nonce ranges;
- JSON-object shape;
- maximum serialized element size;
- the allowed persistent vector element types: rectangle, diamond, ellipse, line, arrow, freedraw, text and frame.

Row Level Security is enabled. Anonymous/authenticated public clients may read, insert and update the shared world as required by the open-link product model. Physical `DELETE` is not granted on the production table; ordinary deletion is represented by the element tombstone. The isolated CI table intentionally grants cleanup DELETE so automated runs can start and finish empty.

The explicit security model remains: **anyone who has the public Canvas URL can read and edit the shared canvas.** This is a product decision, not authentication security.

## Recovery and destructive-edit protection

Production changes have an owner-only recovery layer in private schema `canvas_admin`:

- each accepted production UPDATE or physical DELETE captures the previous row;
- history records are grouped by PostgreSQL transaction ID;
- history is capped to the newest 20 captured versions per element;
- `canvas_admin.restore_transaction(txid)` restores the affected previous states using newer element versions, allowing Realtime clients to converge on the recovered state;
- the private schema, history table and restore function are inaccessible to `public`, `anon` and `authenticated` roles.

The recovery trigger was explicitly corrected so a `BEFORE UPDATE` returns `NEW` while a `DELETE` returns `OLD`; returning `OLD` for updates would have silently discarded edits. Recovery behavior was exercised with a rollback-only SQL self-test so validation did not leave synthetic content in the production world.

This recovery mechanism deliberately requires privileged database access. Canvas does not expose a public restore HTTP endpoint or ship a service-role key to the browser.

## Test and release evidence

### Production-path gates

These are the tests that certify what users actually receive:

1. **Live Supabase collaboration test** — two independent browser contexts connect to the real Excalidraw/Supabase application using the isolated `canvas_ci_elements` table. Client A creates a real rectangle through Excalidraw UI; the row must persist; client B receives the shared world and deletes the rectangle; the database must converge to the tombstone. Browser page errors fail the test.
2. **Compiled production smoke** — Vite builds the real `/canvas/` Excalidraw/Supabase bundle, Playwright opens the compiled preview, verifies the production engine marker and Live state, confirms no test bridge is shipped, creates a real rectangle, verifies Supabase persistence, checks the PWA manifest and repository-path assets, reloads, and verifies persistence remains.
3. Both gates are configured sequentially for **Chromium, Firefox and WebKit**. Sequential execution prevents the shared isolated CI table from being cleaned by one browser while another test is using it.

### Retained regression gates

The repository also retains the earlier Worker/tldraw test harness. It is intentionally labeled as regression evidence rather than production certification. Its established evidence includes:

- **33** unit/storage/security tests;
- **5** Worker/Durable Object integration tests;
- **62 expected Playwright passes with 4 intentional project-specific skips** across Chromium, Firefox and WebKit in the prior full matrix;
- two-client collaboration, independent concurrent edits, local undo isolation, reconnect, presence, rename/disconnect cleanup, ten-context convergence, pointer drawing, text, resize, paste/media rejection, accessible controls, the requested viewport matrix, touch behavior, phone controls, required vector tools and eraser behavior;
- Worker protocol limits, CORS, rate/size guards, historical SQLite snapshot/recovery behavior and restart persistence.

These tests remain valuable because they exercise shared policies and protect the repository from accidental breakage, but a green legacy suite cannot substitute for the production-path gates above.

### Static quality gates

The CI workflow also requires:

- `npm ci` from the committed lockfile;
- full dependency audit capture and rejection of high/critical findings;
- ESLint with zero warnings;
- strict TypeScript for frontend and retained Worker code;
- optimized Vite production build plus bundle audit;
- retained Wrangler dry-run for the legacy Worker package;
- diagnostic artifact retention on success or failure.

At the predecessor certified PR head, npm reported zero known vulnerabilities and every quality step passed.

## Deployment audit

`.github/workflows/ci.yml` deploys GitHub Pages only after the `quality` job succeeds on `main`. Pull requests cannot deploy. A successful merge therefore does **not** bypass testing: the merged `main` commit is tested again, and only then may `actions/deploy-pages` publish `dist`.

The deploy build uses `/canvas/` by default and can accept a repository variable override for a future custom-domain root. Supabase browser configuration is public by design; no service-role or recovery credential is embedded in the frontend.

A release is complete only after all of the following are true:

1. exact PR head is green;
2. PR #4 is merged;
3. merged `main` quality run is green;
4. `deploy-pages` succeeds;
5. the public GitHub Pages URL is fetched and verified to serve the Excalidraw/Supabase build.

## Acceptance matrix

| Area | Release status / gate |
| --- | --- |
| One permanent shared world | Implemented; fixed production table/world |
| No accounts or room UI | Implemented |
| Anonymous local identity | Implemented |
| Text/vector drawing/shapes/frames | Implemented through Excalidraw |
| No persistent images/files/media | Enforced by production persistence type constraints and application behavior |
| Server-authoritative persistence | Supabase Postgres |
| Low-latency realtime | Supabase Realtime |
| Stale whole-document overwrite avoidance | Per-element versioned rows |
| Reconnect/convergence | Realtime client + live two-client gate |
| Cross-browser production path | Chromium + Firefox + WebKit live and compiled gates |
| GitHub Pages `/canvas/` | Build/deploy workflow configured |
| Mobile viewport containment | Retained cross-browser regression matrix; production device/manual validation still appropriate |
| Accessibility of application chrome | Retained automated regression coverage; manual screen-reader pass remains appropriate |
| PWA manifest/shell | Compiled-production smoke verifies manifest; offline collaboration is not promised |
| Backend RLS/validation | Implemented in committed Supabase migrations |
| Media/type/record size bounds | Database constraints + client restrictions |
| Destructive-edit recovery | Private transaction history + owner-only restore |
| Reproducible backend | Supabase migrations committed |
| Dependency/security audit | CI-enforced |
| Production deployment | Automatic only after green `main`; must be externally verified after merge |

## Known limitations and residual risk

### Open-link security model

There is intentionally no authentication or authorization boundary between trusted editors. Possession of the URL is effectively edit access. RLS protects the database from operations outside the intended anonymous capability set; it does not turn the product into a private authenticated workspace.

### Supabase service dependence

Realtime collaboration and persistence depend on the availability and quotas of the configured Supabase project. The application has no separate paid failover service and promises no independent SLA.

### Conflict model is element-level, not character-level CRDT text

Independent elements converge by Excalidraw version/versionNonce ordering. Simultaneous conflicting modifications to the same element are resolved deterministically; Canvas does not implement a custom character-level collaborative text CRDT on top of Excalidraw.

### Offline collaboration is not supported

The PWA shell may cache static assets, but Canvas does not claim safe offline collaborative editing followed by arbitrary merge. Loss of connectivity should be treated as a collaboration interruption, not as a separate offline-authoritative branch.

### Physical stylus and palm rejection are not automated

Playwright can exercise touch and browser input behavior, but it cannot replace physical Apple Pencil/S Pen/stylus hardware and palm-rejection testing.

### Infinite-canvas accessibility has inherent limits

Application chrome can be named and keyboard-operable, but spatial canvas content is not semantically equivalent to a linear document for assistive technology. A manual screen-reader pass remains appropriate after deployment.

### Legacy code remains in the repository

The old tldraw/Worker implementation is retained to preserve regression evidence and historical work. It increases dependency and maintenance surface even though the production build is guarded away from that runtime. A future cleanup release may remove it once equivalent production-path unit/integration coverage exists.

## Final quality scoring

Scores below assess the current release architecture and its implemented safeguards, while reserving perfect scores for evidence that cannot be automated here.

| Criterion | Score / 10 | Rationale |
| --- | ---: | --- |
| Architecture | 9.0 | Simple static frontend + managed Postgres/Realtime; legacy code remains as debt |
| Correctness | 9.0 | Versioned per-element state, DB constraints and real production-path tests |
| Realtime collaboration | 9.0 | Real two-client Supabase gate; same-element conflicts are deterministic rather than CRDT text merging |
| Persistence | 9.5 | Postgres-authoritative rows with reload verification |
| Recovery | 9.0 | Private transaction history and restore; no scheduled full-world snapshot service |
| Reliability | 8.5 | Managed backend and reconnect path; depends on Supabase availability/quota |
| Storage efficiency | 9.0 | Per-element rows/tombstones; bounded individual record size |
| Desktop UX | 9.0 | Mature Excalidraw interaction model with focused Canvas shell |
| Mobile UX | 8.5 | Automated responsive/touch evidence plus remaining hardware validation |
| Visual polish | 8.5 | Clean production editor shell; final subjective polish remains device-dependent |
| Accessibility | 8.0 | Named chrome and automated checks; spatial-canvas limitations remain |
| Security under open model | 9.0 | RLS, bounded schema, no service-role key, private recovery; public edit is intentional |
| Maintainability | 8.5 | Strict TS and committed migrations; dual legacy/production code raises surface area |
| Automated tests | 9.0 | Broad historical matrix plus real three-browser Supabase/compiled release gates |
| Deployment | 9.0 | Pages gated on green main; public endpoint still requires post-merge verification |
| Documentation | 9.5 | Architecture, security, testing, deployment/recovery, notices and migrations aligned |

**Overall release assessment: approximately 9.0/10, conditional on the exact final PR head, merged `main`, Pages deployment and public endpoint all passing their respective gates.**

The remaining gap to a higher score is no longer a missing basic implementation. It is primarily broader production-specific stress/device/accessibility evidence and the maintenance cost of retaining the historical Worker/tldraw implementation alongside the shipped Excalidraw/Supabase path.
