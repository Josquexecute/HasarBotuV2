import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useOfficeDate } from './useOfficeDate'

afterEach(() => vi.useRealTimers())

it('uses the office calendar and advances an open screen at Istanbul midnight', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-31T20:59:45Z'))
  const view = renderHook(useOfficeDate)
  expect(view.result.current).toBe('2026-10-31')
  act(() => vi.advanceTimersByTime(15_000))
  expect(view.result.current).toBe('2026-11-01')
  view.unmount()
  expect(vi.getTimerCount()).toBe(0)
})

it('refreshes after a sleeping computer regains focus', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-16T20:00:00Z'))
  const { result } = renderHook(useOfficeDate)
  vi.setSystemTime(new Date('2026-10-17T01:00:00Z'))
  act(() => window.dispatchEvent(new Event('focus')))
  expect(result.current).toBe('2026-10-17')
})
