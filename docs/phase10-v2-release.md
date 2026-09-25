# Phase 10 — Full Audit, Regression Hardening & v2.0 Release

Phase 10 is the v2 feature freeze. It adds no new product category.

## Audit scope

### Tools and object manipulation

The regression surface includes creation and editing of every persisted v2 element family, selection and transform operations, frames, grouping, locking, deletion/tombstones, rich text, image replacement, clipboard transfer, import/export, stamps, and Canvas-owned visual controls.

### Cross-feature combinations

Release testing intentionally crosses subsystem boundaries:

- local mutation → durable queue → Postgres → Realtime → peer render;
- operation preview → authoritative commit → preview retirement;
- own-action undo → transaction conflict check → Realtime convergence;
- image insert/replace → Storage hash → saved element → reload hydration;
- portable clipboard/import → validation → asset restoration → persistence;
- pagehide/offline → crash journal → authoritative startup → conditional replay;
- large scene → spatial overlay culling → selected/editing overlay pinning;
- local visual settings → shared edits without persisting device preferences;
- service-worker cache → offline shell → reconnect to uncached Supabase state.

## Phase 10 hardening decisions

### Shared history

Canvas does not use Excalidraw's tab-local history as shared authority. Global undo is the existing conflict-checked own-action transaction. Native redo is blocked outside local text editing because replaying a stale local history entry after an authoritative transaction can create an unintended new shared mutation.

This is a correctness restriction, not a new feature. A future redo feature would require the same server-authoritative expected-version semantics as undo.

### PWA

The compiled production suite now exercises service-worker installation and a real offline navigation. It verifies that Canvas static assets recover the shell while Supabase remains outside Cache Storage.

### Performance

The ordinary quality job and release-certification job are serialized because both use canvas_ci_elements. Pages deployment waits for both, so performance evidence belongs to the exact commit being deployed.

### Release metadata

package.json and package-lock.json must agree. The stable-release verifier additionally rejects prerelease versions and non-production release-table configuration.

## Full release command

Run:

    npm ci
    npm run release:verify

By default release:verify performs the high-severity dependency audit, complete quality/check matrix, performance run, report generation, and performance-budget assertion.

CANVAS_SKIP_PERFORMANCE=1 is only for targeted local diagnostics. It is not sufficient for release certification.

## CI order

    quality
      - dependency and architecture audit
      - lint, typecheck, unit
      - optimized build
      - live Chromium/Firefox/WebKit matrix
      - compiled Chromium/Firefox/WebKit matrix
            |
            v
    release-certification
      - exact-commit 10k scene and collaboration performance budgets
            |
            v
    main only: deploy-pages
      - clean rebuild
      - GitHub Pages deployment
      - published HTTPS verification

## Release blockers

Any of the following blocks v2.0:

- high-severity dependency audit failure;
- package/lock release metadata disagreement;
- lint, type, unit, or build failure;
- live or compiled browser regression;
- data-loss/recovery or collaboration convergence failure;
- unsafe native history replay;
- PWA offline-shell/cache-boundary failure;
- performance budget failure;
- failed Pages deployment or published-site verification.

## Residual manual checks

Physical stylus/palm rejection and a complete real screen-reader pass remain manual. Browser automation does not certify hardware behavior or subjective assistive-technology quality.
