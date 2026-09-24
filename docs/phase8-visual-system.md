# Phase 8 — Visual System, Backgrounds & Delight

Phase 8 gives Canvas its own coherent visual language without changing the product into a dashboard, note app, asset manager or decoration tool.

## First-class appearance

Canvas now supports:

- System, Light and Dark appearance
- seven accent families
- Clean, Warm, Cool and Graphite paper surfaces
- polished shared surface/border/shadow tokens
- consistent visual treatment across the header, selection toolbar, minimap, navigation, rich text, drawing tools and collaborator UI

All appearance preferences are local to the current browser.

## Scene-locked backgrounds

The Grid preference remains the visibility control. The visual panel adds:

- Dots
- Lines
- Squares
- configurable spacing
- configurable strength

Dots and lines are rendered below Excalidraw and follow scene pan/zoom. Squares continue through Excalidraw's native grid engine so snapping behavior stays exact.

## Unified palette

Drawing, rich text and object styling share the same curated stroke/fill/highlight palette. Existing custom color inputs remain available.

## Lightweight vector stamps

The shape library includes:

- Heart
- Check
- Sparkle
- Pin
- Flag
- Bolt

Stamps use the existing Canvas custom-shape format rather than introducing image assets or sticker storage. They remain normal collaborative elements and work with selection, resize, rotate, lock, undo, export and persistence.

## Presence and micro-interactions

Collaborator cursors, presence indicators and reaction effects receive additional depth and polish without changing the Phase 6 collaboration protocol.

Full motion adds restrained hover lift, pop-in transitions and the local sparkle burst. Reduced motion removes these transitions and animations.

## Optional feedback

Haptics are enabled by default when the browser/device supports vibration. UI sounds are opt-in. Both are local-only, best effort and never affect action correctness.

## Easter egg

`Alt+Shift+C` triggers the same small local sparkle burst available from the visual panel. It creates no canvas object, no network event and no persistent data.

## Non-goals

Phase 8 does not add themes as shared document state, background images, decorative asset libraries, arbitrary stickers, templates, galleries, avatars or gamification systems. The visual layer exists to make the canvas itself more legible and enjoyable.
