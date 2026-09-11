export type CanvasConnectionState = 'Connecting' | 'Synchronizing' | 'Live' | 'Reconnecting' | 'Offline' | 'Error'

export type SyncHealthInput = {
  connection: CanvasConnectionState
  queuedChanges: number
  writeInFlight: boolean
  localEditing: boolean
  saveIssue: boolean
}

export type SyncHealthTone = 'ok' | 'busy' | 'offline' | 'error'

export type SyncHealth = {
  key: 'connecting' | 'synchronizing' | 'saved' | 'editing' | 'saving' | 'waiting' | 'retrying-save' | 'reconnecting' | 'offline' | 'error'
  label: string
  detail: string
  tone: SyncHealthTone
  busy: boolean
}

export function deriveSyncHealth(input: SyncHealthInput): SyncHealth {
  const queued = Math.max(0, Math.floor(input.queuedChanges))

  if (input.connection === 'Error') {
    return {
      key: 'error',
      label: 'Sync problem',
      detail: queued > 0
        ? 'Editing is paused. Changes waiting to save are kept in this tab while Canvas retries.'
        : 'Editing is paused while Canvas retries the shared connection.',
      tone: 'error',
      busy: true,
    }
  }

  if (input.connection === 'Offline') {
    return {
      key: 'offline',
      label: 'Offline',
      detail: queued > 0
        ? 'Editing is paused. Changes waiting to save will retry when the connection returns.'
        : 'Editing is paused until the shared canvas reconnects.',
      tone: 'offline',
      busy: false,
    }
  }

  if (input.connection === 'Connecting') {
    return {
      key: 'connecting',
      label: 'Connecting…',
      detail: 'Connecting to the shared canvas. Editing is paused.',
      tone: 'busy',
      busy: true,
    }
  }

  if (input.connection === 'Reconnecting') {
    return {
      key: 'reconnecting',
      label: 'Reconnecting…',
      detail: queued > 0
        ? 'Reconnecting to the shared canvas. Changes waiting to save are kept in this tab.'
        : 'Reconnecting to the shared canvas. Editing is paused.',
      tone: 'busy',
      busy: true,
    }
  }

  if (input.connection === 'Synchronizing') {
    return {
      key: 'synchronizing',
      label: 'Synchronizing…',
      detail: 'Loading the latest shared canvas before editing resumes.',
      tone: 'busy',
      busy: true,
    }
  }

  if (input.saveIssue && queued > 0) {
    return {
      key: 'retrying-save',
      label: 'Retrying save…',
      detail: 'Your completed changes are still in this tab and Canvas is retrying automatically.',
      tone: 'error',
      busy: true,
    }
  }

  if (input.writeInFlight) {
    return {
      key: 'saving',
      label: 'Saving…',
      detail: 'Saving your completed change to the shared canvas.',
      tone: 'busy',
      busy: true,
    }
  }

  if (input.localEditing) {
    return {
      key: 'editing',
      label: 'Editing',
      detail: 'This active gesture is local until the operation finishes.',
      tone: 'busy',
      busy: true,
    }
  }

  if (queued > 0) {
    return {
      key: 'waiting',
      label: 'Waiting to save…',
      detail: 'Your completed change is queued for the shared canvas.',
      tone: 'busy',
      busy: true,
    }
  }

  return {
    key: 'saved',
    label: 'Saved',
    detail: 'All completed changes are saved to the shared canvas.',
    tone: 'ok',
    busy: false,
  }
}

export function recoveryMessage(health: SyncHealth): string | null {
  switch (health.key) {
    case 'offline':
    case 'error':
    case 'reconnecting':
    case 'connecting':
    case 'synchronizing':
      return health.detail
    default:
      return null
  }
}
