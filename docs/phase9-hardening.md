# Phase 9 — Scale, Performance, Accessibility & Data Hardening

Phase 9 is a hardening phase. It does not add a new product surface.

## Scale and performance

- immutable-version indexing avoids repeated expensive mutation work for unchanged Excalidraw objects
- fixed-cell spatial indexes cull Canvas-owned rich-text/custom-shape DOM overlays to the viewport plus overscan
- selected/editing rich text remains rendered outside the normal culling window
- image downloads are key-deduplicated and concurrency bounded
- debug diagnostics distinguish visible-tab frame stalls from actual Long Tasks
- the performance harness measures 100 / 1,000 / 5,000 / 10,000-element scenes
- budgets enforce render, pan, mutation, selection, serialization, memory, collaboration and reconnect ceilings
- the performance workflow runs manually and weekly

## Local recovery and lifecycle

Canvas journals completed unsaved mutations to IndexedDB before network durability attempts.

The journal is:

- device/table scoped
- schema-versioned
- capped at 2,000 elements and 8 MiB
- expired after seven days
- limited to normal persistable Canvas elements
- geometry/point validated before replay

Supabase authority is loaded first. A journal version is restored only when it still wins under Canvas's immutable version ordering. Newer collaborator/server state always wins.

Page hide, offline transitions, failed/aborted writes and bounded request timeouts preserve retryable local state. Page show/online reconnect continues through authoritative reconciliation.

## Data integrity

Phase 9 adds:

- database geometry bounds for x/y/width/height/angle
- matching browser row/preview/import/recovery checks
- bounded line/arrow/freedraw point arrays
- text-size limits for untrusted shared/import payloads
- 80 MiB import byte limit
- 20,000 imported-element limit
- 500 imported-file limit
- partial-import reporting when unsupported/unsafe objects are dropped
- malformed shared-content rejection diagnostics

## Accessibility and responsive resilience

The release matrix explicitly covers:

- 320 px viewport width
- short landscape layouts
- safe-area-aware popovers/panels
- keyboard skip navigation and canvas landmark focus
- visible focus indicators
- forced-colors mode
- reduced motion
- text wrapping/zoom resilience
- named Canvas-owned controls and status surfaces

## PWA and offline shell

The service worker caches only same-origin static application-shell assets. Supabase API/shared state is never cached. Update activation and stale-shell cleanup are hardened so editor code is not replaced in the middle of an active session.

## Collaboration stress

Live regression coverage includes four simultaneous clients creating shared content, latency-injected writes, crash recovery, anti-entropy/reconnect paths and large-scene hydration.

## Non-goals

Phase 9 does not replace Excalidraw's renderer, add a server-side canvas engine, add access-control/accounts, or turn local recovery into an offline fork of the shared canvas.
