import { getSnapshot, type Editor } from 'tldraw'
import { parseBackup, wrapBackup, type BackupEnvelope } from '../../shared/backup.ts'

export function downloadJson(value: unknown, filename: string): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value)], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove()
  // Keep the URL briefly so Safari has time to begin reading the download.
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
export async function exportCanvas(apiUrl: string, editor: Editor | null, online: boolean, notify: (message: string) => void): Promise<void> {
  try {
    if (online) {
      const response = await fetch(`${apiUrl}/api/snapshot`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) })
      if (!response.ok) throw new Error(`Server export failed (${response.status}).`)
      const backup = parseBackup(await response.text())
      downloadJson(backup, `Canvas-${new Date().toISOString().replaceAll(':', '-')}.json`)
      notify('Downloaded the server’s current durable state.')
      return
    }
    if (!editor) throw new Error('Connect once before a local recovery copy is available.')
    const { document } = getSnapshot(editor.store)
    const envelope = wrapBackup({
      schema: document.schema as unknown as BackupEnvelope['snapshot']['schema'],
      documents: Object.values(document.store).map(state => ({ state: state as unknown as Record<string, unknown>, lastChangedClock: 0 })),
    })
    downloadJson(envelope, `Canvas-LOCAL-UNCONFIRMED-${Date.now()}.json`)
    notify('Downloaded this tab’s local state. It may include edits not saved to the server.')
  } catch (error) { notify(error instanceof Error ? error.message : 'Export failed. Please try again.') }
}
