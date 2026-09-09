import assert from 'node:assert/strict'
import test from 'node:test'
import { shouldConvertWheelToZoom, zoomWheelInit } from '../../app/canvas/wheel-zoom.ts'

test('vertical plain wheel gestures become zoom gestures', () => {
  assert.equal(shouldConvertWheelToZoom({ ctrlKey: false, deltaX: 0, deltaY: -120 }), true)
  assert.equal(shouldConvertWheelToZoom({ ctrlKey: false, deltaX: 12, deltaY: 40 }), true)
})

test('native pinch/zoom and horizontal gestures are left to Excalidraw', () => {
  assert.equal(shouldConvertWheelToZoom({ ctrlKey: true, deltaX: 0, deltaY: -20 }), false)
  assert.equal(shouldConvertWheelToZoom({ ctrlKey: false, deltaX: 80, deltaY: 10 }), false)
  assert.equal(shouldConvertWheelToZoom({ ctrlKey: false, deltaX: 20, deltaY: 0 }), false)
})

test('converted wheel preserves pointer and delta data while adding ctrlKey', () => {
  const init = zoomWheelInit({
    altKey: false,
    button: 0,
    buttons: 0,
    clientX: 640,
    clientY: 360,
    ctrlKey: false,
    deltaMode: 0,
    deltaX: 3,
    deltaY: -120,
    deltaZ: 0,
    metaKey: false,
    screenX: 700,
    screenY: 420,
    shiftKey: false,
  })

  assert.equal(init.ctrlKey, true)
  assert.equal(init.deltaY, -120)
  assert.equal(init.deltaX, 3)
  assert.equal(init.clientX, 640)
  assert.equal(init.clientY, 360)
  assert.equal(init.bubbles, true)
  assert.equal(init.cancelable, true)
})
