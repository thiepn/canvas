/** Product limits, shared by input guards and the Worker. Not a security identity system. */
export const WORLD_ID = 'main' as const
export const PRIMARY_PAGE_ID = 'page:page'
export const ENGINE_VERSION = '5.4.1'
export const BACKUP_VERSION = 1
export const LIMITS = Object.freeze({
  worldBytes: 8 * 1024 * 1024,
  connections: 20,
  frameBytes: 1_048_576,
  messageBytes: 2_097_152,
  recordBytes: 131_072,
  textCharacters: 20_000,
  jsonDepth: 40,
  jsonNodes: 160_000,
  coordinate: 10_000_000,
  shapes: 10_000,
  backupBytes: 33_554_432,
  backupCompressedBytes: 10_485_760,
  backupTotalBytes: 67_108_864,
  backupChunkBytes: 262_144,
  messagesPerSecond: 80,
  messageBurst: 240,
  bytesPerSecond: 524_288,
  byteBurst: 2_097_152,
})
export const ALLOWED_SHAPES = new Set([
  'geo', 'draw', 'highlight', 'text', 'line', 'arrow', 'frame', 'group',
])
export const ALLOWED_GEOMETRIES = new Set(['rectangle', 'ellipse', 'diamond'])
export const TOOL_IDS = [
  'select', 'hand', 'draw', 'highlight', 'text', 'rectangle', 'ellipse',
  'diamond', 'line', 'arrow', 'frame', 'eraser',
] as const
