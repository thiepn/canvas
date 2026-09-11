# Third-party licensing and telemetry

Canvas-specific code is offered under the repository license. Dependencies retain their own licenses and notices.

## Excalidraw

The production editor uses `@excalidraw/excalidraw` **0.18.1**. Excalidraw is distributed under the MIT license in its upstream repository. Canvas uses the packaged editor as a dependency and does not claim ownership of Excalidraw source, icons, fonts, translations or other upstream assets.

Canvas does not add advertising, product analytics or tracking around the editor. Supabase Realtime/PostgREST traffic is functional collaboration traffic required by the product.

Upstream project: https://github.com/excalidraw/excalidraw

## Supabase

Production persistence and realtime collaboration use Supabase Postgres, PostgREST and Realtime. The frontend contains only the project URL and browser-safe publishable key. A Supabase service-role credential is not bundled or required by the public app.

Supabase receives the element rows, presence state, cursors and active-operation preview broadcasts necessary to operate the shared canvas. Canvas does not intentionally send image/file uploads because media is outside the product model.

Upstream/project information: https://supabase.com/

## React, Vite, Playwright and supporting packages

React, React DOM, Vite, the Vite React plugin, TypeScript, Playwright, ESLint, Prettier and transitive dependencies retain their upstream licenses/notices.

The repository commits `package-lock.json` so the installed dependency graph is auditable. CI records `npm audit --json`, fails on high-severity dependency findings, and runs an architecture audit against retired runtime dependencies.

## Retired stack

Phase 8 removed the historical tldraw + Cloudflare Worker/Durable Object runtime and its installed dependency family from the active repository. Earlier source and dependency history remain available through Git history but are no longer installed, built, tested or shipped.

If tldraw or another editor/backend is reintroduced in the future, its then-current license and deployment terms require a fresh review before shipping.

## Canvas-owned assets

The Canvas shell, project-specific CSS, favicon/PWA icon treatment and integration code are project assets/code. No stock photography, uploaded media, remote thumbnails, advertising assets or analytics SDKs are intentionally bundled as product content.

## Redistribution

Before redistributing a compiled build or changing the editor/backend dependencies:

1. review the upstream licenses for the exact dependency versions in `package-lock.json`;
2. retain attribution/notices required by those licenses;
3. rerun the dependency and architecture audits and production build;
4. verify that the built application contains only the intended production engine;
5. never treat this notice as a replacement for an upstream license text.
