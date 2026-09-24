import type { CSSProperties } from 'react'
import type { LocalStorageLike } from '../presence/identity.ts'
import { readPreference, writePreference } from '../storage/preferences.ts'

export type CanvasAccent = 'blue' | 'violet' | 'rose' | 'orange' | 'green' | 'cyan' | 'mono'
export type CanvasPaper = 'clean' | 'warm' | 'cool' | 'graphite'
export type CanvasGridPattern = 'none' | 'dots' | 'lines' | 'squares'
export type CanvasMotion = 'system' | 'full' | 'reduced'

export type CanvasVisualProfile = {
  accent: CanvasAccent
  paper: CanvasPaper
  gridPattern: CanvasGridPattern
  gridSize: number
  gridOpacity: number
  motion: CanvasMotion
  sounds: boolean
  haptics: boolean
  ambientGlow: boolean
}

export const CANVAS_STROKE_COLORS = [
  '#111827', '#374151', '#6b7280', '#ffffff',
  '#dc2626', '#ea580c', '#ca8a04', '#16a34a',
  '#0891b2', '#2563eb', '#7c3aed', '#db2777',
] as const

export const CANVAS_FILL_COLORS = [
  '#ffffff', '#fff3bf', '#ffe8cc', '#d3f9d8',
  '#c5f6fa', '#dbeafe', '#ede9fe', '#fce7f3', '#e5e7eb',
] as const

export const CANVAS_HIGHLIGHT_COLORS = [
  '#fff3bf', '#ffec99', '#ffd8a8', '#ffc9c9', '#d0bfff',
  '#bac8ff', '#a5d8ff', '#c3fae8', '#b2f2bb', '#e9ecef',
] as const

export const CANVAS_BLOCK_COLORS = [
  'transparent', '#ffffff', '#fff9db', '#fff0f6', '#f3f0ff',
  '#e7f5ff', '#ebfbee', '#f8f9fa', '#212529',
] as const

export const ACCENT_PRESETS: Record<CanvasAccent, { label: string; light: string; dark: string }> = {
  blue: { label: 'Blue', light: '#3159c9', dark: '#7f9cff' },
  violet: { label: 'Violet', light: '#6d4bc3', dark: '#ae8cff' },
  rose: { label: 'Rose', light: '#c13d71', dark: '#ff83b0' },
  orange: { label: 'Orange', light: '#b85a12', dark: '#ff9d57' },
  green: { label: 'Green', light: '#287a50', dark: '#65d69a' },
  cyan: { label: 'Cyan', light: '#0d7182', dark: '#5bc7d8' },
  mono: { label: 'Mono', light: '#2f3337', dark: '#d4d7dc' },
}

export const PAPER_PRESETS: Record<CanvasPaper, {
  label: string
  light: string
  dark: string
  panelLight: string
  panelDark: string
}> = {
  clean: { label: 'Clean', light: '#fafaf8', dark: '#17191d', panelLight: '#ffffff', panelDark: '#202329' },
  warm: { label: 'Warm', light: '#fbf7ef', dark: '#1c1915', panelLight: '#fffdf8', panelDark: '#26221c' },
  cool: { label: 'Cool', light: '#f5f8fb', dark: '#15191d', panelLight: '#fbfdff', panelDark: '#1d2329' },
  graphite: { label: 'Graphite', light: '#f1f2f3', dark: '#111315', panelLight: '#f8f9fa', panelDark: '#1a1d20' },
}

export const DEFAULT_VISUAL_PROFILE: CanvasVisualProfile = {
  accent: 'blue',
  paper: 'clean',
  gridPattern: 'dots',
  gridSize: 24,
  gridOpacity: 14,
  motion: 'system',
  sounds: false,
  haptics: true,
  ambientGlow: true,
}

const ACCENTS = new Set<CanvasAccent>(Object.keys(ACCENT_PRESETS) as CanvasAccent[])
const PAPERS = new Set<CanvasPaper>(Object.keys(PAPER_PRESETS) as CanvasPaper[])
const GRID_PATTERNS = new Set<CanvasGridPattern>(['none', 'dots', 'lines', 'squares'])
const MOTIONS = new Set<CanvasMotion>(['system', 'full', 'reduced'])

function clamp(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback
}

function bool(value: string | null, fallback: boolean): boolean {
  return value === null ? fallback : value === 'true'
}

function enumValue<T extends string>(value: string | null, allowed: Set<T>, fallback: T): T {
  return value && allowed.has(value as T) ? value as T : fallback
}

export function loadVisualProfile(storage: LocalStorageLike | null): CanvasVisualProfile {
  return {
    accent: enumValue(readPreference(storage, 'canvas.visual.accent.v1'), ACCENTS, DEFAULT_VISUAL_PROFILE.accent),
    paper: enumValue(readPreference(storage, 'canvas.visual.paper.v1'), PAPERS, DEFAULT_VISUAL_PROFILE.paper),
    gridPattern: enumValue(readPreference(storage, 'canvas.visual.grid-pattern.v1'), GRID_PATTERNS, DEFAULT_VISUAL_PROFILE.gridPattern),
    gridSize: clamp(readPreference(storage, 'canvas.visual.grid-size.v1'), DEFAULT_VISUAL_PROFILE.gridSize, 12, 72),
    gridOpacity: clamp(readPreference(storage, 'canvas.visual.grid-opacity.v1'), DEFAULT_VISUAL_PROFILE.gridOpacity, 4, 36),
    motion: enumValue(readPreference(storage, 'canvas.visual.motion.v1'), MOTIONS, DEFAULT_VISUAL_PROFILE.motion),
    sounds: bool(readPreference(storage, 'canvas.visual.sounds.v1'), DEFAULT_VISUAL_PROFILE.sounds),
    haptics: bool(readPreference(storage, 'canvas.visual.haptics.v1'), DEFAULT_VISUAL_PROFILE.haptics),
    ambientGlow: bool(readPreference(storage, 'canvas.visual.ambient-glow.v1'), DEFAULT_VISUAL_PROFILE.ambientGlow),
  }
}

export function saveVisualProfile(storage: LocalStorageLike | null, profile: CanvasVisualProfile): void {
  writePreference(storage, 'canvas.visual.accent.v1', profile.accent)
  writePreference(storage, 'canvas.visual.paper.v1', profile.paper)
  writePreference(storage, 'canvas.visual.grid-pattern.v1', profile.gridPattern)
  writePreference(storage, 'canvas.visual.grid-size.v1', String(profile.gridSize))
  writePreference(storage, 'canvas.visual.grid-opacity.v1', String(profile.gridOpacity))
  writePreference(storage, 'canvas.visual.motion.v1', profile.motion)
  writePreference(storage, 'canvas.visual.sounds.v1', String(profile.sounds))
  writePreference(storage, 'canvas.visual.haptics.v1', String(profile.haptics))
  writePreference(storage, 'canvas.visual.ambient-glow.v1', String(profile.ambientGlow))
}

export function resolveCanvasMotion(motion: CanvasMotion, systemReduced: boolean): 'full' | 'reduced' {
  return motion === 'system' ? systemReduced ? 'reduced' : 'full' : motion
}

export function paperColors(paper: CanvasPaper, theme: 'light' | 'dark'): { paper: string; panel: string } {
  const preset = PAPER_PRESETS[paper]
  return theme === 'dark'
    ? { paper: preset.dark, panel: preset.panelDark }
    : { paper: preset.light, panel: preset.panelLight }
}

export function accentColor(accent: CanvasAccent, theme: 'light' | 'dark'): string {
  return theme === 'dark' ? ACCENT_PRESETS[accent].dark : ACCENT_PRESETS[accent].light
}

export function visualRootStyle(profile: CanvasVisualProfile, theme: 'light' | 'dark'): CSSProperties {
  const paper = paperColors(profile.paper, theme)
  const accent = accentColor(profile.accent, theme)
  return {
    '--paper': paper.paper,
    '--panel': paper.panel,
    '--accent': accent,
    '--focus': accent,
    '--canvas-grid-opacity': String(profile.gridOpacity / 100),
  } as CSSProperties
}

export type CanvasGridSnapshot = {
  scrollX: number
  scrollY: number
  zoom: number
}

export function canvasGridStyle(profile: CanvasVisualProfile, snapshot: CanvasGridSnapshot): CSSProperties {
  const zoom = Math.max(0.05, Math.min(8, snapshot.zoom))
  const size = Math.max(6, profile.gridSize * zoom)
  const x = ((snapshot.scrollX * zoom) % size + size) % size
  const y = ((snapshot.scrollY * zoom) % size + size) % size
  return {
    '--canvas-grid-size': `${size}px`,
    '--canvas-grid-x': `${x}px`,
    '--canvas-grid-y': `${y}px`,
  } as CSSProperties
}

export type CanvasFeedbackKind = 'tap' | 'soft' | 'success' | 'sparkle'

export function performHaptic(enabled: boolean, kind: CanvasFeedbackKind): void {
  if (!enabled || typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return
  const pattern = kind === 'success' ? [12, 18, 18] : kind === 'sparkle' ? [7, 12, 7] : kind === 'soft' ? 7 : 5
  try { navigator.vibrate(pattern) } catch { /* Optional device feedback only. */ }
}

export function performTone(enabled: boolean, kind: CanvasFeedbackKind): void {
  if (!enabled || typeof window === 'undefined') return
  const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioContextCtor) return
  try {
    const context = new AudioContextCtor()
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    const now = context.currentTime
    const frequency = kind === 'success' ? 620 : kind === 'sparkle' ? 780 : kind === 'soft' ? 410 : 330
    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(frequency, now)
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.025, now + 0.008)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.075)
    oscillator.connect(gain)
    gain.connect(context.destination)
    oscillator.start(now)
    oscillator.stop(now + 0.08)
    oscillator.addEventListener('ended', () => { void context.close() }, { once: true })
  } catch {
    // Audio feedback is optional and must never affect editing.
  }
}
