import { DefaultContextMenu, TldrawUiMenuItem, useActions, useEditor, useValue, type TLComponents, type TLUiContextMenuProps, type TLUiOverrides } from 'tldraw'
import { TOOL_IDS } from '../../shared/limits.ts'
import { CanvasToolbar } from './Toolbar.tsx'
const CONTEXT_ACTIONS = ['undo', 'redo', 'cut', 'copy', 'paste', 'duplicate', 'delete', 'group', 'ungroup', 'bring-to-front', 'send-to-back']
function CanvasContextMenu(props: TLUiContextMenuProps) {
  const actions = useActions(), editor = useEditor()
  const readonly = useValue('context.readonly', () => editor.getInstanceState().isReadonly, [editor])
  return <DefaultContextMenu {...props}>{CONTEXT_ACTIONS.map(id => {
    const action = actions[id]
    return action ? <TldrawUiMenuItem key={id} id={action.id} label={action.label} kbd={action.kbd} onSelect={action.onSelect} readonlyOk={action.readonlyOk} disabled={readonly && id !== 'copy'} /> : null
  })}</DefaultContextMenu>
}
export const UI_COMPONENTS: TLComponents = {
  Toolbar: CanvasToolbar, ContextMenu: CanvasContextMenu,
  MainMenu: null, PageMenu: null, MenuPanel: null, SharePanel: null,
  ActionsMenu: null, QuickActions: null, HelperButtons: null,
  DebugMenu: null, DebugPanel: null, Minimap: null,
  ImageToolbar: null, VideoToolbar: null, CursorChatBubble: null,
}
export const UI_OVERRIDES: TLUiOverrides = {
  tools: (_editor, tools) => Object.fromEntries(Object.entries(tools).filter(([id]) => TOOL_IDS.includes(id as typeof TOOL_IDS[number]))),
  actions: (_editor, actions) => Object.fromEntries(Object.entries(actions).filter(([id]) => !/(insert-media|insert-embed|insert-bookmark|open-file|open-project|new-project|save-file|move-to-new-page|next-page|previous-page|cursor-chat)/.test(id))),
}
