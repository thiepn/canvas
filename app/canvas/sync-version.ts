export type VersionStamp = {
  version: number
  versionNonce: number
  isDeleted: boolean
}

/**
 * Excalidraw's reconciliation contract is: higher version wins; when versions
 * are equal, the lower versionNonce wins deterministically.
 */
export function isNewerVersion(next: VersionStamp, previous: VersionStamp | undefined): boolean {
  if (!previous) return true
  return next.version > previous.version || (next.version === previous.version && next.versionNonce < previous.versionNonce)
}

/**
 * A pending local write is worth retrying only when it would win Excalidraw's
 * deterministic version comparison against the authoritative row. Equal or
 * losing pending work has already been accepted or superseded and must leave
 * the queue so it cannot poison later batch upserts.
 */
export function shouldKeepPending(pending: VersionStamp, authoritative: VersionStamp): boolean {
  return isNewerVersion(pending, authoritative)
}
