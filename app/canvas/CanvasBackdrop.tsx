import { forwardRef, useImperativeHandle, useState, type CSSProperties } from 'react'
import type { AppState } from '@excalidraw/excalidraw/types'
import { canvasGridStyle, type CanvasVisualProfile } from './visual-system.ts'

export type CanvasBackdropHandle = {
  sync: (appState: AppState) => void
}

type Props = {
  profile: CanvasVisualProfile
  theme: 'light' | 'dark'
}

export const CanvasBackdrop = forwardRef<CanvasBackdropHandle, Props>(function CanvasBackdrop({ profile, theme }, ref) {
  const [snapshot, setSnapshot] = useState({ scrollX: 0, scrollY: 0, zoom: 1 })

  useImperativeHandle(ref, () => ({
    sync(appState) {
      setSnapshot(current => {
        const next = { scrollX: appState.scrollX, scrollY: appState.scrollY, zoom: appState.zoom.value }
        return current.scrollX === next.scrollX && current.scrollY === next.scrollY && current.zoom === next.zoom ? current : next
      })
    },
  }), [])

  const style = {
    ...canvasGridStyle(profile, snapshot),
    '--canvas-backdrop-theme': theme,
  } as CSSProperties

  return <div
    className={`canvas-backdrop canvas-backdrop--${profile.gridPattern}${profile.ambientGlow ? ' has-ambient-glow' : ''}`}
    data-grid-pattern={profile.gridPattern}
    aria-hidden="true"
    style={style}
  />
})
