# Phase 8 — Production-only repository

Phase 8 retires the historical tldraw + Cloudflare Worker/Durable Object implementation after the Excalidraw/Supabase production path gained equivalent release-critical coverage in Phases 1–7.

## Removed

- the tldraw editor/test bridge and `tldraw` / `@tldraw/*` dependency family;
- the Cloudflare Worker/Durable Object runtime, Wrangler configuration and Worker tests;
- legacy backup/security modules and Worker administration tooling;
- the old runtime switch and legacy Playwright suite;
- stale pre-production evidence that described the retired architecture.

Git history remains the historical record. Phase 8 does **not** delete or migrate Supabase production data or schema.

## Retained release contract

The shipped Excalidraw + Supabase path keeps all production-critical coverage added in Phases 1–7:

- logical operation batching and final-operation durability;
- bounded long-operation checkpoints and retry-safe writes;
- Broadcast collaboration previews;
- revision anti-entropy and reconnect convergence;
- large-scene indexing and paginated hydration;
- explicit save health, offline/reconnect UX and manual retry;
- diagnostics and performance evidence;
- real Chromium, Firefox and WebKit Supabase tests;
- compiled-production tests and the deployed GitHub Pages verifier.

## Architecture guard

`npm run audit:architecture` fails if the retired tldraw/Wrangler package family or Worker runtime files return. The permanent release workflow runs this guard before browser tests.

## Dependency result

The Phase 7 CI installation audited 599 packages. The Phase 8 reduced graph installs 431 packages and audits 432 with zero vulnerabilities in the guarded migration run. This removes roughly 28% of installed packages while leaving the production Excalidraw bundle behavior unchanged.

## Acceptance

Phase 8 is release-complete only when the exact PR head passes the production-only CI matrix, merged `main` repeats that matrix, GitHub Pages deploys, and the published-site verifier passes over HTTPS.
