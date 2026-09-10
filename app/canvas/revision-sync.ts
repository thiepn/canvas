export type RevisionPageResult = {
  completed: boolean
  cursor: number
  pages: number
  rows: number
}

export type RevisionPageOptions<T extends { revision: number }> = {
  startAfter: number
  pageSize: number
  fetchPage: (afterRevision: number, limit: number) => Promise<T[]>
  onPage: (rows: T[], firstPage: boolean) => void | Promise<void>
  isCurrent?: () => boolean
}

function validRevision(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0
}

/**
 * Reads a stable, forward-only revision stream without assuming revisions are contiguous.
 * The caller must only publish the returned cursor after `completed === true`; this keeps
 * a failed/cancelled reconciliation from skipping rows on the next pass.
 */
export async function readRevisionPages<T extends { revision: number }>({
  startAfter,
  pageSize,
  fetchPage,
  onPage,
  isCurrent = () => true,
}: RevisionPageOptions<T>): Promise<RevisionPageResult> {
  if (!Number.isSafeInteger(startAfter) || startAfter < 0) throw new Error('Revision cursor must be a non-negative safe integer.')
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 1000) throw new Error('Revision page size must be between 1 and 1000.')

  let cursor = startAfter
  let pages = 0
  let rowCount = 0
  let firstPage = true

  while (isCurrent()) {
    const rows = await fetchPage(cursor, pageSize)
    if (!isCurrent()) return { completed: false, cursor: startAfter, pages, rows: rowCount }
    if (rows.length > pageSize) throw new Error('Revision source returned more rows than requested.')

    let previous = cursor
    for (const row of rows) {
      if (!validRevision(row.revision) || row.revision <= previous) {
        throw new Error('Revision pages must be strictly increasing safe integers.')
      }
      previous = row.revision
    }

    await onPage(rows, firstPage)
    pages += 1
    rowCount += rows.length
    firstPage = false

    if (!rows.length) return { completed: true, cursor, pages, rows: rowCount }
    cursor = rows[rows.length - 1]!.revision
    if (rows.length < pageSize) return { completed: true, cursor, pages, rows: rowCount }
  }

  return { completed: false, cursor: startAfter, pages, rows: rowCount }
}
