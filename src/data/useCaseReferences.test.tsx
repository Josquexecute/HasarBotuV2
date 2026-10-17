import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { CaseReferenceDataPort, CaseReferenceWorkspace } from './ports'
import { ReferenceDataError } from './referenceHttpAdapter'
import { useCaseReferences } from './useCaseReferences'
import { USER_DIRECTORY_UPDATED_EVENT } from '../app/userDirectory'

const empty: CaseReferenceWorkspace = { users: [], services: [], experts: [], insurers: [] }

describe('reference request ownership', () => {
  it('refreshes a loaded owner name after a shared directory update', async () => {
    const port = { getCaseReferences: vi.fn().mockResolvedValueOnce({ ...empty, users: [{ id: 'owner', displayName: 'Eski Ad Soyad' }] }).mockResolvedValue({ ...empty, users: [{ id: 'owner', displayName: 'Güncel Ad Soyad' }] }) }
    const { result } = renderHook(() => useCaseReferences(port))
    await waitFor(() => expect(result.current.references?.users[0]?.displayName).toBe('Eski Ad Soyad'))
    act(() => window.dispatchEvent(new Event(USER_DIRECTORY_UPDATED_EVENT)))
    await waitFor(() => expect(result.current.references?.users[0]?.displayName).toBe('Güncel Ad Soyad'))
  })
  it('hides the previous evaluation immediately when the insurer or date changes and ignores late responses', async () => {
    const pending: ((value: CaseReferenceWorkspace) => void)[] = []
    const port: CaseReferenceDataPort = { getCaseReferences: vi.fn(() => new Promise<CaseReferenceWorkspace>(resolve => pending.push(resolve))) }
    const { result, rerender } = renderHook(({ insurerId, evaluationDate }) => useCaseReferences(port, { insurerId, evaluationDate }), { initialProps: { insurerId: 'a', evaluationDate: '2026-10-01' } })
    await act(async () => pending[0]!(empty))
    expect(result.current.status).toBe('ok')
    rerender({ insurerId: 'b', evaluationDate: '2026-10-01' })
    expect(result.current).toMatchObject({ status: 'loading', references: null })
    rerender({ insurerId: 'b', evaluationDate: '2026-10-02' })
    await act(async () => pending[1]!({ ...empty, insurers: [{ id: 'obsolete', name: 'Eski şirket' }] }))
    expect(result.current).toMatchObject({ status: 'loading', references: null })
    await act(async () => pending[2]!(empty))
    expect(result.current).toMatchObject({ status: 'ok', references: empty })
  })

  it('invalidates references on reload and supports recovery after a failure', async () => {
    const getCaseReferences = vi.fn().mockResolvedValueOnce(empty).mockRejectedValueOnce(new ReferenceDataError('unavailable', 'offline')).mockResolvedValueOnce(empty)
    const port = { getCaseReferences }
    const { result } = renderHook(() => useCaseReferences(port))
    await waitFor(() => expect(result.current.status).toBe('ok'))
    act(() => result.current.reload())
    expect(result.current).toMatchObject({ status: 'loading', references: null })
    await waitFor(() => expect(result.current.status).toBe('unavailable'))
    act(() => result.current.reload())
    await waitFor(() => expect(result.current.status).toBe('ok'))
  })
})
