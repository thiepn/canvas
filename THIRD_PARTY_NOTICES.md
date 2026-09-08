# Third-party licensing and telemetry

Canvas-specific code is offered under the repository MIT license. Dependencies retain their own licenses; this repository does **not** relicense the tldraw SDK as MIT software.

## tldraw

Canvas pins the interoperating tldraw package family to **5.4.0**. Production use of the SDK requires a valid tldraw trial, commercial, or hobby license key under tldraw's terms. No key is supplied, fabricated, bypassed, or committed by Canvas.

For a qualifying noncommercial project, tldraw offers a discretionary hobby license. Hobby deployments retain the required **“made with tldraw”** watermark. A trial is time-limited; commercial licensing follows tldraw's commercial terms. The key is intentionally treated as public frontend configuration because the SDK validates it client-side.

Current official documentation should be checked again before every production licensing change:

- [tldraw SDK license](https://tldraw.dev/community/license)
- [license key behavior](https://tldraw.dev/sdk-features/license-key)
- [pricing](https://tldraw.dev/pricing)
- [hobby application](https://tldraw.dev/get-a-license/hobby)

### License telemetry

The current **license-key** documentation states that data collection depends on license type:

| License state | Vendor-documented data sent from production SDK |
| --- | --- |
| Commercial | None |
| Hobby | License ID, license type, SDK version, build environment, and page/deployment URL |
| Trial | License ID, license type, SDK version, build environment, and page/deployment URL |
| Unlicensed production | SDK version and page URL |
| Development/localhost | No license telemetry described for development environments |

The same documentation states that no user data, canvas content, or personally identifiable information is collected through this license telemetry.

An older general tldraw license page still contains a different statement saying hobby/commercial send no information and trial sends only a key hash. Because the dedicated current license-key documentation is more specific about the runtime implementation, Canvas documents the more conservative/current behavior above rather than relying on the older statement.

This is a description of tldraw's published documentation, **not an independent network audit**. Canvas itself adds no analytics, tracking pixel, advertising SDK, or product telemetry.

### Watermark and production failure behavior

The current license-key documentation says hobby licenses keep the watermark. Trial/commercial keys remove it. A non-local production build without a valid key logs license errors and stops rendering the editor after a short period; therefore the Pages workflow requires a configured production key rather than silently publishing an unusable editor.

## tldraw Cloudflare starter

The official [tldraw Cloudflare multiplayer starter](https://github.com/tldraw/tldraw-sync-cloudflare) informed the SQLite sync and WebSocket Hibernation integration. The starter/example code is separately licensed from the SDK packages. Canvas removes the starter's media/unfurl storage concerns and adds its own one-world routing, media exclusion, size policy, recovery storage, interface, and deployment gates.

Using MIT-licensed starter code does not change the license of imported tldraw SDK packages.

## React, Vite, Cloudflare, Playwright, and supporting packages

React, React DOM, Vite, the Vite React plugin, TypeScript, Wrangler, Playwright, ESLint, Prettier, and transitive dependencies retain their upstream licenses/notices.

The source repository commits `package-lock.json` so the installed dependency graph is auditable. CI records `npm audit --json` and rejects high/critical findings. During hardening, Wrangler/Miniflare resolved `sharp 0.35.2`, which was covered by a high-severity libheif advisory. The project therefore overrides the transitive dependency to patched `sharp 0.35.4` and verifies the actual Worker runtime after installation.

Static editor fonts/icons/assets are resolved from the installed tldraw asset package and retain their upstream licenses. Canvas does not copy font binaries into a separate downloadable package.

## Canvas-owned assets

The simple Canvas favicon/PWA icons are project assets. No stock photography, uploaded media, external thumbnails, third-party analytics, or advertising assets are bundled as product content.

## Redistribution

Before redistributing a compiled build or changing engine/dependencies:

1. review the current tldraw license and the specific issued key terms;
2. preserve required watermark/attribution behavior;
3. retain dependency notices required by upstream licenses;
4. rerun license/security dependency checks against the new lockfile;
5. do not assume this notice supersedes a dependency's own license text.
