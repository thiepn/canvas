const INTERACTIVE_CANVAS_SELECTOR = 'canvas.excalidraw__canvas.interactive'

type WheelGesture = Pick<WheelEvent, 'altKey' | 'button' | 'buttons' | 'clientX' | 'clientY' | 'ctrlKey' | 'deltaMode' | 'deltaX' | 'deltaY' | 'deltaZ' | 'metaKey' | 'screenX' | 'screenY' | 'shiftKey'>

export function shouldConvertWheelToZoom(event: Pick<WheelGesture, 'ctrlKey' | 'deltaX' | 'deltaY'>): boolean {
  if (event.ctrlKey || event.deltaY === 0) return false
  return Math.abs(event.deltaY) >= Math.abs(event.deltaX)
}

export function zoomWheelInit(event: WheelGesture): WheelEventInit {
  return {
    bubbles: true,
    cancelable: true,
    composed: true,
    altKey: event.altKey,
    button: event.button,
    buttons: event.buttons,
    clientX: event.clientX,
    clientY: event.clientY,
    ctrlKey: true,
    deltaMode: event.deltaMode,
    deltaX: event.deltaX,
    deltaY: event.deltaY,
    deltaZ: event.deltaZ,
    metaKey: event.metaKey,
    screenX: event.screenX,
    screenY: event.screenY,
    shiftKey: event.shiftKey,
  }
}

/**
 * Excalidraw already has correct focal-point zoom, zoom limits, and trackpad
 * handling for Ctrl+wheel. Canvas changes only the gesture mapping: a normal
 * vertical wheel over the interactive drawing surface is re-issued as that
 * native Excalidraw zoom gesture instead of reaching Excalidraw's pan handler.
 */
export function installCanvasWheelZoom(doc: Document = document): () => void {
  const onWheel = (event: WheelEvent) => {
    if (!shouldConvertWheelToZoom(event)) return
    const target = event.target
    if (!(target instanceof Element) || !target.matches(INTERACTIVE_CANVAS_SELECTOR)) return

    event.preventDefault()
    event.stopImmediatePropagation()
    target.dispatchEvent(new WheelEvent('wheel', zoomWheelInit(event)))
  }

  doc.addEventListener('wheel', onWheel, { capture: true, passive: false })
  return () => doc.removeEventListener('wheel', onWheel, { capture: true })
}
