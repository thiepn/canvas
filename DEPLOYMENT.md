# Deployment and Recovery

## Production components

Canvas production consists of two independently provisioned pieces:

1. a Supabase project containing `canvas_elements`, Realtime publication, RLS/validation and the private recovery schema;
2. a static Vite build deployed by GitHub Actions to GitHub Pages.

There is no application server or Cloudflare Worker in the active architecture. GitHub Pages plus Supabase is the complete runtime.

## 1. Provision Supabase

Use the Supabase project intended for Canvas and apply every SQL file under `supabase/migrations/` in filename order. The checked-in migrations create:

- `public.canvas_elements` — shared production world;
- `public.canvas_ci_elements` — isolated automated-test world;
- Realtime publication for both tables;
- RLS and validation constraints;
- stale-write guards and revision anti-entropy support;
- private `canvas_admin` history/recovery objects.

For a new Supabase project, obtain its **Project URL** and **publishable/anon key** after migrations are applied. The publishable key is browser-safe. Never expose the service-role key.

### Backend verification

Run privileged SQL checks before pointing a frontend at a new project:

```sql
select tablename, policyname, cmd
from pg_policies
where schemaname = 'public'
  and tablename in ('canvas_elements', 'canvas_ci_elements')
order by tablename, policyname;

select pubname, schemaname, tablename
from pg_publication_tables
where tablename in ('canvas_elements', 'canvas_ci_elements');
```

Expected: production has anonymous/authenticated SELECT/INSERT/UPDATE policies but no public physical DELETE policy; CI has the additional cleanup DELETE policy; both tables are in `supabase_realtime`.

## 2. Frontend configuration

`.env.example` lists the public configuration contract:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
VITE_CANVAS_TABLE
VITE_BASE_PATH
```

For this repository Pages deployment:

```text
VITE_CANVAS_TABLE=canvas_elements
VITE_BASE_PATH=/canvas/
```

A custom domain mounted at its root should use `VITE_BASE_PATH=/`.

The repository currently has checked-in defaults for the public Supabase URL and publishable key. GitHub Actions therefore does not require a secret to build. If those values change, update the public config and/or workflow environment intentionally. Do not create a GitHub secret merely to hide a publishable key; it will still be embedded in the browser bundle.

## 3. Pre-release verification

From a clean checkout:

```bash
npm ci
npm audit --audit-level=high
npm run audit:architecture
npm run lint
npm run typecheck
npm test
npm run build
npm run test:live
npm run test:production
```

`audit:architecture` prevents the retired tldraw/Wrangler/Worker stack from returning. `test:live` and `test:production` write only to `canvas_ci_elements` and clean that table before/after their scenarios. They must never target `canvas_elements`.

## 4. GitHub Pages

`.github/workflows/ci.yml` is the release pipeline. On a pull request it executes quality tests only. On `main`, the Pages deployment job is conditional on the quality job succeeding.

The Pages job:

1. checks out the exact successful commit;
2. rebuilds with the repository base path `/canvas/`;
3. configures GitHub Pages;
4. uploads `dist` as the Pages artifact;
5. deploys that artifact;
6. runs the published-site verifier against the returned HTTPS deployment URL.

After merging, require both the quality job and the Pages deployment/verifier to be green. A green pull-request run does **not** prove that Pages deployed.

## 5. Post-deployment verification

The automated deployed-site verifier checks the published bundle, Live connection, reconnect behavior and mobile menu against the actual Pages URL. Manual verification can additionally inspect:

```text
https://thiepn.github.io/canvas/
```

At minimum confirm the Excalidraw/Supabase engine loads, repository-relative assets are present, a real vector persists after refresh, and a second browser/device receives changes and presence.

Because the public world is intentionally shared, remove any release-test objects manually after verification rather than adding a hidden cleanup endpoint.

## Recovery operations

Recovery is intentionally not available to anonymous clients.

### Find recent destructive transactions

In Supabase SQL Editor or another privileged SQL session:

```sql
select *
from canvas_admin.recovery_transactions
order by finished_at desc
limit 30;
```

For detail:

```sql
select
  history_id,
  source_txid,
  recorded_at,
  element_id,
  version,
  version_nonce,
  is_deleted,
  updated_by
from canvas_admin.element_history
where source_txid = <source_txid>
order by history_id;
```

### Restore one transaction

```sql
select canvas_admin.restore_transaction(<source_txid>);
```

The returned integer is the number of affected elements restored. Recovery versions are bumped above current versions so connected clients accept the restored rows through normal Realtime propagation.

### Recovery guarantees and limits

- previous state is captured before production UPDATE/physical DELETE;
- history is grouped by Postgres transaction ID;
- only the latest 20 prior versions per element are retained;
- public browser roles have no privileges on `canvas_admin`;
- a restore produces new writes, and those writes are themselves history-protected;
- newly inserted objects have no previous state until their first update. Normal collaborative deletion is a tombstone UPDATE, so the pre-delete active state is captured.

If restoring after a suspected incident, inspect the transaction rows before executing restore. Do not expose `restore_transaction` through an anonymous RPC or frontend button.

## Rollback strategy

Frontend rollback: redeploy a previously known-good Git commit through the normal Pages workflow.

Data rollback: use `canvas_admin.restore_transaction` for element-state recovery. Avoid dropping/recreating the production table as a rollback mechanism.

Schema rollback: prefer a new forward migration that corrects the schema. Do not edit migration history that has already been applied to the live Supabase project.

## Cost model

The design intentionally avoids application servers, object storage and scheduled background jobs. Static Pages hosting plus the existing Supabase project is the complete runtime. Monitor Supabase database/Realtime usage if the trusted-group usage pattern changes substantially.
