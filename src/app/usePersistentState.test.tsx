import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { PERSISTENCE_ERROR_EVENT, usePersistentState } from './usePersistentState'

afterEach(() => { vi.restoreAllMocks(); localStorage.clear() })

it.each([
  ['hasarbotu-theme', 'neon', 'light'],
  ['hasarbotu-density', 123, 'compact'],
  ['hasarbotu-sidebar-collapsed', 'false', false],
  ['hasarbotu-default-page', {}, 'Durum Panosu'],
])('rejects invalid stored values for %s', (key, stored, initial) => {
  localStorage.setItem(key as string, JSON.stringify(stored))
  const { result } = renderHook(() => usePersistentState(key as string, initial))
  expect(result.current[0]).toEqual(initial)
})

it('keeps edits in memory and reports quota failures', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError') })
  const notify = vi.fn()
  window.addEventListener(PERSISTENCE_ERROR_EVENT, notify)
  try {
    const { result } = renderHook(() => usePersistentState('hasarbotu-theme', 'light'))
    act(() => result.current[1]('dark'))
    expect(result.current[0]).toBe('dark')
    expect(notify).toHaveBeenCalled()
  } finally { window.removeEventListener(PERSISTENCE_ERROR_EVENT, notify) }
})
