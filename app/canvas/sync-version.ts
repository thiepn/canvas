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


export type VersionedSceneElement = VersionStamp & { id: string }

/**
 * Excalidraw reconciliation is optimized for full remote scene updates. Canvas
 * applies revision pages as bounded deltas, so an accepted authoritative
 * tombstone must remain a tombstone even when the generic reconciler keeps the
 * local visible element while merging a partial remote page.
 *
 * Call this only after local pending-work guards have already decided that the
 * authoritative tombstone is allowed to win.
 */
export function enforceAuthoritativeTombstones<T extends VersionedSceneElement>(
  reconciled: readonly T[],
  authoritativeChanges: readonly T[],
): T[] {
  const tombstones = new Map(authoritativeChanges.filter(element => element.isDeleted).map(element => [element.id, element]))
  if (!tombstones.size) return [...reconciled]

  const seen = new Set<string>()
  const next = reconciled.map(element => {
    const tombstone = tombstones.get(element.id)
    if (!tombstone) return element
    seen.add(element.id)
    const exactStamp = tombstone.version === element.version && tombstone.versionNonce === element.versionNonce
    return exactStamp || isNewerVersion(tombstone, element) ? tombstone : element
  })
  for (const tombstone of tombstones.values()) if (!seen.has(tombstone.id)) next.push(tombstone)
  return next
}


/**
 * Revision anti-entropy must be able to replay an authoritative tombstone even
 * after its version watermark was already observed through Realtime/preview
 * coordination. Otherwise a transient render deferral can make the shadow map
 * say "up to date" while the visible scene still contains the live element.
 */
export function shouldApplyAuthoritativeChange(
  authoritative: VersionStamp,
  shadow: VersionStamp | undefined,
  rendered: VersionStamp | undefined,
  hasPendingLocal: boolean,
): boolean {
  if (isNewerVersion(authoritative, shadow)) return true
  if (!authoritative.isDeleted || hasPendingLocal || !shadow || !rendered || rendered.isDeleted) return false

  const shadowMatchesAuthoritativeOrder =
    shadow.version === authoritative.version
    && shadow.versionNonce === authoritative.versionNonce
  if (!shadowMatchesAuthoritativeOrder) return false

  // Do not overwrite a genuinely newer rendered local version. Equal/older
  // visible state, including an equal stamp with a different deletion flag,
  // must yield to the accepted server tombstone.
  return !isNewerVersion(rendered, authoritative)
}
