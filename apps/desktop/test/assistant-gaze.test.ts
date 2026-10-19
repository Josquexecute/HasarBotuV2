import { afterEach, expect, it, vi } from 'vitest'
import { ASSISTANT_SIZE } from '../src/main/assistant-policy.js'
import { createAssistantGazeTracker } from '../src/main/assistant-gaze.js'

afterEach(() => vi.useRealTimers())
function fixture() {
  vi.useFakeTimers()
  let point = { x: ASSISTANT_SIZE / 2, y: ASSISTANT_SIZE / 2 }
  let enabled = true
  const cursor = vi.fn(() => point)
  const send = vi.fn()
  const tracker = createAssistantGazeTracker({ enabled: () => enabled, cursor, position: () => ({ x: 0, y: 0 }), send })
  return { tracker, cursor, send, move: (value: typeof point) => { point = value }, disable: () => { enabled = false } }
}

it('samples distant activity 75% less often while unchanged gaze sends no repeated IPC', () => {
  const ui = fixture()
  ui.move({ x: 2000, y: 1000 })
  ui.tracker.start()
  vi.advanceTimersByTime(3200)
  expect(ui.cursor).toHaveBeenCalledTimes(11)
  expect(ui.send).toHaveBeenCalledOnce()
  ui.tracker.stop()
  expect(vi.getTimerCount()).toBe(0)
})

it('returns to 80ms updates as the cursor approaches, without waiting for main-window focus', () => {
  const ui = fixture()
  ui.move({ x: 2000, y: 1000 })
  ui.tracker.start()
  ui.move({ x: ASSISTANT_SIZE / 2, y: ASSISTANT_SIZE / 2 })
  vi.advanceTimersByTime(320)
  expect(ui.send).toHaveBeenLastCalledWith({ x: 0, y: 0 })
  vi.advanceTimersByTime(800)
  expect(ui.cursor).toHaveBeenCalledTimes(12)
  ui.tracker.stop()
})

it('does not accumulate timers across show events and stops when hidden or motion is reduced', () => {
  const ui = fixture()
  ui.tracker.start()
  ui.tracker.start()
  expect(vi.getTimerCount()).toBe(1)
  ui.disable()
  vi.advanceTimersByTime(80)
  expect(vi.getTimerCount()).toBe(0)
  const samples = ui.cursor.mock.calls.length
  ui.tracker.start()
  vi.advanceTimersByTime(3200)
  expect(ui.cursor).toHaveBeenCalledTimes(samples)
  expect(vi.getTimerCount()).toBe(0)
})
