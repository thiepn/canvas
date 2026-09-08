# Third-party licensing and telemetry

Canvas-specific code is offered under the root MIT license. Dependencies retain their own licenses; this repository does not turn the tldraw SDK into MIT software.

## tldraw

The SDK and aligned packages are pinned to 5.4.1. Its official default terms permit development use; production deployment requires a valid license key. A free hobby license may be granted for qualifying projects at tldraw's discretion and includes the required watermark. Trials are time-limited; commercial usage follows the commercial terms. No key is supplied, fabricated, or bypassed here. Canvas retains the SDK's watermark behavior and exposes the key as public build-time configuration.

As stated in the official licensing documentation checked on 8 September 2026, production hobby/commercial keys do not send license-validation data; trial validation sends a hash of the license key, not canvas/user content. This describes the vendor's stated licensing behavior, not an independent network audit. Canvas adds no analytics implementation of its own.

Read the current [license instructions](https://tldraw.dev/community/license), [pricing/eligibility information](https://tldraw.dev/pricing), and the licenses distributed with the installed packages before production use. Key eligibility, permitted domains and renewal/expiry conditions must be checked for the actual key issued to the owner.

The official [Cloudflare starter](https://github.com/tldraw/tldraw-sync-cloudflare), whose package metadata identifies MIT licensing and tldraw GB Ltd. as author, informed the SQLite/hibernation integration pattern. Canvas removes its media/unfurl/storage services and implements its own policy, interface, backup and deployment layers. The actual SDK package licensing still applies independently.

## Other dependencies and assets

React, Vite, TypeScript, Wrangler, Playwright and the lint/format tools retain their upstream notices. Review the installed dependency licenses and retain required notices when redistributing a compiled build. Static editor assets are resolved from the installed tldraw asset package; their respective font/asset licenses remain applicable. No editor font binaries or installed `node_modules` are distributed in this source archive.

The simple Canvas icons are project assets. No external photographs, uploaded user assets, stock previews, or third-party analytics are included.
