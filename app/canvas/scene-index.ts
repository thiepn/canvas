export type SceneIndexElement = {
  id: string
  version: number
  versionNonce: number
  isDeleted: boolean
}

type SceneIndexEntry<T> = {
  element: T
  version: number
  versionNonce: number
  isDeleted: boolean
}

export type SceneObservation<T> = {
  changed: T[]
  scanned: number
  skipped: number
  ignored: number
  hasDisallowed: boolean
}

function sameStamp<T extends SceneIndexElement>(entry: SceneIndexEntry<T>, element: T): boolean {
  return entry.version === element.version
    && entry.versionNonce === element.versionNonce
    && entry.isDeleted === element.isDeleted
}

/**
 * Tracks immutable Excalidraw element versions by ID.
 *
 * `observe()` still performs one cheap array traversal because Excalidraw's
 * onChange contract supplies the whole scene, but expensive mutation/conflict
 * work can be restricted to elements whose immutable version stamp changed.
 * A stamp snapshot is stored separately from the object reference so this
 * remains correct even if a caller ever mutates an object in place.
 *
 * `ignore` is deliberately evaluated before the index is mutated. It is used
 * for known remote/quarantined versions (for example an ephemeral preview
 * callback that arrives after authority has already been restored). Such an
 * echo must not move the local observation index away from authoritative state.
 */
export class SceneVersionIndex<T extends SceneIndexElement> {
  private readonly entries = new Map<string, SceneIndexEntry<T>>()

  observe(
    elements: readonly T[],
    allowed: (element: T) => boolean,
    ignore: (element: T) => boolean = () => false,
  ): SceneObservation<T> {
    const changed: T[] = []
    let skipped = 0
    let ignored = 0
    let hasDisallowed = false

    for (const element of elements) {
      if (!allowed(element)) {
        hasDisallowed = true
        continue
      }
      if (ignore(element)) {
        ignored += 1
        continue
      }
      const previous = this.entries.get(element.id)
      if (previous && sameStamp(previous, element)) {
        // Refresh the reference while preserving the immutable stamp snapshot.
        previous.element = element
        skipped += 1
        continue
      }
      this.entries.set(element.id, {
        element,
        version: element.version,
        versionNonce: element.versionNonce,
        isDeleted: element.isDeleted,
      })
      changed.push(element)
    }

    return { changed, scanned: elements.length, skipped, ignored, hasDisallowed }
  }

  mark(elements: readonly T[], allowed: (element: T) => boolean = () => true): void {
    for (const element of elements) {
      if (!allowed(element)) continue
      this.entries.set(element.id, {
        element,
        version: element.version,
        versionNonce: element.versionNonce,
        isDeleted: element.isDeleted,
      })
    }
  }

  replace(elements: readonly T[], allowed: (element: T) => boolean = () => true): void {
    this.entries.clear()
    this.mark(elements, allowed)
  }

  delete(id: string): void {
    this.entries.delete(id)
  }

  clear(): void {
    this.entries.clear()
  }

  get size(): number {
    return this.entries.size
  }
}

export function indexSceneById<T extends { id: string }>(elements: readonly T[]): Map<string, T> {
  const indexed = new Map<string, T>()
  for (const element of elements) indexed.set(element.id, element)
  return indexed
}
