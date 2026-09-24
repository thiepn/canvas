# Phase 7 — Images, Clipboard, Import & Export V2

Phase 7 adds bounded image and scene-transfer capabilities while preserving Canvas as a shared spatial canvas rather than a file manager.

## Image persistence

Image bytes are SHA-256 content-addressed and stored under `sha256/<digest>` in Supabase Storage.

- production bucket: `canvas-assets`
- CI bucket: `canvas-ci-assets`
- maximum image size: 12 MB
- MIME allowlist: PNG, JPEG, WebP, GIF, SVG
- production uploads are immutable; no anonymous overwrite/delete
- CI can delete exact fixture objects
- downloaded bytes are re-hashed before Excalidraw receives them

Excalidraw image elements stay local in `pending` state while the binary uploads. Only `saved` image versions enter the durable Postgres queue.

## Image interaction

Canvas supports:

- toolbar/file-picker image insertion
- image paste and drag/drop
- native resize, rotate, crop and opacity
- Canvas-owned Replace image action that preserves object geometry/ID and resets crop
- reload and collaborator hydration from Storage
- content deduplication across copies/imports through the shared file hash

## Clipboard and links

Excalidraw's native clipboard payload is retained so copied image elements carry their referenced binary data. When pasted into another Canvas session, the same binary is deduplicated into the content-addressed Storage lane.

Canvas rich-text editing continues to consume `text/html`, sanitize it through the existing rich-text allowlist, and fall back to plain text. A standalone HTTP/HTTPS text paste on the canvas becomes a normal linked rectangle card. Other text keeps the existing Excalidraw/rich-text paste behavior.

## Import

The import control accepts:

- Canvas backup v2
- Canvas backup v3
- native Excalidraw JSON
- supported image files

Imported scene element IDs, group IDs, frame/container references and linear bindings are regenerated/remapped before insertion so an old backup cannot collide with existing shared IDs. Unsupported element types are dropped. Imported image files are re-hashed from their actual bytes rather than trusting serialized file IDs.

## Export

Canvas exports:

- JSON — backup v3 with only image files referenced by active elements
- PNG
- SVG
- PDF — one-page image-faithful PDF using the same rendered scene

The existing settings-menu JSON backup action now uses the same v3 portable exporter.

## SVG and link policy

Static SVG artwork is supported. Canvas rejects SVG with scripts, `foreignObject`, iframes/objects/embeds, inline event handlers, external HTTP references, external CSS imports, JavaScript URLs, DOCTYPE or ENTITY declarations.

Scene links are constrained independently in Postgres and in the client. Empty/null links, HTTP(S) links, and internal `#` anchors are allowed. Other schemes are rejected from shared rows and stripped during JSON import.

## Retention

Production image assets are not immediately deleted when an element is tombstoned. A hash may still be referenced by another image or required by recovery history. Immutable content addressing and deduplication keep this retention model bounded by unique uploaded image content rather than edit count.
