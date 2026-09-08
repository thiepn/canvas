# Research record

Technical choices were rechecked against current upstream documentation and source during the September 2026 release hardening.

## Engine decision

### tldraw

tldraw remains the best fit for Canvas because its SDK supplies the difficult editor behavior—selection, transforms, arrows, frames, touch, text, drawing, undo—and its official sync stack supplies record-level multiplayer, presence, schema migration, reconnect, conflict reconciliation, and a Cloudflare Durable Object/SQLite reference architecture.

The GitHub project released **v5.4.1 on 8 September 2026**, but the complete v5.4.1 npm family was not published together: `@tldraw/sync@5.4.1` returned npm `ETARGET` in the first real GitHub Actions install. The release therefore pins the complete interoperating SDK family to **5.4.0**, which is available and has been integration-tested together:

- `tldraw@5.4.0`
- `@tldraw/assets@5.4.0`
- `@tldraw/sync@5.4.0`
- `@tldraw/sync-core@5.4.0`
- `@tldraw/tlschema@5.4.0`

Using one exact version across schema/client/server packages is safer than mixing a GitHub tag with unavailable npm artifacts.

The implementation also switched from the Vite-specific `@tldraw/assets/imports.vite` helper to the documented standards-based `getAssetUrlsByMetaUrl()` loader. With Vite 8/Rolldown, the former caused the dependency optimizer to reject translation `?url` imports in development even though a production build succeeded. The standards-based loader works in both development/E2E and production.

### Excalidraw

Excalidraw remains an attractive MIT-licensed fallback and provides the relevant canvas primitives. Its packaged editor does not turn its hosted-app collaboration service into a drop-in multiplayer backend, so choosing it would require owning more synchronization behavior. For this product, that would increase correctness risk precisely where correctness is the highest priority.

### Custom Konva/Yjs stack

A custom rendering/editor layer plus Yjs could be built, but would duplicate substantial interaction and canvas-engine behavior for no product benefit. It was rejected for V1.

## Cloudflare decision

One SQLite-backed Durable Object is sufficient for the one-world product. Current Cloudflare APIs support:

- WebSocket Hibernation via `acceptWebSocket` and Durable Object WebSocket event handlers;
- serialized per-socket attachments for hibernation reconstruction;
- WebSocket auto-response so tldraw ping/pong traffic need not continually wake the object;
- SQLite-backed durable storage within the Durable Object;
- alarms for bounded backup scheduling without a permanent interval loop.

Canvas therefore uses one world ID, `main`, and no D1, PostgreSQL, Redis, R2, external queue, managed realtime provider, or always-on server.

## Sources

| ID | Official source | Decision supported |
| --- | --- | --- |
| R1 | [tldraw sync documentation](https://tldraw.dev/docs/sync) | Official record-level synchronization rather than whole-scene overwrite |
| R2 | [tldraw Cloudflare multiplayer starter](https://github.com/tldraw/tldraw-sync-cloudflare) | SQLite sync storage, Durable Object routing, hibernation/session-resume pattern |
| R3 | [tldraw v5.4.0 source](https://github.com/tldraw/tldraw/tree/v5.4.0) | Exact APIs used by the installed package family |
| R4 | [tldraw v5.4.1 release](https://github.com/tldraw/tldraw/releases/tag/v5.4.1) | Confirmed newer GitHub release; npm install evidence showed the complete package family was not available together |
| R5 | [tldraw installation](https://tldraw.dev/installation) | Supported asset URL strategies including `getAssetUrlsByMetaUrl()` |
| R6 | [tldraw external content](https://tldraw.dev/sdk-features/external-content) | Override content handlers and asset handling, not only toolbar visibility |
| R7 | [tldraw licensing](https://tldraw.dev/community/license) | Production-key requirement and hobby/trial/commercial behavior |
| R8 | [Excalidraw package FAQ](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/faq) | Packaged editor collaboration boundary |
| R9 | [Excalidraw MIT license](https://github.com/excalidraw/excalidraw/blob/master/LICENSE) | Sustainable licensing alternative verified |
| R10 | [Cloudflare Durable Objects WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/) | Hibernation, attachments, auto-response, reconnect considerations |
| R11 | [Cloudflare Durable Objects](https://developers.cloudflare.com/durable-objects/) | SQLite-backed state and one-object coordination model |
| R12 | [Cloudflare Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) | Personal/free-tier cost objective and hibernation incentive |
| R13 | [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/) | Current Worker/DO bindings and SQLite migration config |
| R14 | [Workers testing](https://developers.cloudflare.com/workers/testing/) | Real local Worker runtime instead of backend mocks alone |
| R15 | [GitHub Pages custom workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages) | Official artifact-based Pages deployment |
| R16 | [Playwright configuration](https://playwright.dev/docs/test-configuration) | Isolated browser contexts, multiple engines, local web servers, traces |
| R17 | [sharp package](https://www.npmjs.com/package/sharp) | `0.35.4` is the current patched sharp release used for the Wrangler/Miniflare transitive override |

## Current toolchain

The release lockfile pins the dependency graph. Key development tools are:

- React 19.2.1;
- TypeScript 5.8.3;
- Vite 8.2.2;
- `@vitejs/plugin-react` 6.1.1;
- Playwright 1.63.0;
- Wrangler 4.130.0.

Wrangler 4.130.0 currently resolves a Miniflare build that requests `sharp 0.35.2`. npm audit flags that version because of bundled libheif vulnerabilities fixed in `sharp 0.35.4`. Canvas therefore uses an npm `overrides` entry for `sharp: 0.35.4`; the complete Worker dry-run, local persistence tests, browser tests, and dependency audit are release gates for that override.

## Important implementation findings

- `TLSocketRoom` owns the multiplayer protocol and conflict handling. Canvas does not layer another ad-hoc full-document protocol over it.
- tldraw presence is distinct from persisted document records. Canvas supplies local anonymous identity through presence while rejecting persistent user records on the server.
- hibernation destroys normal Durable Object in-memory state, so session-resume data is serialized onto sockets and authoritative document data remains in SQLite.
- media must be blocked in several places: toolbar/content handlers, paste/drop guards, asset storage, and server record authorization. Hiding an image button alone is insufficient.
- GitHub project Pages for this actual repository is case-sensitive `/canvas/`, not `/Canvas/`.
- origin allowlisting is operational containment, not authentication. Anyone who can access the permitted frontend can edit the world.

## Evidence boundary

Local Wrangler/Playwright tests establish application behavior against the development Worker runtime. They do **not** prove that a production Cloudflare deployment has actually entered and resumed from platform hibernation; that remains a deployment verification item because no Cloudflare account deployment is performed by repository CI.

Similarly, responsive/touch automation is not a substitute for physical iPad/stylus testing. These limitations are carried explicitly into [AUDIT.md](AUDIT.md) rather than being treated as passed by inference.
