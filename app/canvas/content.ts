import { defaultHandleExternalTextContent, defaultHandleExternalTldrawContent, type Editor, type TLAssetStore } from 'tldraw'
import { validateCanvasRecord, isAllowedUrl } from '../../shared/document-policy.ts'
import { LIMITS } from '../../shared/limits.ts'
import { byteLength } from '../../shared/json.ts'

export const NO_ASSETS: TLAssetStore = {
  upload: async () => { throw new Error('Canvas does not accept files or media.') },
  resolve: () => null,
}

export function installContentPolicy(editor: Editor, notify: (message: string) => void): void {
  const reject = () => { notify('Images and files are not supported in Canvas.') }
  editor.registerExternalAssetHandler('file', null)
  editor.registerExternalAssetHandler('url', null)
  editor.registerExternalContentHandler('files', reject)
  editor.registerExternalContentHandler('file-replace', reject)
  editor.registerExternalContentHandler('svg-text', reject)
  editor.registerExternalContentHandler('embed', reject)
  editor.registerExternalContentHandler('excalidraw', () => notify('Paste Canvas objects or plain text instead.'))
  editor.registerExternalContentHandler('text', async content => {
    if (content.text.length > LIMITS.textCharacters) { notify('Text is limited to 20,000 characters per object.'); return }
    // Never pass pasted HTML into rich-text conversion. Ordinary text remains fully supported.
    await defaultHandleExternalTextContent(editor, { type: 'text', text: content.text, point: content.point })
  })
  editor.registerExternalContentHandler('url', async content => {
    if (!isAllowedUrl(content.url)) { notify('That link format is not supported.'); return }
    await defaultHandleExternalTextContent(editor, { type: 'text', text: content.url, point: content.point })
  })
  editor.registerExternalContentHandler('tldraw', async content => {
    const payload = content.content
    if (payload.assets.length || !payload.shapes.every(validateCanvasRecord) || !(payload.bindings ?? []).every(validateCanvasRecord)) { reject(); return }
    if (byteLength(JSON.stringify(payload)) > LIMITS.messageBytes / 2 || editor.getCurrentPageShapes().length + payload.shapes.length > LIMITS.shapes) {
      notify('This selection is too large to paste safely. Copy a smaller group.'); return
    }
    await defaultHandleExternalTldrawContent(editor, content)
  })
}
