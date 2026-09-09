import type { Editor } from 'tldraw'
import { LIMITS } from '../../shared/limits.ts'
export interface ClipboardSummary { types: readonly string[]; fileCount: number; text?: string }
export function classifyClipboard(input: ClipboardSummary): 'allow' | 'files' | 'too-large' {
  if (input.fileCount || input.types.some(type => type === 'Files' || type.startsWith('image/') || type === 'application/pdf')) return 'files'
  if ((input.text?.length ?? 0) > LIMITS.textCharacters) return 'too-large'
  return 'allow'
}
function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || !!target.closest('input, textarea, [contenteditable="true"]'))
}
function containsTldrawClipboardData(data: DataTransfer): boolean {
  // tldraw stores structured object clipboard data inside HTML. Leave that path to the
  // engine so multi-shape copy/paste, bindings, grouping, and placement semantics remain native.
  return data.getData('text/html').includes('data-tldraw')
}
export function installClipboardGuards(root: HTMLElement, editor: Editor, notify: (message: string) => void): () => void {
  const stop = (event: Event, message: string) => { event.preventDefault(); event.stopPropagation(); notify(message) }
  const paste = (event: ClipboardEvent) => {
    if (!event.clipboardData) return
    const data = event.clipboardData
    const text = data.getData('text/plain')
    const reason = classifyClipboard({ types: Array.from(data.types), fileCount: data.files.length, text })
    if (reason !== 'allow') {
      stop(event, reason === 'files' ? 'Images and files are not supported in Canvas.' : 'Paste less than 20,000 characters into one text object.')
      return
    }
    // Inputs and active text editing need the browser's native insertion behavior.
    if (isEditableTarget(event.target) || editor.getEditingShapeId() !== null) return
    // Preserve tldraw's structured vector clipboard. For ordinary external clipboard text,
    // own the event so Firefox, Chromium and WebKit take the same path and HTML is never rendered.
    if (!text || containsTldrawClipboardData(data)) return
    event.preventDefault()
    event.stopPropagation()
    void editor.putExternalContent({ type: 'text', text }).catch(() => notify('Text could not be pasted.'))
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
