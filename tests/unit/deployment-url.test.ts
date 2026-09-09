import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deploymentUrl, requireSecureResponse } from '../../scripts/deployment-url.mjs'

test('Pages HTTP custom-domain metadata is verified over HTTPS', () => {
  assert.equal(deploymentUrl('http://thiepn.dev/canvas/').href, 'https://thiepn.dev/canvas/')
})

test('HTTPS repository paths and custom-domain root remain intact', () => {
  assert.equal(deploymentUrl('https://thiepn.github.io/canvas/').href, 'https://thiepn.github.io/canvas/')
  assert.equal(deploymentUrl('https://canvas.example/').href, 'https://canvas.example/')
  assert.equal(deploymentUrl(' https://example.com/Canvas ').href, 'https://example.com/Canvas/')
})

test('deployment metadata cannot inject query parameters or fragments into verification', () => {
  assert.equal(deploymentUrl('http://thiepn.dev/canvas/?old=1#section').href, 'https://thiepn.dev/canvas/')
})

test('invalid schemes, relative paths and credentials fail closed', () => {
  for (const value of [undefined, '', '/canvas/', 'not a URL', 'javascript:alert(1)', 'file:///tmp/site', 'ftp://example.com', 'https://user:password@example.com/', 'https://user@example.com/']) {
    assert.throws(() => deploymentUrl(value))
  }
})

test('a redirected HTTP destination is rejected, not silently certified', () => {
  assert.equal(requireSecureResponse('https://thiepn.dev/canvas/?release=abc').protocol, 'https:')
  assert.throws(() => requireSecureResponse('http://thiepn.dev/canvas/'))
  assert.throws(() => requireSecureResponse('https://user@example.com/canvas/'))
})
