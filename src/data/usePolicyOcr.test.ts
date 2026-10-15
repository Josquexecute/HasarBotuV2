import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHttpPolicyOcrAdapter } from './policyOcrHttpAdapter'
import { createHttpPolicyPdfTextAdapter } from './policyPdfTextHttpAdapter'
import type { PolicyOcrElementRecord, PolicyOcrRunRecord } from './ports'
import { usePolicyOcr } from './usePolicyOcr'

vi.mock('./policyOcrHttpAdapter', async original => ({
  ...await original<typeof import('./policyOcrHttpAdapter')>(), createHttpPolicyOcrAdapter: vi.fn(),
}))
vi.mock('./policyPdfTextHttpAdapter', async original => ({
  ...await original<typeof import('./policyPdfTextHttpAdapter')>(), createHttpPolicyPdfTextAdapter: vi.fn(),
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
const run = (id: string, status: PolicyOcrRunRecord['status'] = 'ready') => ({ id, status } as PolicyOcrRunRecord)

describe('OCR evidence selection ownership', () => {
  let ocr: ReturnType<typeof createHttpPolicyOcrAdapter>
  beforeEach(() => {
    vi.mocked(createHttpPolicyPdfTextAdapter).mockReturnValue({
      listSources: vi.fn(async () => [{ documentId: 'doc', documentVersionId: 'version' }]),
      listExtractions: vi.fn(async () => []),
    } as unknown as ReturnType<typeof createHttpPolicyPdfTextAdapter>)
    ocr = {
      listRuns: vi.fn(async () => [run('a'), run('slow'), run('b')]),
      listPages: vi.fn(async () => []),
      listElements: vi.fn(async (_caseId, id) => [{ id: `element-${id}` }]),
      getRun: vi.fn(),
    } as unknown as ReturnType<typeof createHttpPolicyOcrAdapter>
    vi.mocked(createHttpPolicyOcrAdapter).mockReturnValue(ocr)
  })

  it('ignores late content after a different OCR run is selected', async () => {
    const slow = deferred<readonly PolicyOcrElementRecord[]>()
    vi.mocked(ocr.listElements).mockImplementation(async (_caseId, id) => id === 'slow' ? slow.promise : [{ id: `element-${id}` } as PolicyOcrElementRecord])
    const { result } = renderHook(() => usePolicyOcr('case'))
    await waitFor(() => expect(result.current.status).toBe('ok'))
    act(() => result.current.selectRun('slow'))
    act(() => result.current.selectRun('b'))
    await waitFor(() => expect(result.current.elements[0]?.id).toBe('element-b'))
    await act(async () => { slow.resolve([]); await slow.promise })
    expect(result.current.current?.id).toBe('b')
    expect(result.current.elements[0]?.id).toBe('element-b')
  })

  it('ignores an in-flight polling response after the selected OCR run changes', async () => {
    vi.mocked(ocr.listRuns).mockResolvedValue([run('a', 'queued'), run('b')])
    const slow = deferred<PolicyOcrRunRecord>()
    vi.mocked(ocr.getRun).mockReturnValue(slow.promise)
    const { result } = renderHook(() => usePolicyOcr('case'))
    await waitFor(() => expect(result.current.status).toBe('ok'))
    await waitFor(() => expect(ocr.getRun).toHaveBeenCalled(), { timeout: 2500 })
    act(() => result.current.selectRun('b'))
    await waitFor(() => expect(result.current.elements[0]?.id).toBe('element-b'))
    await act(async () => { slow.resolve(run('a')); await slow.promise })
    expect(result.current.current?.id).toBe('b')
    expect(result.current.elements[0]?.id).toBe('element-b')
  })
})
