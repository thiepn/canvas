import { LIMITS } from '../../shared/limits.ts'
export interface ClipboardSummary { types: readonly string[]; fileCount: number; text?: string }
export function classifyClipboard(input: ClipboardSummary): 'allow' | 'files' | 'too-large' {
  if (input.fileCount || input.types.some(type => type === 'Files' || type.startsWith('image/') || type === 'application/pdf')) return 'files'
  if ((input.text?.length ?? 0) > LIMITS.textCharacters) return 'too-large'
  return 'allow'
}
export function installClipboardGuards(root: HTMLElement, notify: (message: string) => void): () => void {
  const stop = (event: Event, message: string) => { event.preventDefault(); event.stopPropagation(); notify(message) }
  const paste = (event: ClipboardEvent) => {
    if (!event.clipboardData) return
    const data = event.clipboardData
    const reason = classifyClipboard({ types: Array.from(data.types), fileCount: data.files.length, text: data.getData('text/plain') })
    if (reason !== 'allow') stop(event, reason === 'files' ? 'Images and files are not supported in Canvas.' : 'Paste less than 20,000 characters into one text object.')
  }
  const drop = (event: DragEvent) => {
    if (event.dataTransfer && (event.dataTransfer.files.length || Array.from(event.dataTransfer.types).includes('Files'))) stop(event, 'Images and file uploads are not supported in Canvas.')
  }
  const drag = (event: DragEvent) => {
    if (event.dataTransfer && Array.from(event.dataTransfer.types).includes('Files')) { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'none' }
  }
  root.addEventListener('paste', paste, true)
  root.addEventListener('drop', drop, true)
  root.addEventListener('dragover', drag, true)
  return () => { root.removeEventListener('paste', paste, true); root.removeEventListener('drop', drop, true); root.removeEventListener('dragover', drag, true) }
}
