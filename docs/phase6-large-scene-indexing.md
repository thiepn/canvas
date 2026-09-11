# Phase 6 — Large-scene incremental indexing

Phase 6 reduces Canvas-owned work when a large Excalidraw scene changes by a small amount. It does not claim to remove Excalidraw's inherent cost of rendering or traversing a large scene; it removes avoidable application-layer work layered on top of that engine cost.

## Why this phase exists

The Phase 1 performance baseline showed that large scenes are viable but increasingly expensive: the synthetic 10,000-element Excalidraw fixture measured roughly 909.6 ms initial render, 78.8 ms p95 while moving one element and 83.3 ms p95 while moving twenty elements. That fixture intentionally bypasses the production Supabase editor, so those numbers are engine/workload context rather than proof that Canvas-owned synchronization code caused the latency.

Production nevertheless added several whole-scene costs of its own:

- every Excalidraw `onChange` callback filtered the complete scene and then ran preview/quarantine/version/conflict logic for every allowed element, even when only one immutable element version changed;
- authoritative row application used `Array.find()` for each incoming row, turning a page of authoritative updates into repeated linear scans of the local scene;
- preview expiry used repeated linear scene lookups;
- Phase 5 paginated initial hydration rendered/reconciled each 500-row page separately, so a 1,100-row scene required three scene commits and a 10,000-row scene could require twenty.

Phase 6 removes those avoidable costs while preserving the Phase 2–5 synchronization contracts.

## Scene version index

`SceneVersionIndex` tracks the last observed immutable `(version, versionNonce, isDeleted)` stamp for each Excalidraw element ID.

Excalidraw still calls `onChange` with the complete scene, so Canvas must perform one cheap traversal. The index changes what happens inside that traversal:

1. allowed elements whose immutable stamp is unchanged are skipped immediately;
2. only changed stamps enter preview quarantine checks, operation tracking, conflict protection and pending-state logic;
3. the index stores stamp snapshots independently of object references, so an unexpected in-place mutation is still detected;
4. remote scene updates proactively refresh the index so delayed remote `onChange` callbacks do not become expensive local candidates.

This is a structural optimization, not a semantic shortcut. The existing version ordering remains the authority for whether a changed element may enter local pending state.

## Direct ID lookup for authoritative application

`applyRows()` now builds one `Map<id, element>` for the current scene and uses constant-time lookups for exact-ack detection. Before Phase 6, each authoritative row used `localElements.find(...)`.

For a scene of `N` elements and a page of `M` authoritative rows, the Canvas-owned lookup structure changes from repeated `O(N × M)` scans to `O(N + M)` map construction/lookups. Excalidraw reconciliation itself still has its own engine cost.

Preview-expiry restoration uses the same direct-ID indexing instead of one full-scene `.find()` per preview record.

## Atomic paginated initial hydration

Phase 5 correctly made authoritative hydration paginated, but it applied each page as soon as it arrived. Phase 6 separates **transport pagination** from **scene publication**:

- the client continues fetching 500-row revision pages;
- initial synchronization stages those rows in memory while editing remains paused;
- only after the revision scan completes successfully are all staged rows reconciled into Excalidraw once;
- an empty authoritative scan still commits once and clears a stale local scene;
- cancellation/failure publishes no partial initial scene;
- background Phase 5 anti-entropy remains incremental and continues applying its usually-small revision deltas page by page.

For a 1,100-row world this deterministically changes initial scene commits from 3 to 1. For 10,000 rows it changes the page-driven scene-commit count from 20 to 1, independent of network timing.

## Diagnostics

`?debug=1` adds content-free Phase 6 signals:

- scene-observation callback count;
- elements scanned by Excalidraw callbacks;
- unchanged immutable stamps skipped;
- changed stamps entering the expensive local path;
- scene-observation duration p95;
- initial hydration page count;
- initial hydration row count;
- initial hydration scene-commit count.

The distinction between `scanned` and `changed` is intentional. Canvas cannot prevent Excalidraw from supplying the full scene to `onChange`, but it can keep unchanged elements out of mutation/conflict processing.

## Verification contract

### Unit

`tests/unit/scene-index.test.ts` proves:

- unchanged immutable stamps are skipped after first observation;
- a recreated object with the same stamp is skipped;
- an in-place mutation is detected because the previous stamp was snapshotted separately from the object reference;
- nonce/tombstone changes remain observable;
- disallowed elements are never indexed;
- replace/mark/delete semantics and direct ID indexing behave deterministically.

### Real Excalidraw + Supabase

`tests/live/large-scene-indexing.spec.ts` seeds **1,100 real rows** into the isolated `canvas_ci_elements` table and then opens the production Supabase editor. It requires:

1. three authoritative 500-row transport pages;
2. exactly one initial Excalidraw scene commit;
3. all 1,100 active elements to be present in the exported scene;
4. a real local move of the seed rectangle to persist normally;
5. the move callbacks to scan the scene but skip hundreds of unchanged immutable stamps and send only the changed element(s) through the expensive path;
6. zero page errors.

The existing operation-boundary durability, preview lane, anti-entropy, conflict, reconnect, lifecycle, E2E and compiled-production suites remain mandatory.

## Non-goals

Phase 6 does not change the Supabase schema, revision semantics, RLS, durability cadence, preview protocol, anti-entropy interval, product tools or Excalidraw engine. It does not claim that a 10,000-element scene becomes cheap; rendering, hit testing, selection and engine reconciliation still scale with the underlying editor. This phase only removes application-layer work that Canvas can avoid safely.
