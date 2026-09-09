# Third-party licensing and telemetry

Canvas-specific code is offered under the repository license. Dependencies retain their own licenses and notices.

## Excalidraw

The production editor uses `@excalidraw/excalidraw` **0.18.1**. Excalidraw is distributed under the MIT license in its upstream repository. Canvas uses the packaged editor as a dependency and does not claim ownership of Excalidraw source, icons, fonts, translations or other upstream assets.

Canvas does not add advertising, product analytics or tracking around the editor. Supabase Realtime/PostgREST traffic is functional collaboration traffic required by the product.

Upstream project: https://github.com/excalidraw/excalidraw

## Supabase

Production persistence and realtime collaboration use Supabase Postgres, PostgREST and Realtime. The frontend contains only the project URL and browser-safe publishable key. A Supabase service-role credential is not bundled or required by the public app.

Supabase receives the element rows, presence state and cursor broadcasts necessary to operate the shared canvas. Canvas does not intentionally send image/file uploads because media is outside the product model.

Upstream/project information: https://supabase.com/

## React, Vite, Playwright and supporting packages

React, React DOM, Vite, the Vite React plugin, TypeScript, Playwright, ESLint, Prettier and transitive dependencies retain their upstream licenses/notices.

The repository commits `package-lock.json` so the installed dependency graph is auditable. CI records `npm audit --json` and fails on high-severity dependency findings.

## Historical tldraw / Cloudflare test harness

The repository still contains the previous tldraw + Cloudflare Worker implementation and its regression tests while migration coverage is retained. Those dependencies are **not the normal production editor** and the production Pages build does not require a tldraw license key or Cloudflare Worker deployment.

`tldraw` SDK packages retain tldraw's upstream license terms. Their presence for the historical harness does not relicense them under the Canvas repository license. Any future decision to ship tldraw in production would require a fresh review of tldraw's then-current production licensing terms.

Wrangler/Miniflare/Cloudflare-related packages used by the historical Worker tests retain their own licenses. They are development/test tooling in the current architecture.

## Canvas-owned assets

The Canvas shell, project-specific CSS, favicon/PWA icon treatment and integration code are project assets/code. No stock photography, uploaded media, remote thumbnails, advertising assets or analytics SDKs are intentionally bundled as product content.

## Redistribution

Before redistributing a compiled build or changing the editor/backend dependencies:

1. review the upstream licenses for the exact dependency versions in `package-lock.json`;
2. retain attribution/notices required by those licenses;
3. rerun the dependency audit and production build;
4. verify that the built application contains only the intended production engine;
5. never treat this notice as a replacement for an upstream license text.
