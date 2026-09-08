# Deployment and recovery

This candidate is **not yet release-certified**. Use these instructions to run the outstanding gates, then publish. Do not interpret configuration instructions as evidence that a deployed site has already been verified.

## 1. Install and establish a real lockfile

From the extracted `Canvas` directory, with a current Node 22 LTS installation:

```sh
npm install
npm audit
cp .env.example .env
npx playwright install --with-deps chromium firefox webkit
npm run check
npm run test:performance
```

The authoring runner could not obtain npm packages, so this archive has **no fabricated lockfile**. `npm install` must generate `package-lock.json`; review it and commit it. Once present, use `npm ci`. The initial GitHub check workflow can also generate a bootstrap lockfile and retain it as an artifact, but deployment refuses to proceed until a genuine lockfile is committed.

The local development command is `npm run dev`, with frontend `http://127.0.0.1:5173/Canvas/` and backend `http://127.0.0.1:8787`. On Windows, use `Copy-Item` instead of `cp`, or copy the example files in the file manager. Do not point integration or stress tests at the real world.

## 2. Configure and deploy the Cloudflare backend

Log into the account that should own the permanent world:

```sh
npx wrangler login
npx wrangler whoami
```

In `wrangler.jsonc`, set `vars.ALLOWED_ORIGINS` to a comma-separated list of **origins**, without paths or trailing slashes. For example:

```json
"ALLOWED_ORIGINS": "https://YOUR_USERNAME.github.io,http://127.0.0.1:5173,http://127.0.0.1:4173"
```

Do not add `/Canvas/` to an origin. That is the frontend base path, not its origin. Add `https://your-custom-domain.example` when moving or adding a domain. Origins restrict browser embedding, not who can read or edit with a custom HTTP client. Remove local origins from production when they are no longer useful.

The configuration defines one `CanvasRoom` SQLite-backed Durable Object, binding `CANVAS_ROOM`, and its initial `new_sqlite_classes` migration. Keep the Worker name `canvas-realtime` and migration history stable. No bucket or separate database needs creating.

```sh
npm run check:worker
npm run deploy:worker
```

Record the actual HTTPS Worker origin printed by Wrangler, normally resembling:

```text
https://canvas-realtime.YOUR_SUBDOMAIN.workers.dev
```

Test routing/liveness:

```sh
curl https://canvas-realtime.YOUR_SUBDOMAIN.workers.dev/health
```

Expected fields include `ok: true`, `app: "Canvas"`, `world: "main"`, and the pinned engine version. The health endpoint is intentionally lightweight; it does not replace persistence or multiplayer testing.

### Recovery secret

Generate a random 32-byte hexadecimal secret, store it securely, and set it as a Worker secret:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
npx wrangler secret put ADMIN_TOKEN
```

Paste that secret when prompted. It protects only administrative backup/restore operations; ordinary collaborative editing remains anonymous and open. Do not put this value in a `VITE_` variable, GitHub Pages file, repository, URL query, or browser local storage. The normal frontend never receives it.

`wrangler.test.jsonc` contains a known test token and is **not** a deployment configuration. Its Worker rejects public hostnames, but do not rely on that as a reason to deploy test code.

## 3. Configure the frontend

Use these values in local `.env` when testing your own production configuration:

```dotenv
VITE_CANVAS_API_URL=https://canvas-realtime.YOUR_SUBDOMAIN.workers.dev
VITE_TLDRAW_LICENSE_KEY=YOUR_ACTUAL_TLDRAW_KEY
VITE_BASE_PATH=/Canvas/
```

Every `VITE_` value is public build-time configuration. The API value is an origin, not `/api/connect/main`; the app builds the WebSocket URL itself. HTTPS becomes WSS. Do not paste the admin token into the license field.

Production needs a valid tldraw hobby, trial, or commercial key covering the deployment according to that key's terms. See THIRD_PARTY_NOTICES.md and the official application instructions linked there. Without a key on a non-localhost hostname, Canvas deliberately displays a useful configuration error. A nonempty string is not proof a key is valid; verify the real deployed editor and license status.

## 4. Create/publish GitHub repository Canvas

Create a repository named **Canvas** under your GitHub account. A public repository is the straightforward GitHub Free Pages option; check your own plan for private repository Pages availability. The editor URL is not confidential just because you have not shared it widely.

From the extracted source directory, after generating and reviewing the lockfile:

```sh
git init -b main
git add .
git commit -m "Add Canvas source candidate and verification suite"
git remote add origin https://github.com/YOUR_USERNAME/Canvas.git
git push -u origin main
```

Do not use `--force` or overwrite an existing repository's unrelated work. When using an existing repository, merge through an appropriate branch/PR instead. No repository was created or pushed by the authoring session; its available GitHub actions were read-only.

In GitHub:

1. **Settings → Pages → Source:** select **GitHub Actions**.
2. **Settings → Secrets and variables → Actions → Variables:** set `VITE_CANVAS_API_URL` to the Worker origin. Set `VITE_BASE_PATH` to `/Canvas/`, or leave it unset for that default.
3. **Actions secrets:** set `VITE_TLDRAW_LICENSE_KEY`. It is stored here for configuration convenience, but the resulting browser key is public.
4. Leave `CANVAS_DEPLOY_ENABLED` unset or `false` until the complete check suite and manual gates pass. Then set that repository **variable** to `true` and run the workflow on `main`.

The workflow installs packages, lints, generates Worker types, type-checks, runs unit/Worker/browser tests, dry-runs the Worker build, and builds the frontend. The Pages job depends on successful checks, refuses an uncommitted lockfile or missing production configuration, rebuilds with production values, and publishes through the official Pages artifact/deployment actions. PRs do not deploy.

The separate performance workflow is manually invoked. Archive its real measurements and the main workflow results when certifying a release. Add repository branch protection/required checks through GitHub settings to enforce the same policy for collaborators.

## 5. Verify the real deployment

Open the actual Pages URL in two clean browser contexts. Verify `Live`, both directions of text/shape updates, cursors, local undo after a remote edit, close-all/reopen persistence, an interrupted connection, image paste rejection, and an actual export. Confirm the Worker allows that exact frontend origin and the tldraw key is accepted.

Use two clients on the **deployed** Worker to check a sustained idle period followed by successful edits without a refresh. Inspect Cloudflare logs/analytics for hibernation behavior and unexpected active duration. Run the physical phone/tablet cases in TESTING.md. WebKit automation is not a real iPad or Apple Pencil certification.

Do not remove the release-candidate status merely because the shell loaded. AUDIT.md lists the remaining release blockers.

## 6. Custom domain or website subpath

For a standalone custom domain, normally set `VITE_BASE_PATH=/`. For another subdirectory, set that absolute path with a trailing slash. Configure the domain in GitHub Pages and its DNS records, then add its HTTPS origin to `ALLOWED_ORIGINS` and redeploy the Worker. Rebuild the frontend. Keep the backend origin and DO namespace unchanged to keep the same world.

The manifest, icons, service worker, Vite assets, and app have relative/base-aware URLs and no client-side route tree. The automated preview gate exercises `/Canvas/`; also test the chosen alternate base before a domain migration.

## 7. Export and owner recovery

The normal Canvas menu downloads a portable JSON backup. A disconnected export is clearly marked `LOCAL-UNCONFIRMED`: it may contain edits the server has not acknowledged. Never assume a local file is the authoritative current world without reviewing it.

For administration, set the endpoint and private token in **your terminal**, not the browser. Bash example:

```sh
export CANVAS_API_URL=https://canvas-realtime.YOUR_SUBDOMAIN.workers.dev
read -r -s -p "Canvas admin token: " CANVAS_ADMIN_TOKEN; echo
export CANVAS_ADMIN_TOKEN
npm run admin -- list
npm run admin -- snapshot
npm run admin -- export Canvas-before-maintenance.json
```

PowerShell users can set `$env:CANVAS_API_URL` and `$env:CANVAS_ADMIN_TOKEN` for the current shell; avoid recording the token in a script or shell history.

After accidental deletion:

```sh
npm run admin -- list
npm run admin -- get SNAPSHOT_UUID Canvas-recovered.json
```

Review the file and close **every** Canvas tab/device. Run `admin list` again and read its current `clock`. Then:

```sh
npm run admin -- restore Canvas-recovered.json --expect-clock CURRENT_CLOCK --yes
```

A 409 means active clients remain or the world clock changed. No restore was applied; close tabs, inspect the new state/clock, and review again. A pre-restore snapshot must succeed before replacement. The endpoint rejects malformed data, unsupported assets/pages, mismatched engine/schema versions, and requests from browsers. Restoration applies records transactionally at a new clock rather than replaying historical clocks.

Keep an exported copy outside the Cloudflare account before migrations. Same-DO rolling snapshots cannot recover deletion of the entire namespace or loss of account access.

## 8. Upgrades and troubleshooting

**Before upgrades:** export, create an isolated local world from a copy, update the aligned tldraw package versions together, test migration/undo/reconnection/recovery, then deploy coordinated client/server builds. Do not remove Durable Object migrations or change class/binding names casually. A Wrangler code rollback is not a data rollback.

**Connecting indefinitely:** inspect the configured origin, network, Worker health/logs, and WebSocket upgrade. The client shows an extended connection hint after ten seconds. **403:** fix `ALLOWED_ORIGINS`. **Production license error:** supply an actual appropriate key and rebuild. **Old frontend:** close all app tabs and reload; the service worker deliberately does not force-replace editor code during a session. **Missing content after infrastructure changes:** check the backend account/name/namespace before attempting any restore. **Limits reached:** export and inspect the world; do not repeatedly retry giant pastes.

Runtime logs intentionally omit document payloads and cursor traffic. No third-party monitoring service is required for V1; use Wrangler/Cloudflare logs and analytics. Failure of backup creation must be investigated even when the live document still works.
