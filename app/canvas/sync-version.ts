export type VersionStamp = {
  version: number
  versionNonce: number
  isDeleted: boolean
}

export function isNewerVersion(next: VersionStamp, previous: VersionStamp | undefined): boolean {
  if (!previous) return true
  return next.version > previous.version || (next.version === previous.version && next.versionNonce > previous.versionNonce)
}

/**
 * A pending local write is worth retrying only when it is strictly newer than
 * the authoritative row. Equal or older pending work has already been accepted
 * or superseded and must be removed from the queue; otherwise one stale record
 * can poison every later batch upsert indefinitely.
 */
export function shouldKeepPending(pending: VersionStamp, authoritative: VersionStamp): boolean {
  return isNewerVersion(pending, authoritative)
}
