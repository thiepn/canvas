import type { CSSProperties } from 'react'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import type { CollaborationEffectView, RemoteCollaborationState } from './collaboration-v2.ts'

type Props = {
  api: ExcalidrawImperativeAPI | null
  collaborators: RemoteCollaborationState[]
  effects: CollaborationEffectView[]
  showCursors: boolean
  followDeviceId: string | null
  viewportRevision: number
  onStopFollowing: () => void
}

function screenPoint(api: ExcalidrawImperativeAPI, point: { x: number; y: number }) {
  const state = api.getAppState()
  return {
    x: (point.x + state.scrollX) * state.zoom.value,
    y: (point.y + state.scrollY) * state.zoom.value,
  }
}

function pointStyle(point: { x: number; y: number }, color?: string): CSSProperties {
  return {
    '--collaboration-x': `${point.x}px`,
    '--collaboration-y': `${point.y}px`,
    ...(color ? { '--collaboration-color': color } : {}),
  } as CSSProperties
}

export function CollaborationOverlay({
  api,
  collaborators,
  effects,
  showCursors,
  followDeviceId,
  viewportRevision: _viewportRevision,
  onStopFollowing,
}: Props) {
  if (!api) return null
  const following = followDeviceId ? collaborators.find(person => person.deviceId === followDeviceId) : null

  return <div className="collaboration-overlay" aria-hidden={!following}>
    {showCursors && collaborators.map(person => {
      if (!person.cursorVisible || !person.pointer) return null
      const point = screenPoint(api, person.pointer)
      return <div
        key={person.deviceId}
        className={`collaboration-cursor${person.pointer.tool === 'laser' ? ' is-laser' : ''}`}
        style={pointStyle(point, person.color)}
        aria-hidden="true"
      >
        {person.pointer.tool === 'laser'
          ? <span className="collaboration-laser-dot" />
          : <span className="collaboration-cursor-arrow">➤</span>}
        <span className="collaboration-cursor-label">
          {person.displayName}
          {person.activity !== 'idle' && <small>{person.activity === 'typing' ? 'Typing…' : 'Drawing…'}</small>}
        </span>
      </div>
    })}

    {effects.map(effect => {
      const point = screenPoint(api, effect.point)
      return <div
        key={effect.effectId}
        className={`collaboration-effect collaboration-effect--${effect.kind}`}
        style={pointStyle(point, effect.color)}
        aria-hidden="true"
      >
        {effect.kind === 'reaction' ? effect.emoji : <span />}
      </div>
    })}

    {following && <div className="collaboration-follow-banner" role="status">
      <span>Following <strong>{following.displayName}</strong></span>
      <button type="button" onClick={onStopFollowing}>Stop</button>
    </div>}
  </div>
}
