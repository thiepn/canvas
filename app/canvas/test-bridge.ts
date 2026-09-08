import { createShapeId, toRichText, type Editor, type TLShapeId } from 'tldraw'
export interface TestShape { id: string; type: string; x: number; y: number; props: Record<string, unknown> }
export interface CanvasTestBridge {
  shapes: () => TestShape[]
  create: (kind: string, label?: string, x?: number, y?: number) => string
  move: (id: string, x: number, y: number) => void
  resize: (id: string, w: number, h: number) => void
  remove: (id: string) => void
  undo: () => void; redo: () => void
  people: () => number; home: () => void
  seed: (count: number, offset?: number) => void
  pan: (x: number, y: number) => void
  camera: () => { x: number; y: number; z: number }
}
declare global { interface Window { __CANVAS_TEST__?: CanvasTestBridge } }
/** Dynamically imported ONLY by Vite's test mode. Production bundle audit forbids this marker. */
export function installTestBridge(editor: Editor): () => void {
  window.__CANVAS_TEST__ = {
    shapes: () => editor.getCurrentPageShapes().map(shape => ({ id: shape.id, type: shape.type, x: shape.x, y: shape.y, props: shape.props as unknown as Record<string, unknown> })),
    create(kind, label = 'Hello', x = 0, y = 0) {
      const id = createShapeId()
      editor.markHistoryStoppingPoint(`test-create-${id}`)
      if (kind === 'text') editor.createShape({ id, type: 'text', x, y, props: { richText: toRichText(label) } })
      else if (kind === 'frame') editor.createShape({ id, type: 'frame', x, y, props: { w: 400, h: 300, name: label } })
      else editor.createShape({ id, type: 'geo', x, y, props: { geo: kind === 'ellipse' ? 'ellipse' : kind === 'diamond' ? 'diamond' : 'rectangle', w: 120, h: 80 } })
      return id
    },
    move(id, x, y) { const shape = editor.getShape(id as TLShapeId); if (shape) { editor.markHistoryStoppingPoint('test-move'); editor.updateShape({ id: shape.id, type: shape.type, x, y }) } },
    resize(id, w, h) { const shape = editor.getShape(id as TLShapeId); if (shape?.type === 'geo') editor.updateShape({ id: shape.id, type: 'geo', props: { w, h } }) },
    remove(id) { editor.markHistoryStoppingPoint('test-delete'); editor.deleteShapes([id as TLShapeId]) },
    undo: () => { editor.undo() }, redo: () => { editor.redo() },
    people: () => editor.getCollaborators().length,
    home: () => { editor.setCamera({ x: 0, y: 0, z: 1 }); editor.centerOnPoint({ x: 0, y: 0 }) },
    seed(count, offset = 0) {
      editor.createShapes(Array.from({ length: count }, (_, i) => ({ id: createShapeId(), type: 'geo' as const, x: ((i + offset) % 100) * 150, y: Math.floor((i + offset) / 100) * 110, props: { geo: 'rectangle' as const, w: 100, h: 70 } })))
    },
    camera: () => { const { x, y, z } = editor.getCamera(); return { x, y, z } },
    pan: (x, y) => { editor.setCamera({ x, y, z: 1 }) },
  }
  return () => { delete window.__CANVAS_TEST__ }
}
