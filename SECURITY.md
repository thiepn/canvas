# Security and privacy model

**Anyone who can reach Canvas can read and change the shared world.** There are no accounts, verified identities, private regions, roles, or invitations. A browser UUID is only a presence identifier. A deployment URL and CORS/origin checks are not cryptographic access control; a non-browser client can supply an allowed Origin header.

Do not place confidential documents, credentials, personal records, or information requiring controlled access in this world. Anyone with editing access can select and delete content. Rolling backups reduce accidental-loss risk but do not make the editor access-controlled.

## Implemented boundaries

The Worker accepts only the fixed public `main` world and configured browser origins. Public routes do not expose restore. The native sync library validates its protocol and schema; application rules reject assets, persistent user records, extra pages, unsupported shapes, binary payloads, unsafe JSON structure/keys, oversized records/text, excessive chunk streams, invalid coordinates, and operations above shape/byte quotas. The client additionally blocks file drops/paste and media handlers, strips pasted HTML to plain text, and reduces available tools. No preview URLs are fetched by the backend.

Record metadata is not an arbitrary storage escape hatch. Current application records require empty `meta`. URLs in supported text/link fields accept only the allowed HTTP(S)/mailto schemes. Editor text is not rendered through application-controlled `innerHTML`. The full imported world is checked for duplicate records and invalid/cyclic parent trees, followed by native schema validation on restore.

Administration uses a separate at-least-32-character secret, compared through fixed-length SHA-256 digests. Admin endpoints reject browser Origin headers, require authorization, and disable caching. Restore additionally needs all clients closed, an exact clock precondition, explicit CLI acknowledgement, compatible schema/engine, and a successful safety backup. The example test token is not a production credential; the test Worker rejects non-local hostnames.

No secret is embedded in frontend configuration. The tldraw license key is intentionally a public browser value. Cloudflare account credentials and `ADMIN_TOKEN` must remain private.

## Persistence and collection

Local browser storage holds anonymous identity, appearance, hint dismissal, and native local preferences. The Worker stores shared vector/text records plus recovery snapshots. Transient presence is separate; persistent SDK user-attribution records are intentionally disabled. App-owned logs do not include entire records or cursor updates. The static service worker does not cache API responses or shared document snapshots.

No analytics, advertising, tracking pixel, email collection, or added telemetry SDK is present. License-related behavior is documented in THIRD_PARTY_NOTICES.md. Cloudflare and GitHub remain the hosting providers and process requests under their own policies.

## Residual risk and verification limits

This is not a hardened public SaaS: it has no per-person access control, distributed abuse-control layer, audit attribution, end-to-end encryption, or protection from a trusted editor acting maliciously. Token buckets and quotas reduce accidents and simple floods, not all attacks. Public misuse can consume free-tier resources. Same-database snapshots do not cover deletion of the hosting account/namespace; retain owner-downloaded exports separately.

The dependency audit, real Worker admission tests, browser media tests, and runtime security regressions were not executable in the authoring runner because package installation was blocked. Their source exists, but those checks must pass before release. There is no claim of independent penetration testing or complete XSS/WCAG certification.

To report a sensitive defect, contact the repository owner privately; do not publish an active admin token or private canvas content in a public issue. Rotate a leaked admin token with `wrangler secret put ADMIN_TOKEN` and inspect exported backups before recovery.
