import { afterEach, expect, it, vi } from 'vitest'
import { withAssistantActivity } from './assistantFeedback'

afterEach(() => vi.unstubAllGlobals())

it('tracks overlapping real promises independently and finishes only when each resolves', async () => {
  const activity = vi.fn()
  vi.stubGlobal('hasarbotuAssistantFeedback', { activity })
  let resolveFirst!: (value: number) => void
  const first = withAssistantActivity(() => new Promise<number>(resolve => { resolveFirst = resolve }), 'Başarısız')
  const second = withAssistantActivity(async () => 2, 'Başarısız')
  expect(activity.mock.calls.map(call => call[1])).toEqual(['start', 'start'])
  const [firstId, secondId] = activity.mock.calls.map(call => call[0])
  expect(firstId).not.toBe(secondId)
  expect(await second).toBe(2)
  expect(activity).toHaveBeenLastCalledWith(secondId, 'finish')
  resolveFirst(1)
  expect(await first).toBe(1)
  expect(activity).toHaveBeenLastCalledWith(firstId, 'finish')
})

it('reports safe workflow text on rejection and preserves the actual error', async () => {
  const activity = vi.fn()
  vi.stubGlobal('hasarbotuAssistantFeedback', { activity })
  const error = Error('private server detail')
  await expect(withAssistantActivity(async () => { throw error }, 'Not kaydedilemedi')).rejects.toBe(error)
  expect(activity).toHaveBeenLastCalledWith(expect.any(String), 'fail', 'Not kaydedilemedi')
})

it('cancellation ends work without announcing failure; browsers keep promise behavior', async () => {
  const activity = vi.fn()
  vi.stubGlobal('hasarbotuAssistantFeedback', { activity })
  await expect(withAssistantActivity(async () => { throw new DOMException('cancelled', 'AbortError') }, 'Başarısız')).rejects.toHaveProperty('name', 'AbortError')
  expect(activity).toHaveBeenLastCalledWith(expect.any(String), 'finish', undefined)
  vi.unstubAllGlobals()
  expect(await withAssistantActivity(async () => 3, 'Başarısız')).toBe(3)
})
