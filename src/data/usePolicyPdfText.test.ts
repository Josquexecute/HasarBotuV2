import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHttpPolicyPdfTextAdapter } from './policyPdfTextHttpAdapter'
import type { PdfPolicySourceRecord, PdfTextExtractionRecord, PolicyPdfTextDataPort } from './ports'
import { usePolicyPdfText } from './usePolicyPdfText'

vi.mock('./policyPdfTextHttpAdapter', async importOriginal => ({
  ...await importOriginal<typeof import('./policyPdfTextHttpAdapter')>(),
  createHttpPolicyPdfTextAdapter: vi.fn(),
}))

const source = (id: string): PdfPolicySourceRecord => ({
  documentId: `doc-${id}`, documentVersionId: id, versionNumber: 1, displayName: id,
  mimeType: 'application/pdf', byteSize: 100, status: 'ready', verifiedAt: '2026-10-15T10:00:00.000Z',
})
const extraction = (id: string, status: PdfTextExtractionRecord['status'] = 'ready'): PdfTextExtractionRecord => ({
  id, documentId: `doc-${id}`, documentVersionId: id, extractionVersion: 1, status,
  parserName: 'pdfjs-dist', parserVersion: '6.1.200', normalizationVersion: 'pdf-text-normalization/1.0.0',
  offsetUnit: 'unicode_code_point', pageCount: 1, textPageCount: 1, imageOnlyPageCount: 0,
  emptyPageCount: 0, failedPageCount: 0, segmentCount: 1, rawCharacterCount: 1, normalizedCharacterCount: 1,
  outputHash: 'a'.repeat(64), failureCode: null, version: 2, createdAt: '2026-10-15T10:00:00.000Z',
  startedAt: null, completedAt: null,
})
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

describe('policy PDF selection and asynchronous evidence ownership', () => {
  let port: PolicyPdfTextDataPort
  beforeEach(() => {
    port = {
      listSources: vi.fn(async () => [source('a'), source('b'), source('c')]),
      listExtractions: vi.fn(async (_caseId, selected) => [extraction(selected.documentVersionId)]),
      listPages: vi.fn<PolicyPdfTextDataPort['listPages']>(async (_caseId, id) => [{
        id: `page-${id}`, extractionId: id, pageNumber: 1, status: 'text', rawText: id,
        normalizedText: id, rawTextHash: 'a'.repeat(64), normalizedTextHash: 'b'.repeat(64), segmentCount: 1,
      }]),
      listSegments: vi.fn<PolicyPdfTextDataPort['listSegments']>(async (_caseId, id) => [{
        id: `segment-${id}`, extractionId: id, pageId: `page-${id}`, pageNumber: 1,
        segmentIndex: 0, type: 'title', startOffset: 0, endOffset: 1, text: id, textHash: 'c'.repeat(64),
      }]),
      getExtraction: vi.fn(async (_caseId, id) => extraction(id)),
      createExtraction: vi.fn(async (_caseId, selected) => extraction(selected.documentVersionId, 'queued')),
      createSourceReference: vi.fn(),
    }
    vi.mocked(createHttpPolicyPdfTextAdapter).mockReturnValue(port)
  })
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

  it('loads pages and segments for the ready extraction of a newly selected PDF', async () => {
    const { result } = renderHook(() => usePolicyPdfText('case'))
    await waitFor(() => expect(result.current.status).toBe('ok'))
    act(() => result.current.selectSource('b'))
    await waitFor(() => expect(result.current.current?.id).toBe('b'))
    await waitFor(() => expect(result.current.pages[0]?.normalizedText).toBe('b'))
    expect(result.current.segments[0]?.text).toBe('b')
  })

  it('clears readable evidence when a queued extraction is selected', async () => {
    vi.mocked(port.listExtractions).mockResolvedValue([extraction('a'), extraction('queued', 'queued')])
    const { result } = renderHook(() => usePolicyPdfText('case'))
    await waitFor(() => expect(result.current.pages).toHaveLength(1))
    act(() => result.current.selectExtraction('queued'))
    expect(result.current.pages).toEqual([])
    expect(result.current.segments).toEqual([])
    expect(result.current.reference).toBeNull()
  })

  it('ignores a late source response after a newer PDF selection', async () => {
    const slow = deferred<readonly PdfTextExtractionRecord[]>()
    vi.mocked(port.listExtractions).mockImplementation(async (_caseId, selected) =>
      selected.documentVersionId === 'b' ? slow.promise : [extraction(selected.documentVersionId)])
    const { result } = renderHook(() => usePolicyPdfText('case'))
    await waitFor(() => expect(result.current.status).toBe('ok'))
    act(() => result.current.selectSource('b'))
    act(() => result.current.selectSource('c'))
    await waitFor(() => expect(result.current.current?.id).toBe('c'))
    await act(async () => { slow.resolve([extraction('b')]); await slow.promise })
    expect(result.current.selected?.documentVersionId).toBe('c')
    expect(result.current.current?.id).toBe('c')
    expect(result.current.pages[0]?.normalizedText).toBe('c')
  })

  it('ignores old page requests when the selected extraction changes', async () => {
    const slow = deferred<Awaited<ReturnType<PolicyPdfTextDataPort['listPages']>>>()
    vi.mocked(port.listExtractions).mockResolvedValue([extraction('a'), extraction('slow'), extraction('c')])
    vi.mocked(port.listPages).mockImplementation(async (_caseId, id) => id === 'slow' ? slow.promise : [{
      id: `page-${id}`, extractionId: id, pageNumber: 1, status: 'text', rawText: id,
      normalizedText: id, rawTextHash: 'a'.repeat(64), normalizedTextHash: 'b'.repeat(64), segmentCount: 1,
    }])
    const { result } = renderHook(() => usePolicyPdfText('case'))
    await waitFor(() => expect(result.current.status).toBe('ok'))
    act(() => result.current.selectExtraction('slow'))
    act(() => result.current.selectExtraction('c'))
    await waitFor(() => expect(result.current.pages[0]?.normalizedText).toBe('c'))
    await act(async () => { slow.resolve([]); await slow.promise })
    expect(result.current.current?.id).toBe('c')
    expect(result.current.pages[0]?.normalizedText).toBe('c')
  })

  it('does not let a late polling response replace the selected extraction', async () => {
    vi.mocked(port.listExtractions).mockResolvedValue([extraction('a', 'queued'), extraction('c')])
    const slow = deferred<PdfTextExtractionRecord>()
    vi.mocked(port.getExtraction).mockReturnValue(slow.promise)
    const { result } = renderHook(() => usePolicyPdfText('case'))
    await waitFor(() => expect(result.current.status).toBe('ok'))
    await waitFor(() => expect(port.getExtraction).toHaveBeenCalled(), { timeout: 2500 })
    act(() => result.current.selectExtraction('c'))
    await waitFor(() => expect(result.current.pages[0]?.normalizedText).toBe('c'))
    await act(async () => { slow.resolve(extraction('a')); await slow.promise })
    expect(result.current.current?.id).toBe('c')
    expect(result.current.pages[0]?.normalizedText).toBe('c')
  })

  it('loads a new case with no evidence from the previous case', async () => {
    const slow = deferred<readonly PdfPolicySourceRecord[]>()
    vi.mocked(port.listSources).mockImplementation(async caseId => caseId === 'empty' ? slow.promise : [source('a')])
    const { result, rerender } = renderHook(({ caseId }) => usePolicyPdfText(caseId), { initialProps: { caseId: 'case' } })
    await waitFor(() => expect(result.current.pages).toHaveLength(1))
    rerender({ caseId: 'empty' })
    expect(result.current.pages).toEqual([])
    expect(result.current.current).toBeNull()
    await act(async () => { slow.resolve([]); await slow.promise })
    await waitFor(() => expect(result.current.status).toBe('empty'))
    expect(result.current.selected).toBeNull()
    expect(result.current.segments).toEqual([])
  })
})
