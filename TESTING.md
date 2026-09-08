# Verification strategy and evidence

## What actually ran in the authoring environment

On 2026-09-08, Node 22.16.0 executed `npm test` without installing editor dependencies: **33 tests passed, none failed or skipped**. The suite uses the real `node:sqlite` driver, Web Streams gzip, Web Crypto, file close/reopen, deliberate corruption, and a failed SQL transaction. It does not claim to emulate Cloudflare hibernation or prove tldraw interoperability.

A strict TypeScript 5.8.3 check of the tested core, including unused-local/parameter checks, passed. All 52 then-current TS/TSX/JS sources passed syntax checks. Syntax checking is not module resolution, an SDK typecheck, lint, or a production build. Actual logs are retained in `docs/evidence/` and machine-readable status in `docs/verification.json`.

Npm registry access failed from the runner; a bounded dependency-install attempt timed out. Therefore the full commands below were **not certified there**. No lockfile, dependency-audit result, production bundle, browser screenshot, performance number, Lighthouse score, or deployed-worker result is fabricated.

## Test layers

| Command | Scope |
| --- | --- |
| `npm test` | Identity/configuration, bounded JSON, media/record policy, backup schema/reconstruction, origin/rate/chunk guards, byte budget, real SQLite backup storage/rotation/recovery |
| `npm run typecheck` | Wrangler-generated runtime types plus strict frontend, shared, browser-test, and Worker TypeScript |
| `npm run test:worker` | Real local Wrangler process: HTTP admission, CORS, administration, invalid restore, persistent state across process restart |
| `npm run test:e2e` | Chromium, Firefox and WebKit against real local Worker and Vite test-mode editor |
| `npm run test:production` | Separate optimized production-mode preview under `/Canvas/`, no test bridge, real input/persistence, assets, console errors, manifest, actual screenshot |
| `npm run test:performance` | 100 / 1,000 / 5,000 / 10,000 objects, persistence, serialization size/time, pan-frame timing and Chromium heap metrics |
| `npm run source:syntax` | Syntax-only diagnostics for project source, useful but not a substitute for the above |

Install browser runtimes with `npx playwright install --with-deps chromium firefox webkit`. On systems without support for a particular browser runner, use GitHub's Linux workflow to obtain that browser's evidence instead of marking it passed locally.

The editor's narrow test bridge is dynamically imported only in Vite `test` mode. Production build auditing refuses its marker. The optimized preview is built into `.preview-dist` with an explicit loopback backend and a separate persisted test directory; production API values from the developer's shell cannot redirect its data writes.

## Critical automated scenarios

The multiplayer test creates `Hello from A`, observes it from B, creates B's rectangle, moves it from A, deletes the text from B, reloads both, closes all clients, and opens a new client against the same state. Other cases cover independent concurrent edits, local undo/redo in the presence of another user's change, disconnect/reconnect without refresh, presence rename/removal, owner recovery, and ten simultaneous isolated contexts.

Interaction tests use actual pointer drawing and text input as well as the bridge for precise object assertions. They reject image/PDF file paste/drop, check oversized/binary socket handling, verify visible button naming/menu keyboard behavior, and inspect all nine requested viewports: 320×568, 360×800, 390×844, 430×932, 768×1024, 1024×768, 1366×768, 1440×900, and 1920×1080. A Chromium multi-touch test checks pinch zoom changes the camera and does not scroll the document. A narrow-phone test uses the actual Canvas-menu undo, redo and zoom buttons rather than keyboard shortcuts.

The stress/performance scripts write measurements only after real execution. Ten thousand shapes is a practical test target within the separate 8 MiB record budget, not an established performance guarantee. Failure must not be hidden by reducing the test scene and reporting the original target as passed.

## Manual release gates

Execute against a staging or newly deployed world with recoverable test data; keep production backups first. Record device/browser/version and pass/fail notes rather than checking every box speculatively.

- Fresh storage: immediate editor without login; stable local guest identity after refresh; no user record in the server export. Test light, dark, and system appearance and blocked localStorage.
- Draw, highlight, type, format, create every listed shape/line/arrow/frame, resize, rotate, group, duplicate, erase, copy/paste, undo and redo. Verify both clients, then close all tabs and reopen. Test nested frames and bound arrows after grouping/deletion.
- Disconnect one client, make a near-disconnect edit, reconnect, and verify authoritative convergence. Do not reload the disconnected tab before checking its pending work/local export. Exercise a same-object concurrent edit as well as independent objects; document the engine's observed resolution.
- Idle connected clients on the real Cloudflare deployment, then edit again without refresh. Inspect logs/analytics to verify session recovery and idle resource behavior. Local process restart and pure unit tests do not prove platform eviction.
- On real phone/tablet hardware: portrait/landscape, soft keyboard, one-finger interaction, two-finger pan, pinch, text selection, selection handles, safe areas, pull-to-refresh/overscroll, stylus and palm handling. Desktop WebKit is not iPad Safari or Apple Pencil hardware.
- Check all toolbar/menu states, context menu reopen, focus visibility/order, native style panels, contrast, reduced motion, error/loading states and long guest names. Use a screen reader and an accessibility scanner; the included button-name checks are not a complete accessibility audit.
- Create a known backup, perform a destructive edit, restore administratively with all clients closed, and verify the exact known state from a new browser. Verify malformed/version-mismatched restores leave the world unchanged.
- Run synthetic scenes plus many freehand strokes at large spatial coordinates. Inspect CPU, frames, memory, server errors, vector density and bundle output. Run Lighthouse on the actual built shell, recognizing that an editor differs from a static article.

## Release rule

Successful core tests are necessary but insufficient. Every critical integration, build, deployment and recovery gate must pass; investigate and fix failures, then rerun affected and full suites. Add actual evidence and a dated certification record before changing the candidate's release status. Do not infer real touch performance, successful hibernation, or safe collaborative undo from architectural intent alone.
