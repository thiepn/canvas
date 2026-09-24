import type { RemoteCollaborationState, CollaborationReaction } from './collaboration-v2.ts'
import { COLLABORATION_REACTIONS } from './collaboration-v2.ts'

type Props = {
  collaborators: RemoteCollaborationState[]
  followDeviceId: string | null
  showRemoteCursors: boolean
  shareCursor: boolean
  canUndo: boolean
  disabled: boolean
  onJump: (deviceId: string) => void
  onFollow: (deviceId: string) => void
  onPing: (deviceId: string) => void
  onShowRemoteCursors: (value: boolean) => void
  onShareCursor: (value: boolean) => void
  onUndo: () => void
  onLaser: () => void
  onReaction: (emoji: CollaborationReaction) => void
}

export function CollaborationPanel({
  collaborators,
  followDeviceId,
  showRemoteCursors,
  shareCursor,
  canUndo,
  disabled,
  onJump,
  onFollow,
  onPing,
  onShowRemoteCursors,
  onShareCursor,
  onUndo,
  onLaser,
  onReaction,
}: Props) {
  return <section className="collaboration-panel" aria-label="Collaboration controls">
    <div className="menu-heading">COLLABORATION</div>
    {collaborators.length > 0 && <div className="collaboration-people-actions">
      {collaborators.map(person => <div key={person.deviceId} className="collaboration-person-row">
        <span className="collaboration-person-name">
          <span className="presence-dot" style={{ backgroundColor: person.color }} />
          <span>{person.displayName}</span>
          {person.activity !== 'idle' && <small>{person.activity === 'typing' ? 'Typing' : 'Drawing'}</small>}
        </span>
        <span className="collaboration-person-buttons">
          <button type="button" disabled={disabled || !person.viewport} onClick={() => onJump(person.deviceId)}>Jump</button>
          <button
            type="button"
            disabled={disabled || !person.viewport}
            aria-pressed={followDeviceId === person.deviceId}
            className={followDeviceId === person.deviceId ? 'is-active' : ''}
            onClick={() => onFollow(person.deviceId)}
          >{followDeviceId === person.deviceId ? 'Following' : 'Follow'}</button>
          <button type="button" disabled={disabled} onClick={() => onPing(person.deviceId)}>Ping</button>
        </span>
      </div>)}
    </div>}

    <label className="collaboration-toggle">
      <input type="checkbox" checked={showRemoteCursors} onChange={event => onShowRemoteCursors(event.target.checked)} />
      <span>Show collaborator cursors</span>
    </label>
    <label className="collaboration-toggle">
      <input type="checkbox" checked={shareCursor} onChange={event => onShareCursor(event.target.checked)} />
      <span>Share my cursor</span>
    </label>

    <div className="collaboration-actions">
      <button type="button" disabled={disabled} onClick={onLaser}>Laser pointer</button>
      <button type="button" disabled={disabled || !canUndo} onClick={onUndo}>Undo my last action</button>
    </div>

    <div className="collaboration-reactions" aria-label="Send reaction">
      {COLLABORATION_REACTIONS.map(emoji => <button
        key={emoji}
        type="button"
        disabled={disabled}
        aria-label={`React ${emoji}`}
        onClick={() => onReaction(emoji as CollaborationReaction)}
      >{emoji}</button>)}
    </div>
  </section>
}
