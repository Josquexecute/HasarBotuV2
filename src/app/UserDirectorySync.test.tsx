import { act, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { SessionContext, type SessionContextValue } from './sessionContext'
import { UserDirectorySync, USER_DIRECTORY_REFRESH_MS } from './UserDirectorySync'
import { USER_DIRECTORY_UPDATED_EVENT } from './userDirectory'

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })
it('publishes a shared-name change observed from another client, without invalidating unchanged data', async () => {
  vi.useFakeTimers()
  const changed = vi.fn(), directory = { items: [{ id: 'other', displayName: 'Eski Ad Soyad' }] }
  const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify(directory), { status: 200 }))
  window.addEventListener(USER_DIRECTORY_UPDATED_EVENT, changed)
  const view = render(<SessionContext.Provider value={{ mode: 'api', status: 'authenticated', user: { id: 'self', organizationId: 'office' }, reportUnauthorized: vi.fn() } as unknown as SessionContextValue}><UserDirectorySync /></SessionContext.Provider>)
  try {
    await act(async () => {})
    expect(fetcher).toHaveBeenCalledTimes(1)
    await act(async () => vi.advanceTimersByTimeAsync(USER_DIRECTORY_REFRESH_MS))
    expect(changed).not.toHaveBeenCalled()
    directory.items[0]!.displayName = 'Güncel Ad Soyad'
    await act(async () => vi.advanceTimersByTimeAsync(USER_DIRECTORY_REFRESH_MS))
    expect(changed).toHaveBeenCalledTimes(1)
    view.unmount()
    await act(async () => vi.advanceTimersByTimeAsync(USER_DIRECTORY_REFRESH_MS))
    expect(fetcher).toHaveBeenCalledTimes(3)
  } finally { window.removeEventListener(USER_DIRECTORY_UPDATED_EVENT, changed) }
})
