import assert from 'node:assert/strict'
import { test } from 'node:test'
import { boundsInsideDisplay, parseTestDisplayIndex, placeBoundsOnDisplay, selectTestDisplay } from './test-display-policy.mjs'

const displays = [{ id: 1, workArea: { x: 0, y: 0, width: 2560, height: 1410 } }, { id: 2, workArea: { x: -1920, y: 0, width: 1920, height: 1050 } }]
test('the optional zero-based display selection fails closed instead of falling back to primary', () => {
  assert.equal(parseTestDisplayIndex(undefined), null)
  assert.equal(parseTestDisplayIndex('1'), 1)
  assert.equal(selectTestDisplay(displays, 1).id, 2)
  for (const value of ['', '-1', '1.0', '01', 'true']) assert.throws(() => parseTestDisplayIndex(value))
  assert.throws(() => selectTestDisplay(displays, 2), /unavailable/)
})
test('real window dimensions are preserved while placement is limited to the selected display', () => {
  const placed = placeBoundsOnDisplay({ x: 100, y: 100, width: 1440, height: 900 }, displays[1].workArea)
  assert.deepEqual(placed, { x: -1440, y: 100, width: 1440, height: 900 })
  assert(boundsInsideDisplay(placed, displays[1].workArea))
  assert(!boundsInsideDisplay({ ...placed, x: 0 }, displays[1].workArea))
  assert.throws(() => placeBoundsOnDisplay({ x: 0, y: 0, width: 1921, height: 900 }, displays[1].workArea), /does not fit/)
})
