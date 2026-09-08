# Canvas — implementation and release audit

**Candidate:** 1.0.0-rc.1

**Assessment date:** 8 September 2026

**Publication decision:** **NOT APPROVED FOR PRODUCTION.**

This is an implemented source candidate with executable core tests, not a completed deployment or a certified working editor. The release-blocking environment failure is explicit: npm registry DNS resolution returned `EAI_AGAIN`, and a bounded installation attempt timed out. No dependency tree could be installed. This prevented genuine SDK-linked type checking, lint, Worker execution, browser execution and production builds. There is no fabricated lockfile or bundle.

## Verified results

| Check | Actual result | Evidence |
| --- | --- | --- |
| Dependency-independent unit/integration core | **33 passed; 0 failed; 0 skipped** | `docs/evidence/unit.log` |
| SQLite backup persistence | Passed real file close/reopen, chunk storage, compression/checksum, retention and atomic transaction rollback tests | Included in the 33 tests; no fake SQLite replacement |
| Strict TypeScript for the tested core | Passed, including unused-local/parameter checks | `docs/evidence/core-typecheck.log` and execution manifest |
| Project-source syntax | Passed for 52 TS/TSX/JS files | `docs/evidence/syntax.log` |
| Full lint | Blocked: `eslint` is not installed | `docs/evidence/lint-attempt.log` |
| Full SDK/Worker TypeScript | Blocked: generated Worker types require the uninstalled `wrangler` | `docs/evidence/typecheck-attempt.log` |
| Production build | Blocked: `vite` is not installed | `docs/evidence/build-attempt.log` |
| Worker deployment dry run | Blocked: `wrangler` is not installed | `docs/evidence/check-worker-attempt.log` |
| Worker integration tests | Setup failed before assertions: Wrangler is not installed | `docs/evidence/test-worker-attempt.log` |
| Browser, multiplayer, stress, accessibility runtime and production-preview tests | Written, **not executed** | `tests/e2e/`; no passing result asserted |
| Package resolution, audit and real lockfile | Blocked by registry access | Registry/install evidence; no `package-lock.json` |
| Actual GitHub/Cloudflare publication | Not performed | No remote commit, PR, site URL or deployment claimed |

Syntax checks do not resolve imports or validate third-party APIs. Core tests do not prove that the editor, the sync library and the Cloudflare runtime work together. The source can still contain SDK-integration errors that only the outstanding checks will reveal.

## Findings fixed during source review

1. **Presence-only identity:** tldraw 5.4 can persist user records for attribution. Canvas supplies a null current-user store, derives anonymous presence separately, and rejects persistent user records on the server.
2. **Media bypasses:** removing toolbar buttons was insufficient. File/image paste and drop, external asset/content handlers, structured imports and server record authorizers are also restricted. Plain text and supported vector copies retain the native path.
3. **Hibernation attachment limits:** full session/schema snapshots can be too large for Cloudflare attachments. Exact-version schemas are compacted, attachment size is checked, and oversized/incomplete sessions safely reconnect rather than being resumed with incomplete state.
4. **Socket replacement race:** a closing old socket must not remove a newly connected replacement with the same session ID. Cleanup checks the concrete socket identity.
5. **Unbounded message assembly:** frame and aggregate limits, chunk-order checks, aggregate deadlines and per-connection token buckets bound native chunked input before it reaches sync handling.
6. **Repeated world serialization:** the world-byte budget uses incremental per-record accounting rather than serializing the entire world for every edit or cursor move.
7. **Recovery gaps:** rolling backups are complemented by a rate-limited pre-deletion capture. Reconstruction handles changed/deleted records in the same committed operation. A restore requires zero open clients, a private secret, exact current clock and a pre-restore backup.
8. **Backup transaction safety:** compressed chunks and retention changes are stored transactionally. Real SQLite tests verify rollback after injected failure and reject checksum corruption.
9. **Test-data isolation:** optimized-preview tests explicitly build against a loopback test Worker into `.preview-dist`. A developer's production API environment cannot redirect those destructive tests to the live world.
10. **Accidental deployment:** Pages publication requires the complete quality job, a committed real lockfile, HTTPS backend configuration, a nonblank SDK key and explicit enablement. A missing key is a visible production configuration error.
11. **Small-screen controls:** the toolbar fits two rows on phones; short portrait/soft-keyboard layouts do not switch to an overflowing 12-column row. Canvas's menu exposes native undo/redo and zoom controls even where the native navigation panel is hidden. These CSS/UI changes still require the included browser tests.
12. **Repository hygiene:** `.dev.vars.example` is retained while real environment secrets, generated types, build outputs and runtime storage are ignored. Test-only bridge markers are forbidden by the production build audit.

The pure storage, policy and accounting fixes have executable evidence. Editor/runtime-specific fixes are source-reviewed implementations, not independently proven behavior.

## Outstanding release blockers

**B1 — Resolve dependencies.** On a network-enabled runner, run `npm install`, investigate compatibility warnings and `npm audit`, generate and commit the real lockfile. Exact direct pins do not replace a transitive lockfile or a vulnerability audit.

**B2 — Run SDK and Worker gates.** Run lint, both strict TypeScript projects, unit tests, real Wrangler tests, Worker dry-run packaging and the production build. Fix any failures rather than loosening assertions to make the check green.

**B3 — Prove collaborative behavior.** Run all three browser projects and the optimized preview. The two-client persistence test, concurrent independent changes, local undo isolation, close/reopen persistence, reconnect and protected restore are release-blocking. The complete workflow has not run in this environment.

**B4 — Verify devices, platform behavior and load.** Run the benchmark, inspect actual bundle metrics and browser console output, test real touch/stylus devices and confirm hibernation recovery on Cloudflare. Desktop WebKit cannot certify iPad Safari hardware. No FPS, memory, storage-cost or Lighthouse number is supplied without execution.

**B5 — Configure production.** Supply an active tldraw production key, owner-controlled Cloudflare account/deployment, allowed frontend origins, public backend URL and private recovery token. A free hobby key is discretionary; free-tier operation is a target, not a guarantee. Run the live recovery scenario before relying on the world.

## Provisional quality scores

Scores below describe **release confidence supported by this candidate's evidence**, not measured editor quality. Unexecuted UI/runtime dimensions are deliberately penalized. They must be replaced by a dated post-execution assessment; a low unverified score is not an invented performance benchmark.

| Dimension | Score / 10 | Basis and remaining uncertainty |
| --- | ---: | --- |
| Architecture | 8 | One world, native sync/SQLite, no extra services; APIs checked against upstream source |
| Correctness | 5 | Core invariants tested; installed application integration is unverified |
| Realtime collaboration | 4 | Established sync rather than scene overwrite; multiplayer tests not run |
| Persistence | 6 | Native durable storage design and real backup SQLite tests; full close/reopen editor flow unrun |
| Reliability | 5 | Explicit errors, bounded inputs, reconnect/restore safeguards; runtime faults still unknown |
| Performance | 2 | Incremental budgets and native rendering; benchmarks and actual bundle measurements unavailable |
| Storage efficiency | 8 | No media, vector records, bounded gzip backups and record budgets; stroke/load audit pending |
| Mobile UX | 2 | Responsive controls and touch tests implemented; no actual device/browser verification |
| Desktop UX | 3 | Native interactions preserved and reduced chrome; editor not rendered in this runner |
| Visual polish | 3 | Source-level design review only; no real application screenshot or visual sign-off |
| Accessibility | 3 | Named controls, focus and keyboard handling; no full scanner/screen-reader run |
| Security in the open model | 6 | Layered media/input/admin limits tested in part; native-runtime fuzz/dependency audit pending |
| Maintainability | 7 | Shared policies, bounded modules, pinned engine family, documented seams; no full lint/type result |
| Test quality | 6 | Meaningful real-SQLite core and extensive integration test code; most release-critical tests unexecuted |
| Deployment readiness | 2 | Deployable configuration and gated CI written; no lockfile, successful build or live deployment |
| Documentation | 8 | Setup, license, limitations, recovery and evidence are explicit; must be validated by the first real deployment |

**No aggregate “production-ready” score is assigned. B1–B5 override numerical ratings.**

## Scope and simplicity review

No accounts, OAuth, profile database, board dashboard, multi-room UI, uploaded assets, comments, chat, AI, tasks, database product, analytics platform, paid managed realtime service, R2 bucket or D1 database is present. Local anonymous identity is not authorization. Optional search/landmarks were deferred to protect core scope.

The source is still conceptually: static React/Vite frontend → Worker → one SQLite Durable Object. Tests, backup metadata and application menus do not introduce another production service.

See [the acceptance matrix](docs/acceptance-matrix.md), [TESTING.md](TESTING.md), [DEPLOYMENT.md](DEPLOYMENT.md) and [machine-readable verification](docs/verification.json).
