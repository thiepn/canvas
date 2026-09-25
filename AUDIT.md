# Canvas v2.0 — Release Audit

**Release line:** 2.0.0  
**Architecture:** Excalidraw 0.18.1 + Supabase Postgres/Realtime/Storage + GitHub Pages  
**Phase 10 objective:** freeze the v2 feature surface, exercise the complete production architecture, fix confirmed regressions, and make deployment conditional on evidence from the exact commit being shipped.

## Executive assessment

Canvas v2 remains one deliberately narrow product: one shared realtime infinite canvas for trusted people, with no accounts, rooms, document hierarchy, arbitrary attachments, or application server.

Phases 1–9 established the editor, durable mutation model, realtime previews, anti-entropy, collaboration, media/import/export, device-local visual system, scale hardening, accessibility resilience, crash recovery, and performance budgets. Phase 10 adds no product subsystem. It closes release-integrity gaps around shared history, compiled PWA behavior, version provenance, and exact-commit performance certification.

## Frozen v2 surface

Supported shared content and manipulation includes selection, move, resize, rotate, grouping/frame operations, duplicate, locking, deletion, freehand, rectangle, ellipse, diamond, line, arrow, text, rich text, frames, bounded images, collaboration state, Canvas/Excalidraw JSON import, portable clipboard workflows, JSON/PNG/SVG/PDF export, and persistent vector stamps.

Video, audio, PDF-as-scene-object, arbitrary file attachments, iframes/embeds, accounts, room selection, and independent offline-authoritative editing remain outside v2.

## Confirmed Phase 10 corrections

### Release provenance

package.json and the root lockfile now identify the same stable release version. Unit coverage keeps package/lock metadata synchronized. The release verifier rejects prerelease version strings, non-production release table configuration, unsafe base paths, and malformed public configuration.

### Collaboration-safe history

Canvas already used a Postgres transaction for conflict-checked own-action undo. The audit found that browser/Excalidraw redo shortcuts could still fall through to a tab-local history stack after the authoritative undo transaction. That local stack is not collaboration authority.

Phase 10 therefore owns global shared-history shortcuts completely:

- Ctrl/Cmd+Z invokes only Canvas's conflict-checked own-action undo.
- Tab-local undo cannot run when no safe Canvas undo entry exists.
- Ctrl/Cmd+Shift+Z and Ctrl/Cmd+Y are blocked in shared mode instead of replaying stale local history.
- Rich-text editing keeps local editing undo/redo inside its contenteditable editor.

A live Supabase regression proves that a completed authoritative undo cannot be resurrected by local undo/redo shortcuts.

### PWA lifecycle evidence

The service worker remains static-shell only. Phase 10 adds a compiled-production browser regression that installs the built worker under the real /canvas/ scope, reloads under worker control, verifies Cache Storage contains Canvas shell content and no Supabase URL, performs a full offline navigation/reload, confirms the shell still renders in Offline state, then reconnects to Live.

### Exact-commit performance gate

The weekly/manual performance workflow remains useful for trend detection, but historical evidence is not enough to certify a new deployment. The main CI pipeline now has a separate release-certification job after the full quality matrix. GitHub Pages deployment depends on both jobs.

The certification job covers the 10,000-object scene budgets and collaboration/reconnect budgets defined by the repository.

## Automated release matrix

| Area | Evidence |
| --- | --- |
| Dependency/security baseline | high-severity npm audit |
| Architecture drift | production-only architecture audit |
| Static correctness | ESLint, strict TypeScript, unit suite |
| Production build | optimized Vite build plus bundle audit |
| Live persistence | real Supabase CI table |
| Browser matrix | Chromium, Firefox, WebKit |
| Collaboration | persistence, previews, presence, anti-entropy, own-action undo |
| Shared history | server-authoritative undo plus local-history containment |
| Media/data transfer | image hash/storage checks, replacement, clipboard, import/export |
| Recovery | IndexedDB crash journal, stale-journal refusal, lifecycle recovery |
| Data safety | geometry/point/text/import bounds and malformed-row filtering |
| Accessibility/responsive | keyboard path, focus, 320px, landscape, text zoom, forced colors, reduced motion |
| PWA | compiled worker install, cache boundary, offline reload, reconnect |
| Performance | exact-commit 10k scene and collaboration budgets |
| Deployment | Pages build plus published HTTPS verifier |

## Data-loss and corruption posture

Supabase remains authoritative. Completed unsaved local mutations are journaled only as a bounded device-local recovery aid. Startup hydrates server authority first; replay occurs only when a journaled immutable version still outranks authority. Production deletion remains a versioned tombstone, public physical DELETE remains unavailable, and prior destructive production row states remain in the private owner-only recovery schema.

Imports, Realtime rows, previews, and recovery data pass bounded browser validation before entering the editor. Postgres independently enforces the production element contract.

## Security posture

Canvas is intentionally open-write to anyone with the URL. v2 does not claim user-level authorization. Its security boundary is containment and recoverability: no service-role credential in browser code, allowlisted persisted element types, bounded row/geometry contracts, safe-link/static-SVG filtering, immutable content-addressed production image uploads, stale-write rejection, no anonymous production physical DELETE, and private recovery administration.

Canvas must not be used for secrets or sensitive personal information.

## Manual checks that remain manual

Automated browser tests do not substitute for physical stylus pressure/palm-rejection validation, a complete pass with real screen-reader software and human navigation judgment, subjective long-session drawing feel, or infrastructure quota/availability behavior outside controlled simulations. These are explicit residual checks, not automated certification claims.

## Release completion rule

A v2.0 release is complete only when the exact release lineage satisfies all of the following:

1. Pull-request quality matrix is green.
2. Pull-request release-performance certification is green.
3. Merged main repeats both jobs successfully.
4. GitHub Pages deploy succeeds from that merged commit.
5. The published-site verifier confirms HTTPS, exact bundle identity, Live connection, reconnect behavior, wheel behavior, mobile containment, and absence of missing assets/page errors.

A local build, historical performance run, or green PR without merged-main/deployed checks is not sufficient release evidence.
