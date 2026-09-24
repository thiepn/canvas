# Phase 6 — Collaboration V2 & Shared Presence

Phase 6 keeps Canvas as one shared Excalidraw world while making presence substantially more useful without turning ephemeral collaboration state into durable canvas data.

## Collaboration state lane

Supabase Realtime Broadcast event `collab-state` carries protocol version 2 snapshots:

- random tab session ID + monotonic sequence
- send timestamp with stale-packet rejection
- display name and stable presence color
- cursor visibility preference and optional scene-space pointer
- current selected element IDs
- current viewport center/zoom inputs
- activity: idle, drawing, or typing

Packets are validated, byte-bounded, throttled to about 20 Hz during motion, and refreshed by a 5 s heartbeat. A new tab session can restart its sequence from 1 without accepting stale packets from the previous session.

Cursor rendering is app-owned instead of Excalidraw-owned so Canvas can smooth pointer motion, render the laser pointer consistently, hide all remote cursors locally, and honor a collaborator who disables cursor sharing. Excalidraw's collaborator map still receives remote selections.

## Navigation and attention

The Canvas menu exposes per-collaborator actions:

- **Jump** maps the collaborator's shared scene center/zoom into the local viewport.
- **Follow** reapplies that viewport when new collaboration snapshots arrive.
- **Stop** exits follow mode without changing shared data.
- **Ping** sends a targeted, short-lived attention effect.
- Emoji reactions are short-lived broadcast effects and never enter Postgres history.

Leaving Presence removes stale collaborator state, sequence gates, and follow state. Cursor/activity state also expires if a peer stops publishing without a clean leave event.

## Activity and laser pointer

Typing activity is published for both native Excalidraw text editing and Canvas rich text. Drawing activity covers pen/highlighter and native shape/line/frame gestures. Activity returns to idle when the continuous operation ends.

The laser pointer uses Excalidraw's laser tool locally but publishes through Collaboration V2, so it remains ephemeral and never becomes a scene element.

## Multiplayer-safe own-action undo

Canvas maintains a bounded local stack of the user's logical operations. Each entry stores:

- the exact committed `version/versionNonce/isDeleted` stamp
- the element snapshot that existed before the operation, or `null` for a creation

Undo is available only after the original mutation is fully saved. The client first confirms that its rendered scene still matches every committed stamp, then calls an atomic Supabase RPC:

- `canvas_apply_own_undo` for production
- `canvas_ci_apply_own_undo` for live tests

The database transaction locks all affected rows, verifies every expected stamp, and applies every inverse row or none. If a collaborator has already produced a newer authoritative version—even if the requesting tab missed that Realtime event—the RPC returns a non-retryable PostgREST `PT409` conflict and the undo is refused. This prevents own-action undo from overwriting unseen collaborator work. `PT409` is intentional: PostgREST 14 retries SQLSTATE `40001`, which can otherwise leave a conflict RPC looping until the request is aborted.

The functions are `SECURITY INVOKER`, use the existing RLS/update policies, cap transactions at 100 unique elements, and are explicitly executable only by `anon` and `authenticated`.

## Reconnect and high-latency behavior

- Reconnect clears stale remote collaboration/effect state and sequence gates before rebuilding Presence.
- Full snapshots plus heartbeat recover from dropped broadcast packets without replay logs.
- Per-session sequences reject duplicated/out-of-order state and effects.
- Remote cursors/activity time out independently of durable canvas reconciliation.
- Durable scene correctness still comes from Postgres rows, revision anti-entropy, and Excalidraw version ordering.
- Collaboration V2 never changes the durability semantics of pointer/text preview broadcasts.

## Regression coverage

Phase 6 adds unit coverage for payload validation, byte bounds, stale sequencing, viewport-follow math, smoothing, effects, and undo stamp rules.

Live Chromium coverage exercises:

- multi-client Jump / Follow / Stop controls
- emoji reactions and targeted pings
- persisted device-local cursor visibility controls
- successful own-action undo through the CI RPC
- refusal of an undo when a newer server version exists while its Realtime event is deliberately dropped
