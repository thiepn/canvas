import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ACCENT_PRESETS,
  DEFAULT_VISUAL_PROFILE,
  accentColor,
  canvasGridStyle,
  loadVisualProfile,
  paperColors,
  resolveCanvasMotion,
  saveVisualProfile,
  type CanvasVisualProfile,
} from '../../app/canvas/visual-system.ts'

class MemoryStorage {
  values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

test('visual profile loads defaults and persists every local visual preference', () => {
  const storage = new MemoryStorage()
  assert.deepEqual(loadVisualProfile(storage), DEFAULT_VISUAL_PROFILE)

  const profile: CanvasVisualProfile = {
    accent: 'violet',
    paper: 'warm',
    gridPattern: 'squares',
    gridSize: 36,
    gridOpacity: 22,
    motion: 'reduced',
    sounds: true,
    haptics: false,
    ambientGlow: false,
  }
  saveVisualProfile(storage, profile)
  assert.deepEqual(loadVisualProfile(storage), profile)
})

test('visual profile rejects invalid enum values and clamps grid controls', () => {
  const storage = new MemoryStorage()
  storage.setItem('canvas.visual.accent.v1', 'radioactive')
  storage.setItem('canvas.visual.paper.v1', 'bad')
  storage.setItem('canvas.visual.grid-pattern.v1', 'triangles')
  storage.setItem('canvas.visual.grid-size.v1', '500')
  storage.setItem('canvas.visual.grid-opacity.v1', '-4')

  const profile = loadVisualProfile(storage)
  assert.equal(profile.accent, DEFAULT_VISUAL_PROFILE.accent)
  assert.equal(profile.paper, DEFAULT_VISUAL_PROFILE.paper)
  assert.equal(profile.gridPattern, DEFAULT_VISUAL_PROFILE.gridPattern)
  assert.equal(profile.gridSize, 72)
  assert.equal(profile.gridOpacity, 4)
})

test('paper and accent colors resolve independently for light and dark themes', () => {
  assert.notEqual(paperColors('clean', 'light').paper, paperColors('clean', 'dark').paper)
  assert.equal(accentColor('violet', 'light'), ACCENT_PRESETS.violet.light)
  assert.equal(accentColor('violet', 'dark'), ACCENT_PRESETS.violet.dark)
})

test('grid math stays locked to scene pan and zoom', () => {
  const profile = { ...DEFAULT_VISUAL_PROFILE, gridSize: 24 }
  const normal = canvasGridStyle(profile, { scrollX: 10, scrollY: -5, zoom: 1 }) as Record<string, string>
  assert.equal(normal['--canvas-grid-size'], '24px')
  assert.equal(normal['--canvas-grid-x'], '10px')
  assert.equal(normal['--canvas-grid-y'], '19px')

  const zoomed = canvasGridStyle(profile, { scrollX: 10, scrollY: -5, zoom: 2 }) as Record<string, string>
  assert.equal(zoomed['--canvas-grid-size'], '48px')
  assert.equal(zoomed['--canvas-grid-x'], '20px')
  assert.equal(zoomed['--canvas-grid-y'], '38px')
})

test('motion preference respects system reduction only in system mode', () => {
  assert.equal(resolveCanvasMotion('system', true), 'reduced')
  assert.equal(resolveCanvasMotion('system', false), 'full')
  assert.equal(resolveCanvasMotion('full', true), 'full')
  assert.equal(resolveCanvasMotion('reduced', false), 'reduced')
})
