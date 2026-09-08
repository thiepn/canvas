# Research record

Checked on **8 September 2026** using official documentation and current upstream source. The selected tldraw release was verified as **v5.4.1**, published 2026-09-08 at 10:52:18 UTC. The current Cloudflare starter's package manifest and source were inspected, not copied from an old blog post.

## Sources

| ID | Official source | Decision supported |
| --- | --- | --- |
| R1 | [tldraw sync documentation](https://tldraw.dev/docs/sync) | Official client/server synchronization instead of a separate whole-scene protocol |
| R2 | [Cloudflare multiplayer starter](https://github.com/tldraw/tldraw-sync-cloudflare) | SQLite adapter, hibernation handlers, session snapshot/resume and ping auto-response |
| R3 | [tldraw v5.4.1 source](https://github.com/tldraw/tldraw/tree/v5.4.1) and [release](https://github.com/tldraw/tldraw/releases/tag/v5.4.1) | Actual installed-version APIs to target; `useSync`, authorizers, native chunking, persistent user-attribution behavior |
| R4 | [Excalidraw package FAQ](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/faq) | Collaboration is not a drop-in feature shipped in the npm component |
| R5 | [Excalidraw license](https://github.com/excalidraw/excalidraw/blob/master/LICENSE) | MIT licensing verified; attractive alternative, but additional sync integration is required |
| R6 | [Durable Objects WebSocket best practices](https://developers.cloudflare.com/durable-objects/best-practices/websockets/) | Current platform hibernation API, attachments, and auto-response boundary |
| R7 | [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) and [overview](https://developers.cloudflare.com/durable-objects/) | SQLite-backed DO availability and conditional free-tier cost model |
| R8 | [GitHub Pages custom workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages) | Static frontend deployment via official Actions/artifacts, not a server on Pages |
| R9 | [tldraw license](https://tldraw.dev/community/license) and [pricing](https://tldraw.dev/pricing) | Production-key requirement, hobby/trial/commercial distinctions and stated telemetry behavior |
| R10 | [External content](https://tldraw.dev/sdk-features/external-content) | Supported asset/content handler overrides rather than relying solely on hiding buttons |
| R11 | [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/) | Worker/DO bindings, SQLite migration and configuration format |
| R12 | [Workers testing](https://developers.cloudflare.com/workers/testing/) | Real local Wrangler runtime plus separate core and browser tests; no invented mock hibernation certification |
| R13 | [Playwright test configuration](https://playwright.dev/docs/test-configuration) | Separate browsers, isolated contexts, real web-server test setup and traces |

The implementation consulted the exact v5.4.1 source for `TLSocketRoom`, `TLSyncRoom`, `TLSyncStorage`, `chunk`, `useSync`, `TLUser`, `createTLSchema`, `Tldraw`, UI component overrides, tools, and external content handlers. Notably, the current-user API now supports persistent attribution records: Canvas keeps that store null and overrides only presence. Omitting this distinction would violate the anonymous presence-only requirement.

Official GitHub Actions releases/marketplace entries were rechecked during workflow creation: checkout 7.0.1, setup-node 7.0.0, upload-artifact 7.0.1, configure-pages 6.0.0, upload-pages-artifact 5.0.0, deploy-pages 5.0.1. The workflow uses exact release tags rather than stale examples from an older README. See the respective repositories under [github.com/actions](https://github.com/actions).

## Dependency verification boundary

The selected SDK version and core public APIs were checked against upstream. React 19.2.1, Vite 8.0.16, its React plugin 6.0.1 and Wrangler 4.75.0 follow the inspected current starter's manifest; surrounding lint/test/type tooling is exact-pinned to known stable versions. This is **not** a claim that every development dependency is the newest available release.

Package installation and registry resolution did not complete in the authoring runner. Compatibility of the entire resolved dependency graph, npm audit results, and the generated lockfile therefore remain unverified. Source inspection is not an adequate replacement for the required install/typecheck/build/browser gates. AUDIT.md records this as a release blocker.
