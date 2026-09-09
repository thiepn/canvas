# Deployment and recovery

The hardened Canvas source is merged to `main` in `thiepn/canvas`. PR #1 is historical; application release commit `f429294102146b61107de0427b360fab4c1f9f89` passed the complete post-merge quality workflow in GitHub Actions run `34298529147`. Do not deploy a different copy of the original source archive.

The intended initial frontend URL is:

`https://thiepn.github.io/canvas/`

The backend is a Cloudflare Worker named `canvas-realtime` with one SQLite-backed `CanvasRoom` Durable Object.

## 1. Local release verification

Requires Node.js `>=22.16.0` and npm.

```sh
git clone https://github.com/thiepn/canvas.git
cd canvas
git switch main
npm ci
npx playwright install --with-deps chromium firefox webkit
npm run check
npm run test:performance
```

The genuine npm lockfile is committed. Use `npm ci`; do not regenerate it casually during deployment.

Local development:

```sh
cp .env.example .env
npm run dev
```

Open `http://127.0.0.1:5173/canvas/`. The Worker runs at `http://127.0.0.1:8787`. Local Durable Object state is under `.wrangler/` and is independent of production.

## 2. Authenticate Cloudflare

From the checked-out repository:

```sh
npx wrangler login
npx wrangler whoami
```

`wrangler.jsonc` already contains the production Pages origin and localhost development origins:

```text
https://thiepn.github.io
http://127.0.0.1:5173
http://localhost:5173
http://127.0.0.1:4173
http://localhost:4173
```

These are **origins**, so `/canvas/` is intentionally absent. If a future custom domain is added, append its HTTPS origin and redeploy the Worker. Origin filtering is not authentication; anyone using the permitted frontend can edit Canvas.

The Worker configuration defines:

- Worker name `canvas-realtime`;
- Durable Object binding `CANVAS_ROOM`;
- class `CanvasRoom`;
- initial SQLite Durable Object migration `v1`;
- no R2/D1/database service.

Do not rename the Worker/class/binding or discard migration history after production data exists unless you explicitly migrate the world.

## 3. Deploy the Worker

First verify the generated Worker bundle:

```sh
npm run check:worker
```

Then deploy:

```sh
npm run deploy:worker
```

Wrangler prints the HTTPS Worker URL. Record its **origin**, for example:

```text
https://canvas-realtime.YOUR_SUBDOMAIN.workers.dev
```

Verify health:

```sh
curl https://canvas-realtime.YOUR_SUBDOMAIN.workers.dev/health
```

The response should identify Canvas, world `main`, and the pinned engine version.

### Set the recovery secret

Generate a strong random token and retain it in a password manager or equivalent secure store:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
npx wrangler secret put ADMIN_TOKEN
```

Paste the generated token at Wrangler's prompt.

`ADMIN_TOKEN` is a true secret. Never place it in:

- a `VITE_` variable;
- GitHub Pages output;
- `.env` committed to Git;
- a URL/query string;
- browser local storage.

The normal Canvas frontend never needs this token.

## 4. Verify the deployed backend before enabling Pages

Use the deployed Worker origin as `CANVAS_API_URL` and verify administrative access from a terminal:

```sh
export CANVAS_API_URL=https://canvas-realtime.YOUR_SUBDOMAIN.workers.dev
read -r -s -p "Canvas admin token: " CANVAS_ADMIN_TOKEN; echo
export CANVAS_ADMIN_TOKEN
npm run admin -- list
npm run admin -- snapshot
unset CANVAS_ADMIN_TOKEN
```

PowerShell equivalent (keeps the prompt masked and removes the plaintext environment value immediately afterward):

```powershell
$env:CANVAS_API_URL = "https://canvas-realtime.YOUR_SUBDOMAIN.workers.dev"
$secureToken = Read-Host "Canvas admin token" -AsSecureString
$tokenPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
try {
    $env:CANVAS_ADMIN_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPtr)
    npm run admin -- list
    npm run admin -- snapshot
}
finally {
    Remove-Item Env:CANVAS_ADMIN_TOKEN -ErrorAction SilentlyContinue
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPtr)
}
```

The admin CLI necessarily receives the token as a process environment string. The examples above keep that exposure scoped to the commands that require it and remove it afterward; do not save the token to scripts or shell profiles.

## 5. Configure GitHub Pages

In `thiepn/canvas`:

1. **Settings → Pages → Build and deployment → Source:** choose **GitHub Actions**.
2. **Settings → Secrets and variables → Actions → Variables:** set:
   - `VITE_CANVAS_API_URL=https://canvas-realtime.YOUR_SUBDOMAIN.workers.dev`
   - `VITE_BASE_PATH=/canvas/`
3. **Actions secrets:** set:
   - `VITE_TLDRAW_LICENSE_KEY=<your valid tldraw production key>`
4. Leave `CANVAS_DEPLOY_ENABLED` unset/false until the deployed Worker has been checked.
5. When ready to publish, set repository variable `CANVAS_DEPLOY_ENABLED=true`.

All `VITE_` values are embedded into browser JavaScript. The tldraw SDK key is therefore public at runtime even though GitHub stores its source value as an Actions secret. `ADMIN_TOKEN` must never be a Vite value.

The frontend expects only the Worker **origin** in `VITE_CANVAS_API_URL`; it constructs `/api/connect/main` and converts HTTPS to WSS itself.

## 6. tldraw production license

A non-local production deployment requires a valid tldraw hobby, trial, or commercial SDK key under tldraw's applicable terms. Canvas does not fabricate or commit a key.

For this personal/noncommercial project, apply for/use a hobby key if tldraw approves the use case. Preserve the required tldraw watermark. If no suitable key is available, do not deploy an intentionally invalid configuration; an engine change is a separate migration project.

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## 7. Enable and deploy Pages

The release is already merged to `main`, and exact merge commit `f429294102146b61107de0427b360fab4c1f9f89` passed the complete quality workflow in run `34298529147`. Its `deploy-pages` job was skipped because `CANVAS_DEPLOY_ENABLED` was not true; this was a deployment gate, not a test failure.

After the Worker, GitHub variables, and tldraw key are configured:

1. set `CANVAS_DEPLOY_ENABLED=true`;
2. open **Actions → Canvas checks and Pages → Run workflow**;
3. dispatch the workflow on `main`.

A later push to `main` also triggers the workflow, but changing a repository variable alone does **not** create a new push event. Use manual workflow dispatch if there is no subsequent code/documentation change.

The Pages deployment job runs only when:

- quality passes;
- the ref is `main`;
- the event is not a PR;
- `CANVAS_DEPLOY_ENABLED == true`;
- the Worker URL is HTTPS;
- a nonempty tldraw production key is configured.

Expected Pages URL:

`https://thiepn.github.io/canvas/`

The workflow uses the official Pages artifact/deployment actions; it does not create or maintain a `gh-pages` branch.

## 8. Real deployment acceptance test

After Pages is live, test the production system, not only localhost:

1. open the Pages URL in two independent browser contexts/devices;
2. verify both report `Live`;
3. create text in A and confirm B receives it;
4. create/move/delete a shape in B and confirm A receives it;
5. verify live cursors/names;
6. verify one client's undo does not remove an unrelated remote edit;
7. close all clients, reopen, and confirm persistence;
8. interrupt one client's network, restore it, and confirm reconnection/convergence;
9. paste an image and drop an image/PDF; confirm no asset is stored;
10. export the world;
11. inspect Worker logs/analytics for errors.

### Production hibernation check

Local Miniflare/Wrangler tests validate the hibernation-compatible code path but cannot prove Cloudflare actually evicted/woke the production Durable Object.

For the real check:

1. connect at least one browser;
2. leave the connection idle long enough for Cloudflare to hibernate the object when the platform chooses;
3. interact again without refreshing;
4. confirm edits synchronize normally;
5. inspect Cloudflare logs/analytics for unexpected active duration/errors.

This is the remaining platform-specific validation after repository CI.

### Physical mobile/tablet check

At minimum verify on a real phone and, preferably, an iPad/Android tablet with stylus:

- canvas owns the viewport without accidental body scroll;
- one-finger object interaction;
- two-finger pan/pinch;
- drawing;
- text editing/keyboard appearance;
- selection handles;
- toolbar safe areas;
- no accidental binary paste/upload.

Playwright's mobile/touch emulation does not certify Apple Pencil/palm rejection.

## 9. Export and owner recovery

The Canvas menu downloads a portable JSON backup. A disconnected export is marked as locally unconfirmed; it may include pending tab state and must not be treated as a server acknowledgement.

### List/create/export server snapshots

```sh
export CANVAS_API_URL=https://canvas-realtime.YOUR_SUBDOMAIN.workers.dev
read -r -s -p "Canvas admin token: " CANVAS_ADMIN_TOKEN; echo
export CANVAS_ADMIN_TOKEN

npm run admin -- list
npm run admin -- snapshot
npm run admin -- export Canvas-before-maintenance.json
unset CANVAS_ADMIN_TOKEN
```

Avoid leaving the token in shell history. Prefer a secure prompt/environment mechanism. On PowerShell, use the scoped SecureString-to-environment pattern from section 4 around the equivalent admin commands.

### Recover from accidental deletion

Start a fresh scoped admin-token session before recovery; the export example intentionally removed its token:

```sh
read -r -s -p "Canvas admin token: " CANVAS_ADMIN_TOKEN; echo
export CANVAS_ADMIN_TOKEN
npm run admin -- list
npm run admin -- get SNAPSHOT_UUID Canvas-recovered.json
```

Then:

1. review the downloaded backup;
2. close **every** Canvas tab/device;
3. run `npm run admin -- list` again and note the current world `clock`;
4. restore only against that exact clock:

```sh
npm run admin -- restore Canvas-recovered.json --expect-clock CURRENT_CLOCK --yes
unset CANVAS_ADMIN_TOKEN
```

A `409` means a client is still connected or the world changed. No restore is applied. Re-inspect state and clock before retrying. If the restore command fails for another reason, clear the token manually with `unset CANVAS_ADMIN_TOKEN` before investigating.

For PowerShell recovery, reuse the scoped `SecureString` conversion block from section 4, execute `list`, `get`, and `restore` inside its `try` block, and let the `finally` block remove `CANVAS_ADMIN_TOKEN`.

The server validates the backup/schema and takes a new `before-restore` snapshot first. It restores records transactionally at a new synchronization clock rather than replaying old clocks/tombstones.

Keep external downloaded exports before risky migrations. Rolling snapshots inside the same Durable Object cannot recover loss of the entire Cloudflare account/namespace.

## 10. Upgrades

Before changing the tldraw package family or persistent schema:

1. export production;
2. create a server snapshot;
3. update all interoperating tldraw packages together;
4. restore/migrate a copy into isolated local Worker storage;
5. run unit + Worker + cross-browser multiplayer + reconnect + collaborative undo + media rejection + production preview tests;
6. run the large-scene benchmark;
7. deploy coordinated Worker/frontend versions;
8. verify the production world before retiring the previous deployment.

A source rollback is not a database rollback.

## Troubleshooting

**403 from Worker:** verify the exact frontend origin in `ALLOWED_ORIGINS`; do not include `/canvas/` there.

**Canvas stays Connecting:** check `/health`, browser network/WebSocket errors, `VITE_CANVAS_API_URL`, Worker deployment, and origin configuration.

**Production license error:** provide a valid tldraw key and rebuild Pages.

**Old frontend after deploy:** close Canvas tabs and reload. The service worker is intentionally conservative around active editor sessions.

**Missing world after infrastructure rename:** verify Cloudflare account, Worker binding/class/migration/namespace before restoring anything.

**Backup failure:** investigate even if live editing still works; primary persistence and recovery are separate guarantees.

**Large-scene slowdown:** 10,000 shapes is a stress ceiling. The measured benchmark reached ~825 MiB JS heap and ~26 ms p95 frame interval at that size. Organize/delete obsolete content or lower scene size rather than raising limits blindly.
